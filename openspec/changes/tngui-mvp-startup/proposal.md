## Why

<!-- 动机：为什么要这个变更 -->

TNG（可信网络网关）目前只能通过 `tng launch`/`exec` 命令行和各类 SDK 驱动——既没有 GUI，也没有任何证据表明 GUI 能以**松耦合**方式包装 tng（不链接代码，仅靠稳定契约对接）。本次变更交付最小垂直切片，端到端验证这一设想，并提供最简单的交互界面用于启动/重启 tng 并读取其状态。范围有意低于完整设计稿（`tng-gui-design.md` §8）：在做配置编辑器、系统代理、metrics 之前，先证明两条核心契约（进程生命周期 + 只读控制面）成立。

## What Changes

<!-- 变更内容 -->

- 用 **Tauri 2** 应用替换现有的 `src/main.rs` 桩二进制：Rust 后端（`#[tauri::command]`）+ 单文件 HTML/JS 前端。
- **配置文本框**：用户直接编写完整 TNG JSON 配置（含 `control_interface.restful` 及用户自选端口）。
- **启动/重启按钮**（单个、幂等）：先终止已存在的 tng 子进程，将配置写入 `<应用数据目录>/tng-runtime.json`，再以 `RUST_LOG=info` 启动 `tng launch -c <文件> --log-file <应用数据目录>/tng.log`。
- **后端安全收口**：强制 `control_interface.restful.host = "127.0.0.1"`（控制面无鉴权，且 tng 默认 `0.0.0.0`）；若缺失 `control_interface.restful.port` 则拒绝启动并给出明确提示（状态客户端需要该端口）。
- **HTTP 状态客户端**（Rust 后端，异步 `reqwest`）：每隔约 1.5s 轮询 `127.0.0.1:<端口>` 上的 `GET /livez`、`/readyz`、`/status/`，并通过 `get_status()` 命令暴露给前端。
- **三态状态灯**：🔴 不可达 → 🟡 `livez` 通过但 `readyz` 503（启动中）→ 🟢 `readyz` 200（就绪）。`GET /status/` 的 JSON 在面板中原样渲染。
- **只读 stderr 捕获区**：将 tng 子进程的 stdout/stderr 流式输出到界面（当严格 JSON `deny_unknown_fields` 在解析阶段拒绝配置、而 `--log-file` 日志尚未初始化时，这是唯一的错误反馈通道）。
- `tng` 二进制从 **PATH** 解析（测试阶段：从源码手工编译）；本次不做 sidecar/prebuild 打包。

## Capabilities

### New Capabilities
<!-- 新增能力。路径段用 kebab-case，遵循项目既有组织。每项生成 specs/<capability-path>/spec.md。 -->
- `gui-shell`：最小化 GUI 包装器，依据用户提供的 JSON 配置（重新）启动 tng 进程，并展示 tng 只读控制面的状态；与 tng 之间仅通过 CLI 拉起 + REST 轮询交互。

### Modified Capabilities
<!-- 既有能力的需求变更（非纯实现细节）。本仓库无既有 spec，留空。 -->
<!-- 无。本项目尚无任何既有 spec；这是第一个能力。 -->

## Impact

<!-- 影响：受影响的代码、API、依赖、系统 -->

- **项目脚手架**：将空白的 Rust 2024 二进制重构为 Tauri 2 应用（`src-tauri/` + 前端资源）。现有 `Cargo.toml`/`src/main.rs` 桩将被替换。
- **依赖（仅 GUI 仓库）**：`tauri` 2、`reqwest`（异步，rustls 或默认）、`serde_json`、`tokio`，以及一个前端构建工具。**不链接任何 TNG crate**——松耦合是硬约束。
- **外部依赖**：要求 `tng` 二进制位于 `PATH`。GUI 仅通过 (A) `tng launch -c … --log-file …` 与 (B) `127.0.0.1` 控制端口的 `GET /livez|/readyz|/status/` 驱动 tng；(C) 子进程 stderr 捕获。
- **文件系统**：写入 `<应用数据目录>/tng-runtime.json`（启动所用配置）与 `<应用数据目录>/tng.log`（tng 日志），便于检查/重启。
- **TNG 仓库**：无任何改动。（设计稿 §7 提出的内核 additive 增强——`/metrics`、状态树扩维、控制面安全——明确不在本次范围，MVP 也不依赖它们。）