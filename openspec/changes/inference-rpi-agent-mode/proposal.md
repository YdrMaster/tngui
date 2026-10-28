# Proposal

## Why

密态推理调试页当前只能发一轮 OpenAI 兼容请求，无法验证模型经 tng 真实链路的**工具调用**能力——而工具调用正是密态推理叙事里的招牌能力。rpi 已经提供成熟的 Rust agent 循环与工具执行，直接复用可以避免自造 agent 循环；同时让两种模式共享同一个内存会话，保证上下文连贯、便于在同一页对照调试。

## What Changes

- 新增**按请求**的运行模式切换：`对话模式`（现状：一次点击 = 恰好一次推理请求）与 `Agent 模式`（一次用户交互 = 模型↔工具多轮循环，直到模型不再请求工具）。
- 两种模式**共享同一个内存会话**（同一个后端会话，不落盘）；上下文逐字携带，含 `assistant.tool_calls` 与 `role:"tool"` 工具结果，但不含 reasoning。
- Agent 模式默认注册**只读**内置工具 `read` / `ls` / `grep` / `find`，在宿主文件系统上执行且**不限制访问路径**；无会话持久化（仅进程内存）。
- Agent 模式设置单次运行的轮数上限（`RPI_MAX_TURNS_PER_RUN`，默认 30），`Agent 模式`失败时展示 rpi 的错误信息并保留已到达的 reasoning/content。
- **BREAKING**：两种模式都用固定在流式光标位置的 `▶解密中` 字样**替换**现有"五步安全流程阶段动画"（含其三条件揭示契约）。
- 调整控件：`重置` 改为 `新会话` 并移到左上角（模型下拉列表左侧）；其原位置改为 chat/agent 模式切换控件，控件风格对齐设置页入口配置的 host toggle（`a-switch` 样式）。
- 新增 `tngui-chat`（手写 SSE 客户端，扩展消息模型以承载 `tool_calls` / `tool` 角色）与 `tngui-agent`（rpi 四件套）两个 crate，与 `tngui-core` 构成三个**平行** crate（`core` / `chat` / `agent` 两两互不依赖）；三者由 `tngui-app` 组合依赖。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `gui-shell`: 密态推理视图新增运行模式切换与 Agent 模式（单次交互多轮工具调用、只读工具集、共享内存会话、轮数上限）；上下文规则改为"完整会话消息（含工具往来）不含 reasoning"；`重置` 改为 `新会话` 并移动位置；五步安全阶段动画被 `▶解密中` 替换。

## Impact

- **前端**：`frontend/src/views/InferenceView.vue`（模式切换、新会话按钮、工具调用时间线渲染、移除阶段动画）、`frontend/src/tauri.ts`（新命令与事件类型）、`frontend/src/composables/useInferenceConfig.ts`（模式/会话状态）。
- **Rust**：新增 `tngui-chat`、`tngui-agent` 两个 crate；`tngui-core` 的 `inference` 模块迁出；`tngui-app`（`src/lib.rs`）新增 `run_agent_message` 命令与事件通道，并组合三个 crate 的 workspace members。
- **依赖**：`rpi-ai` / `rpi-agent` / `rpi-tools` / `rpi-harness`（`0.11.x`，全部同版本）；间接引入 `rusqlite`(bundled)、`image`、`reqwest 0.12`（与 `tngui-core` 现有 `reqwest 0.13` 并存）。
- **规格**：`gui-shell` 中被改写的既有要求：`密态推理发送阶段垂直转场`（替换）、`密态推理模型清单驱动测试请求`（上下文规则）、`密态推理对话上下文重置`（入口由输入框左侧 `重置` 改为顶部 `新会话`，切段语义不变）与 `新对话分隔提示`（触发控件由 `重置` 改为 `新会话`，分隔线语义不变）、`密态推理停止响应控制` 与 `密态推理响应气泡状态颜色`（阶段动画相关表述）；并新增运行模式与 Agent 模式相关要求。
