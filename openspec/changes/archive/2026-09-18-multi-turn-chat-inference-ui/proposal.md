# Proposal

## Why

密态推理最近接入流式响应后，首个增量会立即打断安全阶段动画并在阶段卡下方渲染文本，导致阶段卡失去叙事作用；同时响应卡在流式期间随内容撑大、结束后又因另一套高度约束收缩。当前“单次请求调试”页面无法承载真实多轮对话，推理一旦发出也不能停止；同时 vLLM 0.26 thinking 模型的 `delta.reasoning` 流会被现有解析逻辑丢弃。

## What Changes

- **BREAKING（用户可见行为）**：将密态推理“请求调试”页从左侧请求表单 + 右侧响应卡，改为典型多轮对话聊天页；移除“本客户端不是聊天工具”提示。
- 用户消息显示为右侧气泡，assistant 响应显示为左侧气泡；推理页状态保留在 GUI 进程内存中，切换到概览或设置页再返回时不重置、不取消进行中流式请求，GUI 进程退出后不保留，也不写入设置缓存、tng 配置或任何文件。
- 输入框固定在聊天区域下方，默认 1 行，按内容自动增长，最高显示 8 行；超过 8 行后输入框内部纵向滚动。用户发送后输入框清空，消息原文立即显示为右侧气泡；未发送的输入草稿在应用内切页后保留。
- 发送请求时携带完整 OpenAI compatible `messages` 数组；每轮 assistant 最终 `content` 可进入后续上下文，`reasoning` 不进入后续上下文。
- 请求开始后立即创建左侧 assistant 气泡并播放现有五步安全阶段卡动画；后台同时接收流式响应但不渲染。仅当动画播放到最后一个阶段、最后一个阶段卡已显示至少 0.5 秒、且已收到至少 1 个 `reasoning` 或 `content` 增量时，阶段卡消失并揭示流式输出；若流尚未收到增量，最后阶段卡保持等待。
- 聊天消息区域使用固定高度纵向滚动容器；流式期间 reasoning / content 追加时整个消息区域始终自动滚动到底部，响应完成不改变消息区域高度。
- 适配 vLLM 0.26 thinking 模型：SSE 解析同时识别 `choices[0].delta.reasoning` 与 `choices[0].delta.content`，保留两类文本并在 assistant 气泡中分别展示为“思考过程”和最终回答；流中断或失败时保留已到达内容并标注不完整。
- 在模型选择框右上角增加“思考强度”滑块，停靠值为“关 / 低 / 中 / 高”，默认“中”；发送时映射为 `reasoning_effort: none|low|medium|high`。不向用户暴露 `thinking_token_budget`。
- 推理进行中，底部输入框右侧的发送按钮切换为“停止”按钮；用户可主动取消当前流式请求。流式输出已经开始时，停止后保留已显示内容；仍处于阶段动画时，停止后不揭示后台缓冲，只显示空白 assistant 气泡并标记“已停止⚪响应不完整”。
- 主动停止是 assistant response 的一个显式终态：停止后停止接收和渲染新 chunk、清理动画 timer、释放发送锁，且该 assistant turn 不进入后续请求上下文；应用内切页不会自动停止请求，返回后仍可停止。
- 聊天气泡使用轻量、协调的状态色：用户输入、进行中（阶段动画或流式输出）与完整响应均为同一淡绿色；用户主动中断的响应为淡金色；异常中断或失败的响应为淡红色。进行中状态标签仍区分“安全链路/生成中”，但气泡底色不随阶段推进或流式输出切换。
- 保留并行请求禁用语义：一次 assistant 响应未进入终态前不可发起新请求；请求进行中唯一操作入口是停止，该锁状态在应用内切页后保持不变。
- 推理页所有用户可见与进行中状态——当前选项卡、模型清单与选中模型、思考强度、输入草稿、聊天记录、assistant 阶段/流式/完成/失败状态、诊断与发送锁——在 GUI 进程存续期间跨应用内页面导航保留；进程退出后回到默认值。
- 保持既有安全链路约束：`stream: true`、模型身份来自 body.model、不注入 `x-model`、Authorization 仅作为请求头且失败诊断脱敏。

## Capabilities

### New Capabilities

（无——本变更扩展现有 GUI 行为，不引入新能力域。）

### Modified Capabilities

- `gui-shell`: 用多轮聊天 UI、消息历史进程内存态、阶段动画缓冲揭示、自动滚动与应用内切页状态保留契约，替换“单次请求输出区”和首个 delta 立即渲染契约；并新增 vLLM 0.26 reasoning/content 双流解析与思考强度控制要求。

## Impact

- 前端：`frontend/src/App.vue`、`frontend/src/views/InferenceView.vue`、`frontend/src/tauri.ts`、`frontend/src/assets/theme.css` 及组件测试需要改为消息列表、双气泡布局、输入框 1–8 行、阶段缓冲状态机、reasoning/content 双流展示、自动滚动，并让 `InferenceView` 在应用内切页时保持存活。
- Tauri / core：`src/lib.rs` 与 `tngui-core/src/inference.rs` 的流式命令从单条 prompt 字符串升级为 `messages` 数组，并携带 `reasoning_effort`；SSE payload 从纯文本 delta 升级为带 kind 的 reasoning/content delta；同时增加当前请求标识、取消命令与成功停止结果，确保停止不是网络错误。
- 测试：覆盖多轮 body 构造、reasoning/content 顺序、默认中强度映射、阶段动画揭示条件、无 chunk 等待、输入框高度、自动滚动、失败保留内容、停止请求、停止不进入后续上下文、气泡状态配色、凭据脱敏，以及应用内切页后草稿/聊天/流状态保持与进程退出不落盘。
- 文档：`docs/tngui-ui-guide.md` 需同步移除“单次请求、不保留会话历史”的描述，改为多轮对话、主动停止、结果气泡状态色和 thinking 模型行为说明。
- 无新增外部依赖；不改变 TNG 配置、反向代理、模型发现、OHTTP/RA 或推理端口语义。
