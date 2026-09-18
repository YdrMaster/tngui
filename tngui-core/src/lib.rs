//! TNG GUI 包装器核心逻辑。
//!
//! 与 tng 的全部交互仅通过三条稳定契约（见设计稿 §3）：
//! - 契约 A：拉起 `tng launch -c … --log-file …` 子进程
//! - 契约 B：对 `127.0.0.1:<端口>` 只读 REST 轮询
//! - 契约 C：捕获子进程 stdout/stderr
//!
//! 本 crate 不链接任何 TNG 代码，纯逻辑可脱离 webview 单独编译与测试。

pub mod config;
pub mod inference;
pub mod log;
pub mod models;
pub mod process;
pub mod proxy;
pub mod status;

pub use config::{
    PrepareError, TNGUI_RVS_URL_FIELD, control_port, pick_free_port, pick_free_ports,
    pick_launch_ports, prepare_config, prepare_launch, sanitize_user_config_for_tng,
    validate_user_config, write_runtime_config,
};
pub use inference::{
    InferenceDelta, InferenceDeltaKind, InferenceEffort, InferenceMessage, InferenceRole,
    InferenceStreamOutcome, send_inference_stream,
};
pub use log::BoundedLog;
pub use models::{list_models, parse_model_list};
pub use process::{ManagedChild, TngSupervisor, kill_group, spawn_managed};
pub use proxy::{ProxyHandle, ProxyRoute, start_proxy};
pub use status::{StatusReport, fetch_status};
