# tngui — TNG GUI 包装器

TNG（可信网络网关）的桌面 GUI 包装器：配置编辑 + 启停 + 只读状态/日志。
与 tng **松耦合**——不链接任何 tng 代码，仅通过 (A) `tng launch` CLI、(B) 只读控制面 REST、(C) 子进程输出捕获 三条契约对接。tngui 是图形操作系统上的 client-side `pre-tng-proxy` 与 `tng-ingress` 特化实现，不定义服务端授权、全局模型注册或跨组件路由。

跨组件语义以 `trust-inference` 仓库中的中心契约为准；本仓库只描述 tngui 自身行为，不复制或改写中心契约。本地文档边界见 [docs/tngui-doc-boundaries.md](docs/tngui-doc-boundaries.md)。

tngui 自带本机 pre-TNG reverse proxy。对 `POST /v1/chat/completions` 与 `POST /v1/messages`，它读取请求体顶层字符串 `body.model`，把该确切模型字符串编码为单一 URI path segment 生成 `/models/{encoded-model-segment}{original-path}`，并保留 query、credential header 和原始 body 字节。path 生成不做本地认证或路由决策；`x-model` 不作为模型身份。例如：`{"model":"auto"}` 对应 `/models/auto/...`；`{"model":"provider/model"}` 对应 `/models/provider%2Fmodel/...`。

对精确的 `GET /v1/models`，tngui 保留原始 query 与 `Authorization` / `x-api-key` 业务认证头，直接发往当前 ingress 指向的 capi origin。这是 tngui 本地模型发现例外：不经 tng ingress，也不进入 OHTTP / RA 链路，不做模型 path 注入或 body 改写；若 capi origin 缺失、无效或不可达，返回明确的模型发现失败响应，而不是空模型清单。该例外的中心安全边界和 capi origin 来源当前 unresolved；tngui 不据此声明全局模型目录、注册或路由能力。推理请求仍通过 TNG 加密与远程证明链路。

反代另有当前会话内的本地诊断快照：界面展示运行状态和身份通过/身份拒绝、请求过大、模型发现成功/发现失败、上游失败计数。快照只在 tngui 进程内存中随当前反代生命周期存在，重启重置，不发送到外部 collector；固定诊断类别不携带模型名、prompt、output、raw API key 或 attestation token，也不表示模型授权结果。

## 开发

```bash
# 前端
cd frontend && npm install        # Vue 3 + Vite + Ant Design Vue
# 核心 + 外壳（需 WebKitGTK/WebView2）
cargo test -p tngui-core          # 核心逻辑单测
cargo tauri dev                   # 开发态开窗（开发期 tng 走 PATH 兜底）
```

> Ant Codespace 中直接运行 Rust 测试会遇到宿主 glibc 兼容性问题，请按 [docs/ant-codespace-testing.md](docs/ant-codespace-testing.md) 使用 Ubuntu chroot 并单线程运行 workspace 测试。

开发期普通版 `tng` 需自行编译并放到 `PATH`（运行时 `resource_dir` 无 `tng-nora` 时回退 PATH）；远程证明（RA）版已随仓库 `resources/` 直接可用。

## 分发（双套 tng：普通版 + 远程证明版 + CI）

启动/重启 tng 时按远程证明开关选择二进制：任一条 ingress 开启远程证明（`no_ra` 非 `true`）→ 用 RA 版；全部关闭 → 用普通版。RA 版缺失时拒绝启动并明确报错，绝不静默回退普通版。

- **普通版**（RA 全关时使用）：CI release 时从 [inclavare-containers/TNG](https://github.com/inclavare-containers/TNG) 官方 release 下载产物，放置为 `resources/tng-nora`（Unix）/`resources/tng-nora.exe`（Windows）——与 RA 版的 `tng.exe` 撞名规避；运行时从 `resource_dir` 解析，缺失回退 `PATH` 上的 `tng`（开发态）。
- **远程证明版（RA 版）**（任一 ingress 开 RA 时使用）：直接储存在仓库 `resources/` 内（不入 CI 下载），按平台命名——Windows x64 为 `tng.exe`、Linux x86_64 为 `tng-linux-x86_64`、Linux aarch64 为 `tng-linux-aarch64`、macOS aarch64 为 `tng-aarch64-apple-darwin`；运行时从 `resource_dir` 按平台解析，不回退。
- 随包打包（Tauri `bundle.resources = ["resources/tng*"]`）同时收入两套；CI 每目标构建前移除其他平台的 RA 文件（防安装包跨平台死重），并断言本平台 RA 文件存在。
- CI（`.github/workflows/ci.yaml`）在 tag `v*.*.*` 触发：下载 TNG 官方普通版产物 → 放 `resources/tng-nora*` → `tauri-action` 打包上传草稿 release。
- 普通版 tng 版本由仓库根 `TNG_VERSION` 钉定（当前 2.9.2），与 tngui 版本解耦，升 tng 改这一处；RA 版版本由 git 提交钉定。

### 发布目标（4）

| 平台 | 目标 | 普通版 tng 来源 | 远程证明版 tng（仓库内置） |
|---|---|---|---|
| Windows x86_64 | `x86_64-pc-windows-msvc` | TNG `x86_64-pc-windows-gnu`（gnu 版自包含可运行） | `tng.exe` |
| Linux x86_64 | `x86_64-unknown-linux-gnu` | TNG 同名 | `tng-linux-x86_64` |
| Linux aarch64 | `aarch64-unknown-linux-gnu` | TNG 同名 | `tng-linux-aarch64` |
| macOS aarch64 | `aarch64-apple-darwin` | TNG 同名 | `tng-aarch64-apple-darwin` |

> macOS x86_64 已移除：该架构不再受支持，亦无远程证明版产物；旧文档/脚本若仍提及该目标，请勿沿用。

### 已知限制 / 后续

- **Windows ARM64** 未发布——TNG 无官方 win-arm64 产物，列为后续（等上游或单开自编 job）。
- **macOS 未签名**——首次打开需 Gatekeeper 放行；正式签名/公证待后续。
- 图标为占位（由 `icons/icon.ico` 放大生成）；建议日后用 `cargo tauri icon <高清源>` 重生一套。