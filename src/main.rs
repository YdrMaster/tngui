// 防止某些构建配置下无 main 警告；桌面端经此入口。
#![cfg_attr(not(any(desktop, mobile)), allow(dead_code))]
// Windows：release 用 GUI 子系统（无控制台黑窗），debug 保留控制台便于看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tngui_app_lib::run()
}
