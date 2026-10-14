# tngui — TNG GUI 包装器

TNG（可信网络网关）的桌面 GUI 包装器：配置编辑 + 启停 + 只读状态/日志。
与 tng **松耦合**——不链接任何 tng 代码，仅通过 (A) `tng launch` CLI、(B) 只读控制面 REST、(C) 子进程输出捕获 三条契约对接。tngui 是图形操作系统上的 client-side pre-TNG 反向代理与 tng-ingress 本地包装器：它只写本地配置、启动子进程并把观测结果展示给用户，不定义服务端授权、全局模型注册或远端路由。


tngui 自带本机 pre-TNG reverse proxy。对 `POST /v1/chat/completions`、`POST /v1/messages` 与 `POST /v1/responses` 三类端点，它读取请求体顶层字符串 `body.model`，把该确切模型字符串编码为单一 URI path segment 生成 `/models/{encoded-model-segment}{original-path}`，并保留 query、credential header 和原始 body 字节。path 生成不做本地认证或路由决策；`x-model` 不作为模型身份。例如：`{"model":"auto"}` 对应 `/models/auto/...`；`{"model":"provider/model"}` 对应 `/models/provider%2Fmodel/...`。`POST /v1/responses` 在当前边界中服务于无状态、自包含的模型请求形态：每次发送完整输入与模型身份，不引入 tngui 侧本地会话或后台任务；多轮上下文由调用方在请求体中自行携带。

对精确的 `GET /v1/models`，本地模型发现例外的请求头规则是确定的：本地剔除 hop-by-hop 头、`host`、`content-length` 与 `x-model`；若请求中已有 `Authorization` 或 `x-api-key`，按原样透传到 capi origin（`mapping` 形态派生的 origin 从远端 host:port 得出；`http_proxy` 形态按 `ohttp.tls` 与 `dst_filters[0].domain[:port]` 得出 HTTP 或 HTTPS origin）。tngui 不新增业务凭证，不校验业务凭证语义，也不剥离业务凭证；透传凭证头不表示 tngui 参与授权，剥离或校验授权凭证由服务端授权边界处理。该直连分支不经 tng ingress，也不进入 OHTTP / RA 链路，不做模型 path 注入或 body 改写；发现请求不属于模型授权链路，模型清单也不构成远端可用性或授权能力。若 capi origin 缺失、无效或不可达，返回明确的模型发现失败响应，而不是空模型清单。推理请求仍通过 TNG 加密与远程证明链路转发；tngui 不定义、不判定、不重写远端授权或路由，实际行为由 TNG / 下游服务侧决定。

反代另有当前会话内的本地诊断快照（本地物理观察）：界面在选项卡行右侧以“代理状态”展示当前反代状态和身份通过/身份拒绝、请求过大、发现成功/发现失败、上游失败计数。固定计数语义是请求体中是否解析出可用模型身份，与认证、授权、凭证有效性或远端可访问性无关。快照只在 tngui 进程内存中随当前反代生命周期存在，重启重置，不发送到外部 collector；固定诊断类别不携带模型名、prompt、output、raw API key 或 attestation token，也不表示模型授权结果、远端模型健康、TNG key rotation 或跨实例 key 一致性。

上述反代行为是 tngui 本地定义；OHTTP/HPKE、远程证明、TNG path rewrite、远端密钥生命周期等语义是外部 TNG 系统行为，tngui 只写本地配置并把观测结果展示给用户，不重新定义这些协议。

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

启动/重启 tng 时按远程证明开关选择二进制：当前唯一 ingress 开启远程证明（`no_ra` 非 `true`）→ 用 RA 版；关闭远程证明 → 用普通版。RA 版缺失时拒绝启动并明确报错，绝不静默回退普通版。

- **普通版**（当前唯一 ingress 关闭 RA 时使用）：CI release 时从 [inclavare-containers/TNG](https://github.com/inclavare-containers/TNG) 官方 release 下载产物，放置为 `resources/tng-nora`（Unix）/`resources/tng-nora.exe`（Windows）——与 RA 版的 `tng.exe` 撞名规避；运行时从 `resource_dir` 解析，缺失回退 `PATH` 上的 `tng`（开发态）。
- **远程证明版（RA 版）**（当前唯一 ingress 开 RA 时使用）：直接储存在仓库 `resources/` 内（不入 CI 下载），按平台命名——Windows x64 为 `tng.exe`、Linux x86_64 为 `tng-linux-x86_64`、Linux aarch64 为 `tng-linux-aarch64`、macOS aarch64 为 `tng-aarch64-apple-darwin`；运行时从 `resource_dir` 按平台解析，不回退。
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