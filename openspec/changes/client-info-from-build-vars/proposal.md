## Why

设置页"客户端信息"卡当前把"客户端版本"写死为 `v0.2.1-dev`、"操作系统"写死为 `Desktop`，与实际打包/运行不符：`tngui-app` 的 workspace 版本已是 `0.3.0`、且会跨 Windows/Linux/macOS 运行。写死值会误导诊断与用户。需要从编译期变量取真实版本与操作系统。

## What Changes

- 设置页"客户端信息"卡的"客户端版本"取自编译期变量 `CARGO_PKG_VERSION`（`tngui-app` crate，workspace 版本）；"操作系统"取自编译期平台常量（`std::env::consts::OS`，必要时附带 `ARCH`），按平台展示友好名（windows→Windows、macos→macOS、linux→Linux）。
- 经一项 Tauri 命令（`app_info`）把上述编译期值暴露给前端；前端在设置页挂载时获取并渲染，替换硬编码字符串。
- 仅替换这两项的取值来源与渲染，不改其余"客户端信息"项（如"更新通道"）。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `gui-shell`：新增"设置页客户端信息展示编译期版本与操作系统"要求，规定客户端版本取自 `CARGO_PKG_VERSION`、操作系统取自编译期平台常量、不得写死。

## Impact

- 后端：`src/lib.rs`（新增 `AppInfo { version, os }` 与 `#[tauri::command] fn app_info() -> AppInfo`，`version = env!("CARGO_PKG_VERSION")`、`os` 由 `std::env::consts::OS` 映射友好名；在 `generate_handler!` 注册）。`Cargo.toml` 无需改（沿用 workspace `version = "0.3.0"`）。
- 前端：`frontend/src/tauri.ts`（新增 `appInfo()` 包装 `invoke("app_info")`）；`frontend/src/views/SettingsView.vue`（挂载时 invoke `app_info`，绑定到"客户端版本""操作系统"描述项，替换 `v0.2.1-dev`/`Desktop` 硬编码）。
- 不在范围内：不改其它写死项（"更新通道 稳定版(OTA)"；及 gateway-state 卡的"TNG v0.2.1"——后者是 `tng` 二进制版本，与"客户端版本"不同源，留作后续）。
