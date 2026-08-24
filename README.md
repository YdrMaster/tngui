# tngui — TNG GUI 包装器

TNG（可信网络网关）的桌面 GUI 包装器：配置编辑 + 启停 + 只读状态/日志。
与 tng **松耦合**——不链接任何 tng 代码，仅通过 (A) `tng launch` CLI、(B) 只读控制面 REST、(C) 子进程输出捕获 三条契约对接。

## 开发

```bash
# 前端
cd frontend && npm install        # Vue 3 + Vite + Ant Design Vue
# 核心 + 外壳（需 WebKitGTK/WebView2）
cargo test -p tngui-core          # 核心逻辑单测
cargo tauri dev                   # 开发态开窗（开发期 tng 走 PATH 兜底）
```

开发期 `tng` 需自行编译并放到 `PATH`（运行时 `resource_dir` 无随包 tng 时回退 PATH）。

## 分发（随包 tng + CI）

- `tng` 随 GUI 打包分发（Tauri `bundle.resources = ["resources/tng*"]`），运行时从 `resource_dir` 解析 `tng`/`tng.exe`；找不到回退 `PATH`。
- CI（`.github/workflows/release.yml`）在 tag `v*.*.*` 触发：从 [inclavare-containers/TNG](https://github.com/inclavare-containers/TNG) 官方 release 下载 5 目标 tng 产物 → 放 `resources/` → `tauri-action` 打包上传草稿 release。
- tng 版本由仓库根 `TNG_VERSION` 钉定（当前 2.8.0），与 tngui 版本解耦；升 tng 改这一处。

### 发布目标（5）

| 平台 | 目标 | tng 来源 |
|---|---|---|
| Windows x86_64 | `x86_64-pc-windows-msvc` | TNG `x86_64-pc-windows-gnu`（gnu 版自包含可运行） |
| Linux x86_64 | `x86_64-unknown-linux-gnu` | TNG 同名 |
| Linux aarch64 | `aarch64-unknown-linux-gnu` | TNG 同名 |
| macOS x86_64 | `x86_64-apple-darwin` | TNG 同名 |
| macOS aarch64 | `aarch64-apple-darwin` | TNG 同名 |

### 已知限制 / 后续

- **Windows ARM64** 未发布——TNG 无官方 win-arm64 产物，列为后续（等上游或单开自编 job）。
- **macOS 未签名**——首次打开需 Gatekeeper 放行；正式签名/公证待后续。
- 图标为占位（由 `icons/icon.ico` 放大生成）；建议日后用 `cargo tauri icon <高清源>` 重生一套。