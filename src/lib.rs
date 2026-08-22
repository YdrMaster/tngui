//! Tauri 2 外壳：把 #[tauri::command] 接到 tngui-core 的核心逻辑上。
//!
//! 三条命令：
//! - `launch_tng`：收口配置 → 写盘 →（重启）spawn `tng launch`
//! - `get_status`：轮询控制面 `/livez|/readyz|/status/`
//! - `get_output`：取子进程 stdout/stderr 快照

use std::sync::{Arc, Mutex as StdMutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri::{Builder, generate_context, generate_handler};
use tokio::sync::Mutex;

use tngui_core::{
    StatusReport, TngSupervisor, control_port, fetch_status, prepare_config, write_runtime_config,
};

/// 进程分享的控制端口；启动后写入，状态轮询读取。
type PortCell = Arc<StdMutex<Option<u16>>>;

#[derive(Clone)]
pub struct AppState {
    supervisor: Arc<Mutex<TngSupervisor>>,
    port: PortCell,
}

/// 启动/重启 tng：收口配置 → 写 tng-runtime.json → spawn `tng launch`。
/// 返回新子进程 pid。
#[tauri::command]
async fn launch_tng(
    app: AppHandle,
    state: State<'_, AppState>,
    config_json: String,
) -> Result<u32, String> {
    // 1. 解析 + 安全收口（强制 127.0.0.1、缺 port 报错）
    let prepared = prepare_config(&config_json).map_err(|e| e.to_string())?;
    let port = control_port(&prepared)
        .ok_or_else(|| "无法读取 control_interface.restful.port".to_string())?;

    // 2. 写盘到应用数据目录
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取 app_data_dir 失败: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let runtime =
        write_runtime_config(&dir, &prepared).map_err(|e| format!("写 runtime 配置失败: {e}"))?;
    let log_file = dir.join("tng.log");

    // 3. （重启）spawn
    let mut sup = state.supervisor.lock().await;
    let pid = sup
        .launch(&runtime, &log_file)
        .await
        .map_err(|e| format!("启动 tng 失败: {e}"))?;

    *state.port.lock().unwrap() = Some(port);
    Ok(pid)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .manage(AppState {
            supervisor: Arc::new(Mutex::new(TngSupervisor::new("tng", 4000))),
            port: Arc::new(StdMutex::new(None)),
        })
        .invoke_handler(generate_handler![launch_tng, get_status, get_output])
        .run(generate_context!())
        .expect("启动 Tauri 失败");
}
