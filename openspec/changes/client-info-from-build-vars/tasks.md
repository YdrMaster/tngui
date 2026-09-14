## 1. 后端暴露编译期信息

- [ ] 1.1 `src/lib.rs` 新增 `AppInfo { version: String, os: String }`（serde 序列化）与 `#[tauri::command] fn app_info() -> AppInfo`：`version = env!("CARGO_PKG_VERSION")`，`os` 由 `std::env::consts::OS` 映射友好名（windows→Windows、macos→macOS、linux→Linux，其余回退原值） — verify：`cargo build -p tngui-app`（或在不具备 GUI 系统依赖的环境下由实现方在目标平台）通过；并保持 `cargo check -p tngui-core` 不受影响
- [ ] 1.2 在 `generate_handler![...]` 注册 `app_info` — verify：handler 列表含 `app_info`；`cargo build -p tngui-app`/`cargo check` 成功

## 2. 前端取值与渲染

- [x] 2.1 `frontend/src/tauri.ts` 新增 `appInfo()` 包装 `invoke<AppInfo>("app_info")` — verify：`npx vue-tsc --noEmit` 无类型错误
- [x] 2.2 `frontend/src/views/SettingsView.vue` 于挂载时 invoke `app_info()`，将返回值绑定到"客户端版本""操作系统"描述项，替换硬编码 `v0.2.1-dev`/`Desktop`；失败回落占位"未知" — verify：`npx vue-tsc --noEmit` 通过；渲染值来自命令而非字面量

## 3. 校验与收尾

- [x] 3.1 `openspec validate client-info-from-build-vars` 通过 — verify：命令退出码 0
- [x] 3.2 前端 `npx vue-tsc --noEmit` 无类型错误、`npx vitest run` 不回归 — verify：两者退出码 0
- [ ] 3.3 人工冒烟（目标平台）："客户端信息"卡"客户端版本"=CARGO_PKG_VERSION、"操作系统"=对应平台友好名 — verify：观察到如述
