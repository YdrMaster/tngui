//! Tauri 2 外壳：把 #[tauri::command] 接到 tngui-core 的核心逻辑上。
//!
//! 主要命令：
//! - `launch_tng`：收口配置 → 注入（含 ingress 内部端口、剥离对外绑定）→ 写盘 → spawn
//!   `tng launch` → 起反代（按各 ingress 对外绑定）
//! - `stop_tng`：停 tng 子进程 + 停反代
//! - `proxy_endpoint`：暴露反代各 ingress 对外端点（供前端渲染 `API Base URL` 与推理目标）
//! - `get_status`：轮询控制面 `/livez|/readyz|/status/`
//! - `get_output`：取子进程 stdout/stderr 快照
//! - `send_inference_stream`：经反代对外端点发流式多轮推理（reasoning/content typed delta 经 Channel 推送；`x-model` 由反代按 body.model 注入，此处不注）
//! - `stop_inference_stream`：按请求 ID 取消进行中的推理流；成功停止返回 `stopped`，不是失败

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri::{Builder, generate_context, generate_handler};
use tokio::sync::{Mutex, oneshot};

use tngui_core::{
    InferenceDelta, InferenceEffort, InferenceMessage, InferenceStreamOutcome, ProxyHandle,
    StatusReport, TngSupervisor, fetch_status, pick_launch_ports, prepare_launch,
    sanitize_user_config_for_tng, start_proxy, write_runtime_config,
};

/// 控制端口（启动时注入）；状态轮询读取。
type PortCell = Arc<StdMutex<Option<u16>>>;

/// 一个反代对外端点。
#[derive(serde::Serialize, Clone)]
pub struct ProxyEndpoint {
    pub host: String,
    pub port: u16,
}

/// 反代各 ingress 对外端点（按 `add_ingress` 顺序）。
pub type ProxyEndpoints = Vec<ProxyEndpoint>;

#[derive(Clone)]
pub struct AppState {
    supervisor: Arc<Mutex<TngSupervisor>>,
    port: PortCell,
    /// 反代句柄 + 对外端点。`None` = 未启动（tng 与反代互绑生命周期）。
    proxy: Arc<Mutex<Option<(ProxyHandle, ProxyEndpoints)>>>,
    /// 进行中推理请求的取消注册表；仅存在于 GUI 进程内存，不落盘。
    inference_cancellations: InferenceCancellationCell,
}

/// 推理请求 ID -> 取消信号。`oneshot::Sender` 与 send 命令同生命周期；send 命令
/// 被 stop 发送信号或正常/失败返回时移除。
type InferenceCancellationCell = Arc<StdMutex<HashMap<String, oneshot::Sender<()>>>>;

/// 注册一个推理请求的取消通道。重复请求 ID 直接拒绝，避免同 ID 命令互相覆盖。
fn register_inference_cancellation(
    cell: &InferenceCancellationCell,
    request_id: &str,
) -> Result<oneshot::Receiver<()>, String> {
    let mut registry = cell
        .lock()
        .map_err(|_| "推理取消注册表已锁定".to_string())?;
    if registry.contains_key(request_id) {
        return Err(format!("推理请求 ID 已存在: {request_id}"));
    }
    let (sender, receiver) = oneshot::channel();
    registry.insert(request_id.to_string(), sender);
    Ok(receiver)
}

/// 从注册表移除请求。返回 false 表示请求已由另一路径清理（幂等清理）。
fn remove_inference_cancellation(cell: &InferenceCancellationCell, request_id: &str) -> bool {
    cell.lock()
        .map(|mut registry| registry.remove(request_id).is_some())
        .unwrap_or(false)
}

/// 停止指定推理请求。返回 false 表示请求已不存在（已完成/已停止/已失败或未注册）。
fn cancel_inference_request(cell: &InferenceCancellationCell, request_id: &str) -> bool {
    let Some(sender) = cell
        .lock()
        .ok()
        .and_then(|mut registry| registry.remove(request_id))
    else {
        return false;
    };
    sender.send(()).is_ok()
}

/// 让推理 future 与取消信号竞争。取消分支返回成功 `Stopped`；select 取消 inference
/// future 时，其 TCP read/write half 被丢弃，连接随之关闭。
async fn race_inference_stream_with_cancellation<F>(
    mut cancellation: oneshot::Receiver<()>,
    inference: F,
) -> Result<InferenceStreamOutcome, String>
where
    F: Future<Output = Result<InferenceStreamOutcome, String>>,
{
    tokio::select! {
        outcome = inference => outcome,
        _ = &mut cancellation => Ok(InferenceStreamOutcome::Stopped),
    }
}

/// 客户端信息：版本取自编译期 `CARGO_PKG_VERSION`、操作系统取自编译期平台常量
/// （`std::env::consts::OS` 经友好名映射）。供设置页"客户端信息"展示，不写死。
#[derive(serde::Serialize)]
pub struct AppInfo {
    version: String,
    os: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    let os = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    };
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: os.to_string(),
    }
}

/// 启动/重启 tng：收口配置 → 注入（control_interface.restful + 各 ingress 内部端口、
/// 剥离对外绑定）→ 写 tng-runtime.json → spawn `tng launch` → 按各 ingress 对外绑定起
/// 反代。反代起失败则停 tng（不留 tng 在跑却无对外入口的状态）。返回新子进程 pid。
#[tauri::command]
async fn launch_tng(
    app: AppHandle,
    state: State<'_, AppState>,
    config_json: String,
    rvs_url: String,
) -> Result<u32, String> {
    // 1. 批探测一次取齐「管控端口 + 各 ingress 内部端口」并先验避让对外端口（不对用户暴露）
    let (ctrl, internal_ports) = pick_launch_ports(&config_json).map_err(|e| e.to_string())?;
    // 2. 注入 control_interface.restful + 每条 ingress 内部端口/host=回环（覆盖用户）、
    //    剥离"反代对外绑定"字段不进 tng 配置，并取反代路由（带对外绑定 + 内部端口）与
    //    RA 判定（任一 ingress 开远程证明即须 RA 版二进制）
    let (prepared, routes, ra_required) =
        prepare_launch(&config_json, ctrl, &internal_ports).map_err(|e| e.to_string())?;

    // 3. 写盘到应用数据目录
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取 app_data_dir 失败: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let runtime =
        write_runtime_config(&dir, &prepared).map_err(|e| format!("写 runtime 配置失败: {e}"))?;

    // 4. 先停上一会话残留的反代（若有）；锁序：supervisor 先、proxy 后（与 stop_tng 一致）
    let mut sup = state.supervisor.lock().await;
    // RA 预检（设计 D4）：需要 RA 版而本平台未随包提供时，在停反代/杀旧进程之前拒绝
    // 启动——当前运行会话保持原状，绝不静默回退到普通版。
    ra_launch_precheck(ra_required, sup.ra_bin())?;
    {
        let mut pguard = state.proxy.lock().await;
        if let Some((old, _)) = pguard.take() {
            old.stop().await;
        }
    }

    // 5. spawn tng（不传 --log-file，tng 日志走 stdout 由 GUI 捕获展示）；supervisor 内
    //    会再次按判定选 bin（RA 开而 RA 版缺失时报错不回退，与预检文案一致）。
    let pid = sup
        .launch(&runtime, ra_required, Some(&rvs_url))
        .await
        .map_err(|e| format!("启动 tng 失败: {e}"))?;

    // 6. 起反代：按各 ingress 对外绑定绑 (out_host,out_port)、转发其内部 ingress 端口。
    //    任一绑定失败即整批失败（fail-fast）→ 停 tng 并报错（不留 tng 在跑却缺对外入口）。
    let handle = match start_proxy(routes).await {
        Ok(h) => h,
        Err(e) => {
            sup.kill_current().await;
            return Err(format!("启动反代失败: {e}"));
        }
    };
    let endpoints: ProxyEndpoints = handle
        .endpoints()
        .into_iter()
        .map(|(h, p)| ProxyEndpoint { host: h, port: p })
        .collect();
    {
        let mut pguard = state.proxy.lock().await;
        *pguard = Some((handle, endpoints));
    }

    *state.port.lock().unwrap() = Some(ctrl);
    Ok(pid)
}

/// 停止当前 tng 子进程及其反代。
#[tauri::command]
async fn stop_tng(state: State<'_, AppState>) -> Result<(), String> {
    state.supervisor.lock().await.kill_current().await;
    let mut pguard = state.proxy.lock().await;
    if let Some((handle, _)) = pguard.take() {
        handle.stop().await;
    }
    Ok(())
}

/// 反代对外端点（按 `add_ingress` 顺序）。未启动返回空。
#[tauri::command]
async fn proxy_endpoint(state: State<'_, AppState>) -> Result<ProxyEndpoints, String> {
    let pguard = state.proxy.lock().await;
    Ok(pguard
        .as_ref()
        .map(|(_, eps)| eps.clone())
        .unwrap_or_default())
}

/// 轮询状态。尚未启动 tng 时返回不可达报告（前端显示红灯）。
#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<Value, String> {
    let port = *state.port.lock().unwrap();
    let report = match port {
        Some(p) => fetch_status(p).await,
        None => StatusReport {
            reachable: false,
            livez_ok: false,
            ready: false,
            status_json: Value::Null,
            ingress_ids: serde_json::json!([]),
            ingress_keys: Value::Null,
            ingress_keys_error: None,
            process_error: None,
            error: Some("尚未启动 tng".to_string()),
        },
    };
    serde_json::to_value(report).map_err(|e| e.to_string())
}

/// 取子进程输出快照（stdout/stderr，旧→新）。
#[tauri::command]
async fn get_output(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let sup = state.supervisor.lock().await;
    Ok(sup.log_snapshot())
}

/// 把进程日志快照按原始顺序连接，不追加展示型占位文本。
fn format_process_log_lines(lines: &[String]) -> String {
    lines.join("\n")
}

/// 导出当前 TNG 子进程日志快照到用户所选路径。
#[tauri::command]
async fn export_tng_log(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let lines = {
        let sup = state.supervisor.lock().await;
        sup.log_snapshot()
    };
    std::fs::write(&path, format_process_log_lines(&lines))
        .map_err(|e| format!("写入日志失败 {path}: {e}"))
}

/// 独立设置缓存文件名（不与 runtime 配置混用）。
const SETTINGS_CACHE_FILE: &str = "settings-cache.json";

/// 校验设置缓存信封，但不解析业务字段或凭据。
fn validate_settings_cache_payload(payload: &Value) -> Result<(), &'static str> {
    if !payload.is_object() {
        return Err("设置缓存顶层须为 JSON object");
    }
    if payload.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
        return Err("设置缓存 schemaVersion 须为 1");
    }
    Ok(())
}

/// 读取独立设置缓存；缺失、不可读或 JSON 损坏时返回空 object，
/// schema 校验由前端设置缓存模块继续处理。
fn read_settings_cache_file(dir: &std::path::Path) -> Value {
    let contents = std::fs::read_to_string(dir.join(SETTINGS_CACHE_FILE));
    match contents {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

/// 原子替换设置缓存；内容仅为前端生成的版本化快照。
fn write_settings_cache_file(dir: &std::path::Path, payload: &Value) -> Result<(), String> {
    validate_settings_cache_payload(payload).map_err(|message| message.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("写入设置缓存失败: {e}"))?;

    let path = dir.join(SETTINGS_CACHE_FILE);
    let temp = dir.join(format!("{SETTINGS_CACHE_FILE}.tmp"));
    let mut file = std::fs::File::create(&temp).map_err(|e| format!("写入设置缓存失败: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("写入设置缓存失败: {e}"))?;
    }

    serde_json::to_writer_pretty(&mut file, payload)
        .map_err(|e| format!("写入设置缓存失败: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("写入设置缓存失败: {e}"))?;
    drop(file);

    std::fs::rename(&temp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("写入设置缓存失败: {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::{
        AppState, InferenceCancellationCell, RA_BIN_MISSING, SETTINGS_CACHE_FILE,
        cancel_inference_request, find_bin_under, format_process_log_lines, ra_launch_precheck,
        race_inference_stream_with_cancellation, read_settings_cache_file,
        register_inference_cancellation, run_send_inference_stream, tng_nora_resource_name_for,
        tng_ra_resource_name_for, write_settings_cache_file,
    };
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex as StdMutex};
    use tauri::ipc::Channel;
    use tngui_core::{
        InferenceDelta, InferenceEffort, InferenceMessage, InferenceRole, InferenceStreamOutcome,
        TngSupervisor,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::{Mutex, oneshot};

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tngui-settings-cache-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resource_names_map_platforms_per_distribution_contract() {
        // 普通版：Windows 带 .exe，其余平铺 `tng-nora`（避开 RA 版 `tng.exe` 撞名）。
        assert_eq!(tng_nora_resource_name_for("windows"), "tng-nora.exe");
        assert_eq!(tng_nora_resource_name_for("linux"), "tng-nora");
        assert_eq!(tng_nora_resource_name_for("macos"), "tng-nora");

        // RA 版：与 resources/ 入库 4 文件一一对应。
        assert_eq!(
            tng_ra_resource_name_for("windows", "x86_64"),
            Some("tng.exe")
        );
        assert_eq!(
            tng_ra_resource_name_for("linux", "x86_64"),
            Some("tng-linux-x86_64")
        );
        assert_eq!(
            tng_ra_resource_name_for("linux", "aarch64"),
            Some("tng-linux-aarch64")
        );
        assert_eq!(
            tng_ra_resource_name_for("macos", "aarch64"),
            Some("tng-aarch64-apple-darwin")
        );
        // macOS x86_64 不再受支持；其余未列平台同样无 RA 版（显式 None，非静默）。
        assert_eq!(
            tng_ra_resource_name_for("macos", "x86_64"),
            None,
            "macOS x64 无 RA 版"
        );
        assert_eq!(tng_ra_resource_name_for("windows", "aarch64"), None);
    }

    #[test]
    fn ra_launch_precheck_rejects_only_when_ra_required_and_bin_missing() {
        let err = ra_launch_precheck(true, None).unwrap_err();
        assert_eq!(err, RA_BIN_MISSING);
        assert!(err.contains("远程证明"), "错误应说明 RA 版缺失: {err}");
        assert_eq!(
            ra_launch_precheck(true, Some("/rd/tng-linux-x86_64")),
            Ok(())
        );
        assert_eq!(ra_launch_precheck(false, None), Ok(()));
        assert_eq!(
            ra_launch_precheck(false, Some("/rd/tng-linux-x86_64")),
            Ok(())
        );
    }

    #[test]
    fn find_bin_under_hits_flat_and_one_level_subdir_layouts() {
        let dir = test_dir("resource-bin");
        let name = "tng-linux-x86_64";

        // 平铺命中
        fs::write(dir.join(name), b"bin").unwrap();
        let hit = find_bin_under(&dir, name).unwrap();
        assert_eq!(hit, dir.join(name));

        // 一层子目录命中（Tauri 保留 resources/ 源路径前缀的打包落点）
        fs::remove_file(dir.join(name)).unwrap();
        let nested = dir.join("resources");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join(name), b"bin").unwrap();
        let hit = find_bin_under(&dir, name).unwrap();
        assert_eq!(hit, nested.join(name));

        // 未命中
        fs::remove_file(nested.join(name)).unwrap();
        assert!(find_bin_under(&dir, name).is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn empty_process_log_exports_empty_content() {
        assert_eq!(format_process_log_lines(&[]), "");
    }

    #[test]
    fn process_log_lines_keep_original_order_without_placeholder() {
        let lines = vec!["INFO first".to_string(), "ERROR second".to_string()];
        assert_eq!(format_process_log_lines(&lines), "INFO first\nERROR second");
    }

    #[test]
    fn settings_cache_missing_layout_returns_empty_object() {
        let dir = test_dir("missing");
        assert_eq!(read_settings_cache_file(&dir), json!({}));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn settings_cache_replaces_payload_atomically_and_stays_owner_only_on_unix() {
        let dir = test_dir("write");
        let first = json!({
            "schemaVersion": 1,
            "tng": {"configJson": "{}", "apiKey": "first"}
        });
        write_settings_cache_file(&dir, &first).unwrap();
        let second = json!({
            "schemaVersion": 1,
            "tng": {"configJson": "{}", "apiKey": "second"}
        });
        write_settings_cache_file(&dir, &second).unwrap();

        let path = dir.join(SETTINGS_CACHE_FILE);
        let stored: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(stored, second);
        assert!(
            !dir.read_dir()
                .unwrap()
                .any(|e| { e.unwrap().file_name().to_string_lossy().contains(".tmp") })
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn settings_cache_corrupt_json_returns_empty_object() {
        let dir = test_dir("corrupt");
        fs::write(dir.join(SETTINGS_CACHE_FILE), "{not-json").unwrap();
        assert_eq!(read_settings_cache_file(&dir), json!({}));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn settings_cache_rejects_unsupported_envelopes_without_payload_details() {
        let error = write_settings_cache_file(&test_dir("invalid-root"), &json!("secret-config"))
            .unwrap_err();
        assert_eq!(error, "设置缓存顶层须为 JSON object");

        let error = write_settings_cache_file(
            &test_dir("invalid-schema"),
            &json!({"schemaVersion": 99, "tng": {"apiKey": "secret"}}),
        )
        .unwrap_err();
        assert_eq!(error, "设置缓存 schemaVersion 须为 1");
        assert!(!error.contains("secret"));
    }

    #[test]
    fn inference_cancellation_registry_stops_once_and_is_idempotent() {
        let cell: InferenceCancellationCell = Arc::new(StdMutex::new(HashMap::new()));
        let mut receiver = register_inference_cancellation(&cell, "assistant-1").unwrap();
        assert!(register_inference_cancellation(&cell, "assistant-1").is_err());

        assert!(cancel_inference_request(&cell, "assistant-1"));
        assert_eq!(receiver.try_recv(), Ok(()));
        assert!(!cancel_inference_request(&cell, "assistant-1"));
    }

    fn command_test_state() -> AppState {
        AppState {
            supervisor: Arc::new(Mutex::new(TngSupervisor::new("tng-nora", None, 100))),
            port: Arc::new(StdMutex::new(None)),
            proxy: Arc::new(Mutex::new(None)),
            inference_cancellations: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    async fn read_http_request_safely(stream: &mut tokio::net::TcpStream) -> Vec<u8> {
        let mut buf = Vec::new();
        let header_end = loop {
            let mut tmp = [0u8; 1024];
            let n = stream.read(&mut tmp).await.unwrap();
            if n == 0 {
                break buf.len();
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos;
            }
        };
        let head = String::from_utf8_lossy(&buf[..header_end]);
        let content_length = head
            .lines()
            .skip(1)
            .filter_map(|line| {
                let line = line.trim_end_matches('\r');
                let (key, value) = line.split_once(':')?;
                key.trim()
                    .eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .next()
            .unwrap_or(0);
        let body_start = header_end + 4;
        while buf.len() < body_start + content_length {
            let mut tmp = [0u8; 1024];
            let n = stream.read(&mut tmp).await.unwrap();
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
        }
        buf
    }

    /// 起一个只接受一条推理请求的最小 SSE 服务，返回端口与收到的原始请求。
    async fn spawn_one_sse_server() -> (u16, Arc<StdMutex<Vec<u8>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let seen2 = seen.clone();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_http_request_safely(&mut stream).await;
            *seen2.lock().unwrap() = request;
            let body = "data: [DONE]\n\n";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.flush().await.unwrap();
        });
        (port, seen)
    }

    #[tokio::test]
    async fn inference_command_round_trips_system_prompt_and_none_without_injection() {
        let identity_prompt = "  命令层身份提示\n保留空白  ";
        for (request_id, system_prompt) in [
            ("with-identity", Some(identity_prompt)),
            ("without-identity", None),
        ] {
            let (port, seen) = spawn_one_sse_server().await;
            let state = command_test_state();
            let messages = vec![InferenceMessage {
                role: InferenceRole::User,
                content: "第一轮".to_string(),
            }];
            let channel = Channel::<InferenceDelta>::new(|_| Ok(()));
            run_send_inference_stream(
                &state,
                request_id.to_string(),
                port,
                "command-model".to_string(),
                "command-key".to_string(),
                messages,
                system_prompt.map(str::to_string),
                InferenceEffort::Medium,
                channel,
            )
            .await
            .unwrap();

            let request = String::from_utf8_lossy(&seen.lock().unwrap()).into_owned();
            let body =
                serde_json::from_str::<Value>(request.split_once("\r\n\r\n").unwrap().1).unwrap();
            if let Some(prompt) = system_prompt {
                assert_eq!(body["messages"][0]["role"], json!("system"));
                assert_eq!(body["messages"][0]["content"], json!(prompt));
                assert_eq!(body["messages"][1]["role"], json!("user"));
            } else {
                assert!(
                    !body["messages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|message| message["role"] == json!("system"))
                );
                assert_eq!(body["messages"][0]["role"], json!("user"));
            }
        }
    }

    #[tokio::test]
    async fn raced_inference_stream_returns_stopped_on_cancellation() {
        let (sender, receiver) = oneshot::channel();
        sender.send(()).unwrap();
        let outcome = race_inference_stream_with_cancellation(
            receiver,
            std::future::pending::<Result<InferenceStreamOutcome, String>>(),
        )
        .await
        .unwrap();
        assert_eq!(outcome, InferenceStreamOutcome::Stopped);
    }

    #[tokio::test]
    async fn raced_inference_stream_preserves_normal_completion() {
        let (_sender, receiver) = oneshot::channel::<()>();
        let outcome = race_inference_stream_with_cancellation(receiver, async {
            Ok(InferenceStreamOutcome::Completed)
        })
        .await
        .unwrap();
        assert_eq!(outcome, InferenceStreamOutcome::Completed);
    }
}

/// 导入配置：读用户所选文件路径，返回 JSON 字符串。
#[tauri::command]
fn import_config(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败 {path}: {e}"))
}

/// 导出配置：把 JSON 写入用户所选 save 路径。
#[tauri::command]
fn export_config(path: String, json: String) -> Result<(), String> {
    std::fs::write(&path, json).map_err(|e| format!("写入失败 {path}: {e}"))
}

/// 读取独立设置缓存，供 GUI 启动 bootstrap 使用；缺失/损坏返回空 object。
#[tauri::command]
fn load_settings_cache(app: AppHandle) -> Result<Value, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取 app_data_dir 失败: {e}"))?;
    Ok(read_settings_cache_file(&dir))
}

/// 应用正常关闭前 flush 当前设置快照。输入由前端生成；后端不解析凭据或 TNG 配置。
#[tauri::command]
fn flush_settings_cache(app: AppHandle, payload: Value) -> Result<(), String> {
    if let Err(message) = validate_settings_cache_payload(&payload) {
        // 该静态错误不携带 payload。
        return Err(message.to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取 app_data_dir 失败: {e}"))?;
    write_settings_cache_file(&dir, &payload).map(|_| ())
}

/// 仅保存 TNG 配置到磁盘（不 spawn）。
#[tauri::command]
async fn save_config(app: AppHandle, config_json: String) -> Result<(), String> {
    // 仅校验用户侧配置（不注入 control_interface.restful）——保存的配置对用户可见、不含管控端口
    let validated = sanitize_user_config_for_tng(&config_json).map_err(|e| e.to_string())?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取 app_data_dir 失败: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    write_runtime_config(&dir, &validated).map_err(|e| format!("写 runtime 配置失败: {e}"))?;
    Ok(())
}

/// 通过 tngui 反代对外端点发送流式多轮推理请求（`x-model` 由反代按 body.model 注入，
/// 此处不注），body 恒含 `"stream": true` 与思考强度。每节非空
/// `choices[0].delta.reasoning` / `choices[0].delta.content` 经 typed `on_delta`
/// Channel 推送；收到 `data: [DONE]` 后命令成功返回。任何失败（连接失败、非 2xx、
/// 非 SSE 响应、SSE 解析失败、`[DONE]` 前断流、响应超上限）返回既有格式诊断
/// `system_prompt` 是调试页专用快照；`None` 不注入 system role。
/// （Authorization 脱敏）。`port` 为反代对外端口（前端取自 `proxy_endpoint`）。
#[allow(clippy::too_many_arguments)] // Flat parameters preserve the typed Tauri IPC contract.
async fn run_send_inference_stream(
    state: &AppState,
    request_id: String,
    port: u16,
    model: String,
    api_key: String,
    messages: Vec<InferenceMessage>,
    system_prompt: Option<String>,
    reasoning_effort: InferenceEffort,
    on_delta: Channel<InferenceDelta>,
) -> Result<InferenceStreamOutcome, String> {
    let cancellation =
        register_inference_cancellation(&state.inference_cancellations, &request_id)?;
    let outcome = race_inference_stream_with_cancellation(
        cancellation,
        tngui_core::send_inference_stream(
            port,
            &model,
            &api_key,
            &messages,
            system_prompt.as_deref(),
            reasoning_effort,
            |delta| {
                let _ = on_delta.send(delta);
            },
        ),
    )
    .await;
    remove_inference_cancellation(&state.inference_cancellations, &request_id);
    outcome
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Flat parameters preserve the typed Tauri IPC contract.
async fn send_inference_stream(
    state: State<'_, AppState>,
    request_id: String,
    port: u16,
    model: String,
    api_key: String,
    messages: Vec<InferenceMessage>,
    system_prompt: Option<String>,
    reasoning_effort: InferenceEffort,
    on_delta: Channel<InferenceDelta>,
) -> Result<InferenceStreamOutcome, String> {
    run_send_inference_stream(
        &state,
        request_id,
        port,
        model,
        api_key,
        messages,
        system_prompt,
        reasoning_effort,
        on_delta,
    )
    .await
}

/// 按 request_id 请求停止进行中的推理流。无活跃请求时返回 false，不报错（幂等）。
#[tauri::command]
fn stop_inference_stream(state: State<'_, AppState>, request_id: String) -> Result<bool, String> {
    Ok(cancel_inference_request(
        &state.inference_cancellations,
        &request_id,
    ))
}

/// 从本地 pre-TNG proxy 获取模型清单，不发送 inference API Key。
#[tauri::command]
async fn list_models(port: u16) -> Result<Vec<String>, String> {
    tngui_core::list_models(port).await
}

/// 普通版 tng（远程证明全关时使用）的随包资源名：Windows 为 `tng-nora.exe`、其余平台
/// 为 `tng-nora`。CI release 下载官方 tng 产物后放此名——与 RA 版的 `tng.exe` 撞名规避。
fn tng_nora_resource_name_for(os: &str) -> &'static str {
    match os {
        "windows" => "tng-nora.exe",
        _ => "tng-nora",
    }
}

fn tng_nora_resource_name() -> &'static str {
    tng_nora_resource_name_for(std::env::consts::OS)
}

/// RA 版 tng（任一条 ingress 开远程证明时使用）的资源名平台映射——与直接入库
/// `resources/` 的 4 个文件一一对应。未列平台（含 macOS x86_64——该架构不再受支持）
/// 返回 `None`：RA 启用时明确报错，绝不（MUST NOT）回退普通版或 `PATH`。
fn tng_ra_resource_name_for(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("windows", "x86_64") => Some("tng.exe"),
        ("linux", "x86_64") => Some("tng-linux-x86_64"),
        ("linux", "aarch64") => Some("tng-linux-aarch64"),
        ("macos", "aarch64") => Some("tng-aarch64-apple-darwin"),
        _ => None,
    }
}

fn tng_ra_resource_name() -> Option<&'static str> {
    tng_ra_resource_name_for(std::env::consts::OS, std::env::consts::ARCH)
}

/// 在资源根下按名查找二进制：1）平铺 `base/<name>`；2）一层子目录
/// `base/<子目录>/<name>`（Tauri 打包保留 `resources/` 源路径前缀，两种落点均兼容）。
fn find_bin_under(base: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    let direct = base.join(name);
    if direct.exists() {
        return Some(direct);
    }
    let entries = std::fs::read_dir(base).ok()?;
    for e in entries.flatten() {
        let p = e.path().join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// 从 `resource_dir` 按名解析随包二进制；未命中返回 `None`。
fn resolve_resource_bin(app: &tauri::App, name: &str) -> Option<String> {
    let rd = app.path().resource_dir().ok()?;
    find_bin_under(&rd, name).map(|p| p.to_string_lossy().into_owned())
}

/// RA 版缺失时拒绝启动的文案（与 `TngSupervisor::select_bin` 的防御性报错一致：
/// `tngui-core` 不感知 Tauri 资源解析，两处各自兜底、语义同源）。
const RA_BIN_MISSING: &str = "当前平台未随包提供远程证明版 tng 二进制；开启远程证明需要该版本";

/// 启动前 RA 预检：需要 RA 版而其二进制不可用时拒绝本次启动。必须在停反代/杀旧
/// 进程之前调用（见 `launch_tng`），保证正在运行的会话不被终止。
fn ra_launch_precheck(ra_required: bool, ra_bin: Option<&str>) -> Result<(), String> {
    if ra_required && ra_bin.is_none() {
        Err(RA_BIN_MISSING.to_string())
    } else {
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 普通版：resource_dir 命中即用；缺失回退 PATH 上的 `tng`（开发态兜底）。
            let nora = resolve_resource_bin(app, tng_nora_resource_name())
                .unwrap_or_else(|| "tng".to_string());
            // RA 版：按平台映射名从 resource_dir 解析；平台不支持或文件缺失为 None——
            // RA 启用时由 launch_tng 预检拒绝，绝不静默回退普通版。
            let ra = tng_ra_resource_name().and_then(|name| resolve_resource_bin(app, name));
            app.manage(AppState {
                supervisor: Arc::new(Mutex::new(TngSupervisor::new(nora, ra, 4000))),
                port: Arc::new(StdMutex::new(None)),
                proxy: Arc::new(Mutex::new(None)),
                inference_cancellations: Arc::new(StdMutex::new(HashMap::new())),
            });
            Ok(())
        })
        .invoke_handler(generate_handler![
            launch_tng,
            stop_tng,
            proxy_endpoint,
            get_status,
            get_output,
            export_tng_log,
            import_config,
            export_config,
            load_settings_cache,
            flush_settings_cache,
            save_config,
            send_inference_stream,
            stop_inference_stream,
            list_models,
            app_info
        ])
        .run(generate_context!())
        .expect("启动 Tauri 失败");
}
