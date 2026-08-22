// 防止某些构建配置下无 main 警告；桌面端经此入口。
#![cfg_attr(not(any(desktop, mobile)), allow(dead_code))]

fn main() {
    tngui_app_lib::run()
}
