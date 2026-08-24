# 任务清单

参照 `specs/gui-shell/spec.md` 与 `design.md`。决策：tng 走 Tauri `resources` 随包分发 + 运行时 `resource_dir`→PATH 兜底；CI 下载 TNG 官方 5 目标产物组装 release；win-arm64 非目标。

> 构建机环境：本机 headless 仍无法编译 Tauri/跑 CI。可本机验：`cargo metadata`（manifest）、`YAML/JSON` 合法性。Tauri 编译/打包、CI tag 触发、安装后运行期——须在带 WebKitGTK/WebView2 的机器与 GitHub 上验证。

## 1. 运行时 tng 发现（外壳）

- [x] 1.1 改 `src-tauri/src/lib.rs`：在 `run()` 用 `.setup(|app|{})` 解析 tng 路径——`app.path().resource_dir()` 下找 `tng`（Windows `tng.exe`），不存在则用 `"tng"`（PATH 兜底）；传 `TngSupervisor::new(path, 4000)`。`tngui-core` 不动。 ✓ 代码就位；`cargo metadata` 解析通过；运行期命中/兜底待端到端。

## 2. Tauri 打包配置

- [x] 2.1 改 `tauri.conf.json`：`bundle.active=true`、`bundle.resources=["resources/tng*"]`、`bundle.icon=[ico,icns,png]`。用 PIL 由 `icon.ico` 生成 `icons/icon.png`/`icon.icns`（占位，建议日后 `cargo tauri icon` 重生）。 ✓ JSON 合法、bundle 段已验；打包产物含 tng 待 CI。
- [x] 2.2 `.gitignore` 增 `/resources/`（CI 每目标填入，不入库）。 ✓

## 3. 版本钉

- [x] 3.1 仓库根新增 `TNG_VERSION`（= `2.8.0`），CI 读取拼下载 URL。 ✓ 文件就位；release.yml 的 "Read TNG version" 步读它。

## 4. GitHub Action：tag 触发 release

- [x] 4.1 新增 `.github/workflows/release.yml`：`on: push.tags v*.*.*` + `workflow_dispatch`；`tauri-action` 以 `releaseDraft:true` 上传草稿 release（body 含分发说明）。 ✓ YAML 合法。
- [x] 4.2 matrix 5 目标（见设计 §5）：每目标读 `TNG_VERSION` → 下载 `…/v<ver>/tng-<ver>.<tng_target>.<ext>` → 解包（zip 取 `tng.exe`；tar.gz 用 find 取 `usr/.../tng`）→ 放 `resources/<tng_bin>`。 ✓ 步骤就位；首次 CI 验资产命名/解包路径。
- [x] 4.3 每目标装 Tauri 系统依赖 + node + `npm ci`（frontend）+ `tauri-action --target <target>` 打包上传。 ✓ 相关步就位。
- [x] 4.4 linux-arm64 交叉：arm64 apt 源 + `gcc-aarch64-linux-gnu` + `:arm64` 依赖 + `PKG_CONFIG_*`/linker env。 ✓ 步骤就位（仿 clash-verge）；首次 CI 可能需按 runner 实际微调。

## 5. 发布与后续

- [x] 5.1 release body 写明：5 目标安装包各自内置对应 tng（取自 TNG 官方 v<TNG_VERSION>）；macOS 未签名（Gatekeeper）；win-arm64 列后续。 ✓ 已写入 `releaseBody`。
- [x] 5.2 `README.md` 记"tng 随包分发、`TNG_VERSION` 钉版本、win-arm64 待后续、macOS 暂未签名、图标占位"。 ✓ 已创建 README。

## 6. 端到端（CI tag 触发后）

- [ ] 6.1 打一个测试 tag 触发 CI：5 目标全部产物上传成功（无红）。
- [ ] 6.2 任取一个已装包（如 windows-x64 / linux-x64）：安装后启动 GUI → 渲染窗口 → 首页状态灯（tng 未跑 = 红/不可达）。
- [ ] 6.3 配置页填默认模板 → 启动/重启 → GUI 从随包资源拉起 tng（非 PATH）→ 灯 红→黄→绿，`/status/` 显示 ingress 索引，输出区干净。（确认 "随包分发命中" 场景）
- [ ] 6.4 开发态回退：本机 `cargo run`（resources 空）→ 仍能靠 PATH 上的 tng 启动（确认 "PATH 兜底" 场景）。