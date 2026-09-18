# Design

## Context

见 proposal.md——非流式三层全量缓冲是等待根因；tng/反代/上游的 SSE 透传已实测可行。当前关键事实：

- `tngui-core/src/inference.rs` 的 `send_inference`：一次性 `http_request` 读到 EOF 后整段 dechunk + JSON 解析，返回完整 `choices[0].message.content`；HTTP 客户端为手写 tokio TCP，已有 `FailureDiagnostic`（Authorization 脱敏 + 请求/响应对照）、`dechunk`（整段版）、10 MiB 上限。
- `tngui-core/src/proxy.rs` 反代 `handle_conn` 响应转发是 8KB 读→写循环，逐块透传，不改成帧——对 SSE 流增量天然友好，本变更零改动。
- `src/lib.rs` 的 Tauri 命令为请求/响应模型（`Result<String, String>` 一次性返回）；Tauri 2 提供 `tauri::ipc::Channel<T>` 支持同命令内多次推送。
- 前端 `InferenceView.vue::onSend` 持有"发送中 → 成功文本 / 失败诊断"二态展示与五步安全阶段转场动画。

## Goals / Non-Goals

**Goals:**

- 单次推理请求从"全量等待"变为"逐 token 渐进渲染"，首个增量到达即建立"链路已通"的用户反馈。
- SSE 增量解析收敛在 `tngui-core`（无 tauri 依赖、可用现有 tokio 测试基建注册 fake 上游测试），前端只消费增量纯文本。
- 失败路径保持既有可读调试详情（脱敏 Authorization、请求/响应对照），并在流中断时保留已到达部分文本。

**Non-Goals:**

- 不改反代 `proxy.rs`（其响应转发已经流式）。
- 不改 OHTTP/RA/模型发现/`x-model` 禁令/可发门锁等既有链路语义。
- 不做用户可停（abort 按钮）、不做多轮会话、不做 SSE 以外的流协议（gRPC/WebSocket）。
- 不为非流式保留双路径：前端只走流式命令，旧 `send_inference` 命令与核心非流式函数一并移除，避免两套解析漂移。

## Decisions

### D1: 解析分层——Rust core 负责增量链路级解析，前端只拼接纯文本 delta

`tngui-core` 新增流式函数（签名示意）：`send_inference_stream(port, model, api_key, prompt, on_delta: &mut dyn FnMut(String))`（或闭包参数），内部完成：构建 `stream: true` 请求 → 连接反代 → 增量解析响应 → 每节 `choices[0].delta.content` 调 `on_delta`。SSE/HTTP/chunked 的协议复杂度不出 core；不引入 tauri 依赖（core 可脱离 webview 测试）。前端不再自行理解 OpenAI SSE 结构，`Channel` 只承载 `String` 增量。

- 备选（否决）：前端拿到原始文本流自行解析——把 HTTP chunked + SSE 两层协议解析塞进 Vue，且绕开 core 既有测试基建，协议回归难度更高。

### D2: Tauri 增量通道用 `Channel<String>`，完成/失败仍走命令返回值

新增命令：

```rust
#[tauri::command]
async fn send_inference_stream(
    port: u16, model: String, api_key: String, prompt: String,
    on_delta: Channel<String>,
) -> Result<(), String>
```

- 语义：每个 content delta → `on_delta.send(delta)`；流完整结束（见 D4）→ `Ok(())`；任何失败（连接失败、非 2xx、非 SSE 2xx、SSE 数据 JSON 解析失败、中途断流）→ `Err(既有格式诊断)`。
- 前端：`const channel = new Channel<string>(); channel.onmessage = d => output.value += d; await invoke("send_inference_stream", {..., onDelta: channel})`。
- Channel 是 per-invocation scoped，无需全局事件名/清理监听；消息率实测约 80 事件/秒，对 webview IPC 无压力。
- 备选（否决）：`app.emit` 全局事件——需要事件名约定与解绑，多请求并发时可能串流；Channel 与 invoke 生命周期绑定，失败即走 Promise reject，语义更简。

### D3: 增量响应解析——有限状态机：字节流 →（按需）增量 dechunk → SSE 事件 → delta

新写 `IncrementalDechunker`（replace 现有"整段完成后 `dechunk`"）：持缓冲区，`feed(&mut self, bytes)` 产出已完成的 chunk 数据；每帧状态为"读尺寸行 / 读 chunk 体 / 读帧尾 CRLF / 处理 0 尾帧"。SSE 层持独立缓冲：追加已解码字节，按 `\n` 切行（容忍行尾 `\r`、忽略 `:` 注释行），事件边界 `data:` 行后的空行；每完成一个事件解析 `data` payload（`data: [DONE]` → 结束；其余 `serde_json` → `choices[0].delta.content` 字符串，缺失/空则跳过，出错则失败）。

- 成帧判定沿用现逻辑：响应头含 `transfer-encoding: chunked` → 增量 dechunk；否则（网关错误 JSON / WAF HTML 常为 Content-Length 或 EOF 结尾）缓冲至结尾按现诊断路径处理。2xx 但 content-type 非 `text/event-stream` 也按此缓冲路径产出诊断——覆盖现有"WAF 2xx HTML"测试场景。
- 请求行升级为 `HTTP/1.1` + `Connection: close`（chunked 是 1.1 语义；当前 1.0 依赖对端仍回 1.1 chunked，规格上取顺）。
- 10 MiB 累计上限保留（防异常帧兑现既有安全位）；SSE/JSON 解析都须在 UTF-8 边界内处理（line 切分不需要 UTF-8 校验，`delta.content` 解析交给 serde）。

### D4: 完成与中断语义

- **完整**：收到 `data: [DONE]`（标准 vLLM/OpenAI 终止）→ 命令 `Ok(())`。到达 `[DONE]` 前忽略 `finish_reason`（终止块 `delta` 无 content）。
- **缓冲型成功**：若上游 2xx 但提前 EOF 且无 `[DONE]`——视为中断失败（`Err` 带诊断），而非成功；vLLM 正常流必带 `[DONE]`，缺失即异常。
- **中断**：已推送的 delta 不撤回（前端已累积显示），`Err` 诊断标注"流中断，未收到 [DONE]"。前端保留部分文本 + 失败提示（见 D5），用户可分辨"部分结果"与"完整结果"。
- **失败**：连接失败、非 2xx、非 SSE 2xx——沿用 `FailureDiagnostic` 现有输出格式（脱敏请求 + 响应原文 + 摘要），非 2xx 的 body 依 D3 缓冲路径完整收集（现测试的 502 网关 JSON、WAF HTML 场景语义不变）。

### D5: 前端状态机——`sending → streaming → done / failed`，首个 delta 冻结阶段转场

`onSend` 扩为三态：

- `sending`（发送中）：保持现有五步安全阶段卡与线性进度转场不变；
- 首个 delta 到达 → `streaming`：停止/冻结阶段动画于当前阶段，响应卡切换为渐进文本渲染，状态标签显示 `200 OK`；增量持续追加，响应面板自动滚动跟随最新内容；
- 命令 resolve → `done`：解除生成中标识；reject → `failed`：已有部分文本保留，失败诊断沿用现有"脱敏请求 + 响应原文"展示位。

- 备选（否决）：收到响应头就切 `streaming`——前端拿不到响应头时机（Channel 只传 delta），且首个 delta 本身就是"链路已通"的最强证据。
- 重发仍按现状先清空 `output`（"输出区只显示当次响应"）。

### D6: 移除旧非流式路径，测试同步迁移

`send_inference`（lib.rs 命令 + core 函数 + 其非流式专用断言）删除；现有 `inference.rs` 测试中的成功/错误路径改由流式函数对应场景替代（fake 上游服务由"一次写完响应"改为"SSE 分帧写入"，并新增拆包/断流/`[DONE]` 用例）。前端组件测试 mock Channel，断言：命令名与参数、渐进追加、首个 delta 后阶段冻结、失败保留部分文本与诊断展示。

## Risks / Trade-offs

- [网络分帧把 SSE 事件拆碎/粘连] → `IncrementalDechunker` 与 SSE 缓冲均按"只处理完整帧、其余留缓冲"设计；单测覆盖字节级随机拆包写入。
- [异常上游返回 2xx + 非 SSE 响应体] → 走 D3 缓冲诊断路径，旧行为语义保留，不产生半截误渲染。
- [RVS 不可达环境下 RA 模式首字节前等 30s 超时] → 与现状非流式同病（连接期等待），非本变更引入；未来接入进度事件可再优化（列为后续可能，不入本范围）。
- [~80 msg/s 的 webview IPC 频率] → 实测量级对 Channel 无压力；如极端流更密，可在 core 侧做 <50ms 的微批量合并（作为实现容错项，不承诺 UI 可感知差异）。
- [移除非流式路径失去"手动验证缓冲解析"的能力] → 缓冲解析逻辑在错误路径上保留并有测试覆盖；正常路径 SSE 化后无双向需求。

## Migration Plan

单版本前后端 + 命令名一起切换（`send_inference` → `send_inference_stream`），无持久化/契约兼容负担。回滚即整体 revert 该 PR；上游/反代/tng 侧无任何配套变更要求。
