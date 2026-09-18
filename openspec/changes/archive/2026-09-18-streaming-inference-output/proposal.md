# Proposal

## Why

密态推理当前以非流式 POST 请求上游：GUI 从点击发送到收到全部结果一直处于"发送中"状态，长文本生成时用户只能面对占位动画干等，既无法感知链路是否已打通，也无法尽早读到内容。实测（tng 2.9.0 + 默认推理域名）证明上游 vLLM 与 tng 对 `stream: true` 请求返回标准 OpenAI SSE，且逐 token 增量经过 tng OHTTP 链路到达本地（约 600 字请求实测 579 个事件分散在 7.3 秒内到达）；tngui 反代的读→写循环本身也已经是流式转发。唯一缺的是客户端三层把响应攒全量：inference 请求体无 `stream` 字段、HTTP 客户端读到 EOF 才返回、Tauri 命令只支持请求/响应一次性返回。

## What Changes

- 发送推理请求时 body 携带 `"stream": true`，请求语义从"等全量回复"变为"消费 SSE 数据流"。
- 后端新增流式推理能力：增量解析 chunked 帧与 SSE 事件，每解析出一节 `choices[0].delta.content` 即推送给前端；命令通过 Tauri 2 `Channel` 增量发送，完成后正常返回。
- 前端"密态推理"视图渐进渲染：首个增量到达后即把响应卡从"发送中"切换为已到达文本的持续展示，后续增量追加显示；收到 `data: [DONE]` 或正常结束时标记完成。
- 发送阶段动画语义细化：首个增量到达前保持既有五步安全阶段卡转场；首个增量到达后阶段卡停止推进、响应区切换为流式文本。
- 流中断（未收到 `[DONE]` 即 EOF/断连）与既有失败路径（连不上、非 2xx、非 JSON/非 SSE 响应体）保留可读调试详情，Authorization 脱敏；中断时已到达的部分文本保留显示并明确标注不完整。
- 前端一条请求只走流式命令；不再保留独立的非流式 `send_inference` 前端调用路径（旧非流式内部实现被流式实现取代后移除，避免双路径漂移）。
- 不改变：可发门锁（运行态/apiKey/模型清单）、`x-model` 禁令、模型 path 注入、反代模型发现例外、OHTTP/RA 链路、失败/成功输出区每发清空的语义。

## Capabilities

### New Capabilities

（无——本变更只改既有 GUI 行为，不引入新能力面。）

### Modified Capabilities

- `gui-shell`: 修改三处需求——①"密态推理模型清单驱动测试请求"：body 增加 `stream: true`、输出区按 SSE 增量渐进渲染、`[DONE]` 与中断语义；②"密态推理发送阶段垂直转场"：首个增量到达后阶段卡停止推进并切换为流式文本；③"结构化配置控件"（其携带的推理响应成帧/调试场景）：推理响应改为 SSE 增量成帧解析，非流式 Content-Length/chunked 缓冲解析仅保留给错误/网关类响应，调试详情脱敏语义不变。

## Impact

- `tngui-core/src/inference.rs`：新增流式请求+SSE 增量解析（chunked 解码器改为可增量消费）；保留并复用FailureDiagnostic 脱敏诊断；移除旧非流式路径或收敛为流式实现的一部分。
- `src/lib.rs`：新增 `send_inference_stream` Tauri 命令（带 `Channel` 参数）；注册命令；旧 `send_inference` 命令随前端切换移除。
- `frontend/src/tauri.ts`、`frontend/src/views/InferenceView.vue`、`frontend/src/views/InferenceView.component.test.ts`：Channel 封装、渐进渲染、转场状态机、失败/中断展示与组件测试。
- `tngui-core` 单元测试：增量 chunked/SSE 解析、`data: [DONE]`、中途断流、非 2xx/非 SSE 错误、脱敏断言（沿用现有测试基建）。
- 无新增外部依赖；Tauri Channel 为 `tauri = "2"` 已有能力。
- 规格：`openspec/specs/gui-shell/spec.md` 三处需求的 delta（本 change 目录内）。
