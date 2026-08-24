## Why

MVP/测试期 GUI 假定 `tng` 在 PATH（D4：手工编译后放 PATH）。面向最终用户分发时，`tng` 必须随软件一起打包、运行时从打包目录里被发现，并由 CI 按 tag 自动把各平台的官方 tng 产物组装进 release。本变更把"PATH 假定 + 手工 tng"演进为"随包分发 + CI 自动取官方 tng 产物"的正式分发形态。

## What Changes

- **运行时发现**：GUI 启动/重启 tng 时，从随包资源目录（Tauri `resource_dir`）解析 `tng`（Windows 为 `tng.exe`）；未找到则回退 PATH 上的 `tng`（开发态 `cargo run` 时用）。解析出的完整路径传给既有 `TngSupervisor`，`tngui-core` 不变。
- **打包**：`tauri.conf.json` 开 `bundle.resources`，把 `tng`/`tng.exe` 作为资源随包发布；重新打开 `bundle.active` 并补齐平台图标。CI 每目标把对应 tng 放进 `src-tauri/resources/` 后再打包。
- **CI（新增 GitHub Action）**：tag `v*.*.*` 触发（+ `workflow_dispatch`）。每目标从 `inclavare-containers/TNG` 官方 release 下载对应 tng 产物（版本由 `TNG_VERSION` 钉 tag）→ 解包 → 放 `src-tauri/resources/` → `tauri-action` 打包 GUI 并上传到 release。**5 目标**：windows-x64、linux-x64、linux-arm64、macos-x64、macos-arm64。
- **非目标（本期不做）**：windows-arm64（`aarch64-pc-windows-msvc`）——TNG 无官方 win-arm64 产物，本期不发布该目标，列为后续（等 TNG 上游发布或单开自行编译 job）。
- **不改**：三契约命令（`launch_tng`/`get_status`/`get_output`）、`tngui-core`、前端；松耦合不破（GUI 仍不链接任何 tng 代码，tng 是独立进程）。

## Capabilities

### New Capabilities
<!-- 无新能力。CI/release 作为构建基础设施写进 design/tasks，不入 spec 行为契约。 -->

### Modified Capabilities
- `gui-shell`: 新增"tng 二进制发现"需求——随软件分发（Tauri resources）、运行时从 `resource_dir` 解析 `tng`/`tng.exe`、PATH 兜底。既有"对 tng 的松耦合"场景（替换 tng 无需重编 GUI）仍成立——替换资源目录里的 tng 文件即可。

## Impact

- `src-tauri/src/lib.rs`（`run()` 处）：解析 tng 路径（`resource_dir` → PATH 兜底），把完整路径传 `TngSupervisor::new(path, …)`。
- `tauri.conf.json`：`bundle.resources = ["resources/tng*"]`、重开 `bundle.active`、补齐 mac/linux 图标。
- 新增 `src-tauri/resources/`（`.gitignore` 忽略，CI 每目标填入对应 tng）。
- 新增 `.github/workflows/release.yml`：tag 触发、5 目标 matrix、下载 TNG 官方产物 + `tauri-action` 打包上传。
- 外部依赖：TNG 官方 release 资产可达；`TNG_VERSION` 钉 tag（当前 `2.8.0`，可配置）。
- 对最终用户：从"需自行把 tng 放 PATH"变为"装 GUI 即带 tng"。开发态仍可用 PATH 兜底。
- 非目标：win-arm64；tng 自行编译（X）；持久化/多 profile 仍不做。