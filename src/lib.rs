//! Tauri 2 外壳：把 #[tauri::command] 接到 tngui-core 的核心逻辑上。
//!
//! 主要命令：
//! - `launch_tng`：收口配置 → 注入（含 ingress 内部端口、剥离对外绑定）→ 写盘 → spawn
//!   `tng launch` → 起反代（按各 ingress 对外绑定）
//! - `stop_tng`：停 tng 子进程 + 停反代
//! - `proxy_endpoint`：暴露反代各 ingress 对外端点（供前端渲染 `API Base URL` 与推理目标）
//! - `get_status`：轮询控制面 `/livez|/readyz|/status/`
//! - `get_output`：取子进程 stdout/stderr 快照
//! - `send_inference`：经反代对外端点发推理（`x-model` 由反代注入，此处不注）

use std::sync::{Arc, Mutex as StdMutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri::{Builder, generate_context, generate_handler};
use tokio::sync::Mutex;

use tngui_core::{
    ProxyHandle, StatusReport, TngSupervisor, fetch_status, pick_launch_ports, prepare_launch,
    start_proxy, validate_user_config, write_runtime_config,
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
) -> Result<u32, String> {
    // 1. 批探测一次取齐「管控端口 + 各 ingress 内部端口」并先验避让对外端口（不对用户暴露）
    let (ctrl, internal_ports) = pick_launch_ports(&config_json).map_err(|e| e.to_string())?;
    // 2. 注入 control_interface.restful + 每条 ingress 内部端口/host=回环（覆盖用户）、
    //    剥离"反代对外绑定"字段不进 tng 配置，并取反代路由（带对外绑定 + 内部端口）
    let (prepared, routes) =
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
    {
        let mut pguard = state.proxy.lock().await;
        if let Some((old, _)) = pguard.take() {
            old.stop().await;
        }
    }

    // 5. spawn tng（不传 --log-file，tng 日志走 stdout 由 GUI 捕获展示）
    let pid = sup
        .launch(&runtime)
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

/// 仅保存 TNG 配置到磁盘（不 spawn）。
#[tauri::command]
async fn save_config(app: AppHandle, config_json: String) -> Result<(), String> {
    // 仅校验用户侧配置（不注入 control_interface.restful）——保存的配置对用户可见、不含管控端口
    let validated = validate_user_config(&config_json).map_err(|e| e.to_string())?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取 app_data_dir 失败: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    write_runtime_config(&dir, &validated).map_err(|e| format!("写 runtime 配置失败: {e}"))?;
    Ok(())
}

/// 通过 tngui 反代对外端点发送推理请求（`x-model` 由反代按 body.model 注入，此处不注），
/// 返回 assistant 响应文本。`port` 为反代对外端口（前端取自 `proxy_endpoint`）。
#[tauri::command]
async fn send_inference(
    port: u16,
    model: String,
    api_key: String,
    prompt: String,
) -> Result<String, String> {
    tngui_core::send_inference(port, &model, &api_key, &prompt).await
}

/// 解析随包分发的 tng：在 `resource_dir` 下找 `tng`/`tng.exe`（兼容平铺与 `resources/` 子目录两种打包落点）；
/// 找不到回退 `PATH` 上的 `tng`（开发态）。
fn resolve_tng_path(app: &tauri::App) -> String {
    use std::fs;
    let name = if cfg!(windows) { "tng.exe" } else { "tng" };
    if let Ok(rd) = app.path().resource_dir() {
        // 1) 平铺：resource_dir/<name>
        let direct = rd.join(name);
        if direct.exists() {
            return direct.to_string_lossy().into_owned();
        }
        // 2) 一层子目录：Tauri 会保留源路径前缀（resources/tng* → resource_dir/resources/<name>）
        if let Ok(entries) = fs::read_dir(&rd) {
            for e in entries.flatten() {
                let p = e.path().join(name);
                if p.exists() {
                    return p.to_string_lossy().into_owned();
                }
            }
        }
    }
    "tng".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let tng = resolve_tng_path(app);
            app.manage(AppState {
                supervisor: Arc::new(Mutex::new(TngSupervisor::new(tng, 4000))),
                port: Arc::new(StdMutex::new(None)),
                proxy: Arc::new(Mutex::new(None)),
            });
            Ok(())
        })
        .invoke_handler(generate_handler![
            launch_tng,
            stop_tng,
            proxy_endpoint,
            get_status,
            get_output,
            import_config,
            export_config,
            save_config,
            send_inference,
            app_info
        ])
        .run(generate_context!())
        .expect("启动 Tauri 失败");
}
