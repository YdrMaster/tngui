# Tasks

## 1. Crate 骨架与依赖

- [x] 1.1 在 workspace 新增 `tngui-chat` 成员，承载中性消息模型与从 `tngui-core::inference` 迁入的手写 SSE 传输模块。验证：`cargo build -p tngui-chat` 通过，且 `cargo tree -p tngui-chat` 输出不含任何 `rpi-` 包。
- [x] 1.2 在 workspace 新增 `tngui-agent` 成员，依赖 `rpi-ai` / `rpi-agent` / `rpi-tools` / `rpi-harness`（统一 `0.11.0`）。验证：`cargo build -p tngui-agent` 通过，且 `cargo tree -p tngui-agent` 同时列出这四个 `rpi-*` 包。
- [x] 1.3 令 `tngui-app` 依赖 `tngui-chat` 与 `tngui-agent`，并删除 `tngui-core` 中已迁出的 `inference` 传输模块。验证：`cargo build --workspace` 通过，且 `cargo tree -p tngui-core` 输出不含任何 `rpi-` 包。
- [x] 1.4 在仓库文档（`README.md` 或 `docs/`）记录 `tngui-chat` / `tngui-agent` 的职责边界与"core 不依赖 rpi"的约束。验证：文档存在对应小节，且其中 crate 名与 workspace 实际成员一致。
- [x] 1.5 把版本号随本变更推进到 `0.5.0`：workspace `version`、`Cargo.lock` 的四个本地包（`tngui-app` / `tngui-core` / `tngui-chat` / `tngui-agent`）、`frontend/package.json` 与 `frontend/package-lock.json` 全部一致（Tauri 应用版本取自 Cargo workspace 版本，`tauri.conf.json` 不单独声明）。验证：`grep` 全仓无本地包残留 `0.4.11`（第三方 crate 除外），且 `cargo metadata` / `npm pkg get version` 报告的版本均为 `0.5.0`。

## 2. 共用消息模型与统一事件

- [x] 2.1 在 `tngui-chat` 扩展中性消息模型：`role` 增加 `tool`，消息体增加 `tool_calls` 与 `tool_call_id`，并保持 OpenAI 兼容序列化形状（不因新增可选字段改变既有请求字节）。验证：新增 Rust 单测对 `user` / `assistant`(含 `tool_calls`) / `tool` 三类消息做序列化往返。
- [x] 2.2 定义两种模式共用的 `InferenceEvent` 枚举（`TurnStart` / `ReasoningDelta` / `ContentDelta` / `ToolStart` / `ToolEnd` / `Notice` / `Done` / `Error`）及其 serde 形状。验证：单测断言每种事件的 JSON 形状（前端 reducer 依赖该形状）。
- [x] 2.3 前端 `tauri.ts` 增加 `InferenceEvent` 类型；`useInferenceConfig` 的会话消息类型扩展为可承载 `tool` 角色与 `tool_calls` / `tool_call_id`，且上下文逐字携带（不裁剪、不拍平）。验证：`npm run typecheck` 通过，并新增 vitest 断言"含工具往来的会话上下文原样保留"。

## 3. 对话模式迁移（行为等价）

- [x] 3.1 让 `send_inference_stream` 命令改经 `tngui-chat` 发送，并改发统一 `InferenceEvent`（仅 `ReasoningDelta` / `ContentDelta` / `Done` / `Error` 子集），一次调用仍只发一次请求。验证：既有 `send_inference_stream` 单测（system_prompt/`none` 注入、取消竞争、失败诊断脱敏）迁移后全部通过。
- [x] 3.2 前端按统一事件 reducer 渲染对话模式（reasoning / content / 完成 / 失败），保持既有失败摘要与脱敏展示。验证：`InferenceView` 相关 vitest 用例通过。
- [x] 3.3 回归确认对话模式链路上无 rpi：一次点击恰好一次 POST、body 含 `stream: true` 与当前档位 `reasoning_effort`、不发 `x-model`。验证：单测断言请求构造与调用次数。

## 4. Agent 模式后端

- [x] 4.1 在 `tngui-agent` 实现单次运行装配：OpenAI-compatible provider/model（`base_url` 指向反代端口、`reasoning: true`、`thinking_level_map` 令 `Off→"none"` 并钉住 `Low/Medium/High`）、只读工具集 `read` / `ls` / `grep` / `find` + `OsExecutionEnv`（不限制路径）、`InMemorySessionStorage` 会话、空 `resources`、`system_prompt` 承接身份注入。验证：单测断言装配出的工具名集合恰为四个只读工具、`chat_completions_url` 结果为 `/v1/chat/completions`、四档思考强度映射取值正确。
- [x] 4.2 用 `append_message` 灌入既有上下文、以 `send_message` 驱动单次运行、结束后导出消息序列。验证：单测用 fake provider 跑出"user → 工具调用 → 工具结果 → 最终回答"多轮序列，并断言导出结果再作为下一次运行上下文时不失真。
- [x] 4.3 事件适配：实现 `AgentEmitter` 适配器，把 `AgentEvent` 映射为 `InferenceEvent`（运行开始→`TurnStart`；`MessageUpdate`→`ReasoningDelta`/`ContentDelta`；`ToolExecutionStart`/`Update`/`End`→`ToolStart`/`ToolEnd`；`AgentEnd`→`Done`），运行错误→`Error`，轮数上限 `BudgetStop`→`Notice`。验证：单测断言给定 `AgentEvent` 序列得到期望的 `InferenceEvent` 序列。
- [x] 4.4 取消：运行期间监听既有 `request_id` 取消信号，命中即 `AgentHarness::request_abort(run_id)` 并等待收敛，返回 stopped 而非失败。验证：单测断言中途取消会中止工具循环、导出结果标记 stopped。
- [x] 4.5 回环绕过代理与轮数上限默认值：为 provider 关闭 `HTTP_PROXY` / `HTTPS_PROXY`；在进程启动期（命令可执行前）若 `RPI_MAX_TURNS_PER_RUN` 未设置则写入 `30`。验证：单测断言 provider 不复用代理设置，且启动后该环境变量为 `30`、用户已设置时保持用户值。
- [x] 4.6 在文档中记录 Agent 模式的只读工具集、不限制访问路径、无持久化与 `RPI_MAX_TURNS_PER_RUN` 默认 30 的行为。验证：文档小节与实现及规格一致。

## 5. Tauri 命令与事件桥

- [x] 5.1 新增 `run_agent_message` 命令（含 `request_id`、反代端口、模型、api_key、既有会话消息、系统提示、思考强度、`Channel<InferenceEvent>`），复用既有取消注册表，并在命令层完成中性消息 ⇄ rpi 消息的机械转换。验证：`src/lib.rs` 单测（消息转换往返、取消注册/注销幂等）通过。
- [x] 5.2 让 `stop_inference_stream` 对两种模式语义一致（命中取消、忽略迟到增量、释放发送锁）。验证：既有取消测试通过，并补充 Agent 模式取消路径的测试。

## 6. 前端交互

- [x] 6.1 顶部工具条：在模型下拉左侧新增 `新会话` 按钮（无进行中请求且末尾不是分隔线时可交互，点击在聊天 transcript 末尾插入一条 `新对话` 分隔线并清空共享会话/请求上下文，既有聊天记录仍保留显示，模型清单/选中模型/思考强度/身份注入/页面选项卡保留，不弹确认对话框），并移除输入框左侧红色 `重置` 按钮。验证：vitest 断言按钮位置、可交互条件、分隔线插入与请求上下文切断、既有记录仍可见。
- [x] 6.2 原 `重置` 位置改为 `对话模式` / `Agent 模式` 分段切换控件，样式对齐设置页入口配置的本机端口切换控件，且模式按请求生效。验证：vitest 断言控件存在、样式类与设置页一致、切换只影响下一次发送、不清空上下文。
- [x] 6.3 移除五步阶段动画（发送流程不再使用 `SecureFlow`），改为在流式输出光标位置固定显示 `▶解密中`，首个增量到达即被取代，终态移除，两种模式一致。验证：vitest 覆盖"无文本时显示 `▶解密中` / 首增量取代 / 终态消失 / 不再出现阶段动画"。
- [x] 6.4 Agent 模式在单个 assistant 气泡内渲染整轮时间线（推理文本、工具步骤的名称/参数/状态/结果摘要、最终回答），状态随执行变化、被停止记为已取消，消息区自动滚动到底部。验证：vitest 断言单气泡内多轮推理与工具步骤渲染、状态流转与自动滚动。

## 7. 端到端集成验证

- [ ] 7.1 对话模式端到端回归：一次点击只发一次请求、`stream: true`、四档 `reasoning_effort`、上下文含工具往来且不含 reasoning、失败诊断脱敏。验证：`cargo test --workspace` 与 `npm test` 全绿，并人工走一遍真实 tng 链路。
- [ ] 7.2 Agent 模式端到端：一次发送内完成多轮工具调用且只产生一个 assistant 气泡；读取不存在/无权限路径表现为工具失败而非崩溃；达到 30 轮上限时以终止摘要收尾；停止能中止工具循环。验证：人工走查并核对第 4 节的自动化用例。
- [ ] 7.3 进程内状态与不落盘：切页保留会话、模式、时间线与进行中的工具循环；`新会话` 清空共享会话；退出进程不恢复；全流程不新增会话或工具记录文件。验证：人工走查，并断言运行前后工作目录无新增状态文件。

## Workflow follow-up

- 评审通过后归档本变更（`$openspec-archive-change`），并核对归档后的 `openspec/specs/gui-shell/spec.md` 已反映运行模式、共享会话、Agent 工具调用、`新会话` 控件与 `▶解密中` 指示。
