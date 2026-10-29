# Design

## Context

现状（动机见 proposal.md - Why）：

- **进程结构**：`tngui-app`（Tauri，`src/lib.rs` 承载命令层与状态）+ `tngui-core`（纯 Rust：`config` / `proxy` / `models` / `status` / `process` / `cache_salt` / `inference`）+ `frontend`（Vue 3 + ant-design-vue）。
- **推理链路**：`tngui-core::inference::send_inference_stream` 是**手写**的 OpenAI 兼容 SSE 客户端——`tokio::net::TcpStream` 自建 HTTP 头、chunked 拆帧与 SSE 解析，**不用 reqwest**；POST `http://127.0.0.1:<proxy_port>/v1/chat/completions`。命令层 `send_inference_stream` / `stop_inference_stream` 通过 `Channel<InferenceDelta{kind,text}>` 把 reasoning/content 增量推给前端；取消基于 `AppState.inference_cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>` 按 `request_id` 注册，`race_inference_stream_with_cancellation` 用 `select!` 竞争取消信号。
- **前端**：`views/InferenceView.vue`（顶部模型下拉、固定高度聊天区、输入框、输入框左侧红色 `重置` 按钮、`components/SecureFlow.vue` 五步阶段动画）+ `composables/useInferenceConfig.ts`（进程内页面状态：模型清单、选中模型、思考强度、身份注入、消息与草稿）+ `components/EntryEditor.vue`（`a-switch` 的 `127.0.0.1`/`0.0.0.0` 分段切换，作为新控件风格参照）。
- **约束**：
  - workspace 为 Rust **edition 2024**（`std::env::set_var` 为 `unsafe`）、`rustc 1.99`；`tngui-core` 现有 `reqwest 0.13`（仅 `rustls`、非流式），推理流刻意不复用它。
  - 请求必须经 tngui 反代；模型身份只由 `body.model` 决定，禁止 `x-model`。
  - 依赖可用性：`rpi-ai` / `rpi-agent` / `rpi-tools` / `rpi-harness` 均已发布到 crates.io，最新版本同为 **0.11.0**（`edition 2021`、`rust-version 1.88`，与本 workspace 的 `rustc 1.99` 兼容）。

## Goals / Non-Goals

**Goals：**

- 一个命令面同时服务两种运行模式；`对话模式` 的行为与现状等价（一次点击 = 恰好一次推理请求），且其链路上**零 rpi 代码**。
- `Agent 模式` 在 tngui 进程内驱动 rpi 的 agent 循环与只读工具，单次发送内多轮，事件以 typed channel 流式回前端，呈现为单个 assistant 气泡内的时间线。
- 两种模式共用**同一套**会话消息模型（含 `assistant.tool_calls` 与 `role:"tool"`），上下文逐字互通、不因模式切换被裁剪。
- 取消复用既有 `request_id` 注册表；`Agent 模式` 映射到 harness abort。
- 全程不落盘（会话、工具记录、运行状态都只在进程内存）。

**Non-Goals：**

- 不做多会话管理（只有一个共享会话）。
- 不使用 rpi 的会话持久化（JSONL/SQLite）、compaction、skills、prompt templates、extensions/plugins、子 agent 委派。
- 不新增后端端点、不改反代与模型发现、不改 `tngui-core` 的既有能力。
- 不做路径沙箱（用户已明确接受任意路径只读）。

## Decisions

### D1 对话模式保留手写 SSE，不接 rpi

`对话模式` 继续走 `tngui-core::inference` 的手写 SSE 客户端（迁入 `tngui-chat` 后形态不变）。

- **理由**：该模式的价值就是"一次点击、一轮、链路可见"，用最少机制验证 tng 链路；同时避免把 rpi 的依赖图（含 `rusqlite`(bundled)、`image`、`reqwest 0.12`）压到这条最常走的调试路径上。
- **备选**：两种模式都走 rpi（如 `Provider::stream_simple`）。否决：会把整条依赖图拖进对话路径，且改变该页所验证的请求构造细节（正是这页要盯的东西）。

### D2 crate 切分：`tngui-core` / `tngui-chat` / `tngui-agent` 三个平行 crate，由 `tngui-app` 组合

- `tngui-core`：保持既有职责（`config` / `proxy` / `models` / `status` / `process` / `cache_salt`），仅把 `inference` **传输模块**迁出。
- `tngui-chat`：手写 SSE 对话客户端 + 扩展后的**中性消息模型**（`role: user|assistant|tool`、`content`、`tool_calls`、`tool_call_id`）。
- `tngui-agent`：基于 `rpi-ai` / `rpi-agent` / `rpi-tools` / `rpi-harness` 的单次运行器，暴露自己的请求/事件类型。
- `tngui-app`：唯一**组合根**——依赖上面三个兄弟 crate，承担 Tauri 命令、事件桥、以及会话模型与 rpi 消息之间的**机械转换**。
- 依赖方向：`app → {core, chat, agent}`；`core` / `chat` / `agent` 三者**互为平行兄弟、零相互依赖**（`core` 不依赖 rpi，也不依赖 `chat`/`agent`）。

- **理由**：两个 crate 完全平行且互不依赖，`tngui-agent` 的依赖图不会渗进 `tngui-chat` 或 `tngui-core`；两条传输可独立演进、独立测试。
- **备选 A**：单一 crate + `feature = "agent"`。否决：feature 只影响可选依赖，无法保证对话路径的编译产物不含 rpi；且会把两条独立传输耦合在一个模块里。
- **备选 B**：把 `tngui-core` 当作组合根（由 core 依赖 chat 与 agent）。否决：这会打破"三个平行 crate"，core 会被迫承担 rpi 的整套依赖与生命周期，其单测与所有使用方都要付编译代价；组合职责应留在 `tngui-app`。
- **备选 C**：把中性消息模型放进 `tngui-core` 供两者共享。否决：与 proposal 的"扩展消息模型在 `tngui-chat`"冲突，且会让 core 承担与它无关的职责。

### D3 Agent 模式用 rpi-harness 的 `AgentHarness` 驱动 rpi-agent 的循环

一次 Agent 运行 = 一个进程内的 `AgentHarness`：

- **provider/model**：`rpi_ai` 的 OpenAI-compatible provider，`Model { base_url: "http://127.0.0.1:<proxy_port>", api: 对话补全, id: <选中模型 ID>, reasoning: true, thinking_level_map: ..., .. }`。`chat_completions_url(base_url)` 会拼出 `/v1/chat/completions`，正好落在反代对外端点上，模型身份仍由 `body.model`（= `Model.id`）决定。
- **工具**：`rpi_tools` 的 `create_read_tool` / `create_ls_tool` / `create_grep_tool` / `create_find_tool`，配 `OsExecutionEnv`（真实文件系统 + 进程工作目录为基准），只注册这四个只读工具，`active_tool_names` 与之一致。不注册 `write`/`edit`/`bash`/`image`，也**不**做路径限制。
- **会话**：`Session` 由 `InMemorySessionStorage` 支撑 ⇒ 天然不落盘；`resources` 传空（无 skills / prompt templates），身份注入走 `system_prompt`。
- **事件**：`AgentHarnessOptions.agent_emitter` 传一个自实现的 `AgentEmitter` 适配器（见 D4）。
- **取消**：`AgentHarness::request_abort(run_id)`；`run_id` 取自运行开始事件。
- **轮数上限**：`AgentHarness.max_turns` 是私有字段且**无公开 setter**（唯一可编程入口 `create_child` 属子 agent 委派语义，不适用），因此只能靠环境变量（见 D6）。
- **备选**：只用 `rpi-ai` 自写循环。否决：本变更的出发点就是不自造 agent 循环。
- **备选**：用 `rpi-runtime` 的 provider 装配。否决：那层面向 CLI/扩展/插件，职责过重。

### D4 会话归属：前端持有中性 transcript，后端命令保持无状态

现有命令已经是"前端把完整 `messages` 传进来、后端无会话状态"的形态。Agent 模式沿用同一形态：

- 前端 `useInferenceConfig` 持有**唯一**的中性会话消息数组，两种模式都从它取上下文 ⇒ 天然满足"共用同一个内存会话"。
- `run_agent_message` 每次调用：新建空的 in-memory `AgentHarness` → 用 `append_message` 把转换后的既有上下文灌入会话 → 以 `send_message` 驱动本轮（含工具循环）→ 结束后把 harness 产生的消息序列转换回中性消息返回给前端。
- 事件桥：为 `tngui-agent` 实现一个 `AgentEmitter` 适配器，把 `AgentEvent`（`TurnStart` / `MessageUpdate` / `ToolExecutionStart` / `ToolExecutionUpdate` / `ToolExecutionEnd` / `MessageEnd` / `AgentEnd`）映射为统一的 `InferenceEvent` 写进 Tauri `Channel`。`AgentEmitter::emit` 返回 `BoxFuture`，适配器内同步转发即可。
- **统一事件枚举**：两种模式共用一个 `InferenceEvent`（`TurnStart` / `ReasoningDelta` / `ContentDelta` / `ToolStart` / `ToolEnd` / `Notice` / `Done` / `Error`）；对话模式只发其中 `ReasoningDelta` / `ContentDelta` / `Done` / `Error` 子集。这样前端只需一个 reducer，且两种模式的状态机、`▶解密中` 指示与气泡配色天然一致（对齐"两种模式尽量同步"）。
- **备选**：在 `AppState` 里驻留长生命周期的 harness。否决：那会让"会话"在后端另存一份，与前端 transcript 形成双真相源；而对话模式必须保持无 rpi，两边很容易漂移。代价是每次 Agent 发送要重建一个内存 harness（纯内存结构，成本可接受）。

### D5 取消：复用既有 `request_id` 注册表

- 保留 `AppState.inference_cancellations` 与其注册/注销/竞争逻辑不变。
- 对话模式：仍竞争 oneshot 取消信号，命中即丢弃连接。
- Agent 模式：同一注册表；命令在运行期间监听取消信号，命中则调 `AgentHarness::request_abort(run_id)` 并等待 harness 收敛到终态，再按 `stopped` 返回（不视为失败）。
- **理由**：前端 `stopInferenceStream(requestId)` 与发送锁无需区分模式，停止语义、迟到增量忽略、终态标记都可复用现成实现。

### D6 轮数上限：进程启动时补默认环境变量

rpi 的 run budget **默认关闭**（未设置 = 无上限），而本变更要求默认 30。因为 harness 无编程入口，只能：

- 在 GUI 进程启动、任何命令可执行**之前**，若 `RPI_MAX_TURNS_PER_RUN` 未设置则设为 `30`；用户若已显式设置则完全尊重其值（含 `0`/非法 = 无上限，属"可被环境变量覆盖"）。
- edition 2024 下 `std::env::set_var` 是 `unsafe`，且环境变量是进程全局的 ⇒ 只在启动期单点写入、写入后不再修改（见 Risks）。
- 超过上限时 rpi 会给出自己的 `BudgetStop` 文案，经 `Notice` 事件呈现为"已达轮数上限"的终止摘要。

### D7 回环直连：为 localhost 关闭代理

rpi 的 provider 用 `reqwest` 且默认读 `HTTP_PROXY`/`HTTPS_PROXY`。调试链路的入口是 `127.0.0.1`，必须让 provider 的 client 对回环地址绕过代理（`no_proxy()` 或等价配置），否则请求会被宿主机代理劫持，调试对象就不是本地 tng 了。

### D8 思考强度映射：用 `thinking_level_map` 补齐 `"none"`

rpi 的 OpenAI provider 在 `ThinkingLevel::Off` 时**省略** `reasoning_effort`，而规格要求"关"必须发 `"none"`。解决：构造 `Model` 时显式给出 `thinking_level_map`，把 `Off → Some("none")`（并可同时钉住 `Low/Medium/High → "low"/"medium"/"high"`），同时置 `reasoning: true` 使 `supports_reasoning_effort` 为真。这样两种模式对同一档位发出相同的 `reasoning_effort` 值。

## Risks / Trade-offs

- **[`RPI_MAX_TURNS_PER_RUN` 是进程全局 + edition 2024 的 `unsafe set_var`]** → 只在启动期一次写入且之后不再改动；写入时 GUI 尚无并发命令（Tauri 状态与命令在之后才对外可用）。副作用：外部若设置该变量，会同时影响所有 Agent 运行（符合"环境变量覆盖"的规格语义）。
- **[每次 Agent 发送重建 harness]** → 纯内存对象，创建即注册工具与 provider，无 IO；相比长驻 harness 多出的开销在"一次用户交互"的尺度上可忽略。用户可见行为不变。
- **[两条传输/两个 crate 增加维护面]** → 用统一 `InferenceEvent` 与共享的中性消息模型把"模式差异"压缩到后端；前端只按事件 kind 分派，模式切换不留分支。
- **[rpi 消息模型与本项目中立消息模型的转换可能失真]** → 转换只在边界做机械映射（role/content/tool_calls/tool_call_id 一一对应），不做拍平；规格明确要求上下文逐字携带，验收场景"模式切换后上下文无缝衔接"即覆盖该风险。
- **[reqwest 0.12（rpi）与 0.13（core）并存]** → 二者是独立的 crate 版本，Cargo 允许并存；只是二进制体积与编译时间增加。runtime TLS 后端都走 rustls，无系统依赖冲突。
- **[`rpi-harness` 带入 `rusqlite`(bundled) 与 `rpi-tools` 带入 `image`]** → 编译时间与产物体积上升，需要 C 工具链编译 bundled sqlite。属可接受成本；不落盘语义由我们只使用 `InMemorySessionStorage` 保证，与 `rusqlite` 仅为编译期依赖的事实无关。
- **[Agent 模式错误面更大]** → 失败时保留已到达的 reasoning/content，并把 rpi 的错误转成 `Error`/`Notice` 事件 + 现有失败诊断样式呈现；不新增静默失败路径。

## Migration Plan

1. 新增 `tngui-chat`、`tngui-agent` 两个 workspace member 与 `tngui-app` 的依赖；`tngui-core` 的 `inference` 传输迁入 `tngui-chat`（保持行为不变，先落最小改动，确保对话模式回归通过）。
2. 后端：统一 `InferenceEvent` 事件与两条命令；`Agent 模式` 命令、harness 装配、事件桥、取消接入。
3. 前端：`useInferenceConfig` 增加运行模式与扩展消息模型；`InferenceView` 顶部加 `新会话`（插入 `新对话` 分隔线、只切断请求上下文、保留聊天显示）、原 `重置` 位置换成分段模式切换、移除五步动画、加 `▶解密中` 与工具时间线渲染；`tauri.ts` 更新事件类型与命令。
4. 回滚：本变更为纯增量 + 替换，无数据迁移；回滚即回退改动并移除两个新 crate。唯一破坏性接口是推理事件通道类型（前后端同仓同发，不存在版本错配窗口）。

## Open Questions

- 点击 `新会话` 时未发送的输入草稿是保留还是清空（规格只钉住"保留模型清单/选中模型/思考强度/身份注入/页面选项卡"）；两种做法都不改变规格与任务拆分，实现时按与既有 `重置` 一致（保留草稿）处理即可。
- 工具步骤"结果摘要"的截断长度与展示形式（单行摘要 vs 可展开面板）属渲染细节，可在实现时按现有 UI 风格定稿。
