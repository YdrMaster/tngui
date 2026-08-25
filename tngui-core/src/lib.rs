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
pub mod process;
pub mod status;

pub use config::{PrepareError, control_port, prepare_config, write_runtime_config};
pub use inference::send_inference;
pub use log::BoundedLog;
pub use process::{ManagedChild, TngSupervisor, kill_group, spawn_managed};
pub use status::{StatusReport, fetch_status};
