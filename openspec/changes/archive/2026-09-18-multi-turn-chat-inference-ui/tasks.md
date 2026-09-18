# Tasks

## 1. 推理协议契约与核心流解析

- [x] 1.1 在 `tngui-core/src/inference.rs` 定义并导出带 serde 契约的 `InferenceMessage`、`InferenceEffort`、`InferenceDelta` 与 `InferenceDeltaKind`，只允许 `user`/`assistant` 角色和 `none`/`low`/`medium`/`high` 强度；用核心单元测试覆盖合法序列化和非法角色拒绝，并运行 `cargo test -p tngui-core inference` 验证。
- [x] 1.2 将 core `send_inference_stream` 的单条 `prompt` 参数升级为 `messages` + `reasoning_effort`，组装 `{model, messages, stream: true, reasoning_effort}` 请求体；使用 fake HTTP server 测试多轮 body、默认传入 `medium`、恒定 `stream: true`、不注入 `x-model`，并用 `cargo test -p tngui-core inference` 验证。
- [x] 1.3 将 SSE 解释结果升级为 reasoning/content 双类型增量：按到达顺序解析非空 `choices[0].delta.reasoning` 与 `choices[0].delta.content`，跳过 role、空 delta 和终态事件，保留 `[DONE]` 完成语义与既有失败诊断脱敏；新增覆盖 role→reasoning→空 delta→content→`[DONE]` 顺序与断流场景的核心测试，并运行 `cargo test -p tngui-core inference` 验证。
- [x] 1.4 将 `src/lib.rs` 的 Tauri command 与 `frontend/src/tauri.ts` wrapper 更新为 typed `messages`、`reasoning_effort` 和 `Channel<InferenceDelta>`，保持 Authorization 只在请求头、模型身份只来自 body、前端不发送 `x-model` 或 `stream`；更新 `frontend/src/tauri.test.ts` 的 invoke payload 与 typed channel 断言，并运行 `npm --prefix frontend test -- tauri.test.ts` 验证。

## 2. 前端多轮对话与状态机

- [x] 2.1 将 `InferenceView.vue` 的单 prompt/output 状态替换为 GUI 进程内存中的消息列表、输入草稿和逐 assistant turn 的 `stage-playing`/`streaming`/`complete`/`failed` 状态；发送时立即追加右侧 user 气泡、清空输入框并立即创建左侧 assistant 气泡；组件测试覆盖立即渲染、无持久化调用、一轮未终态前不能再发送，以及切页返回后草稿和消息不重置。
- [x] 2.2 实现多轮请求上下文构造：包含历史 user 原文与已完成 assistant 最终 `content`，绝不携带 assistant `reasoning`，排除失败或中断的 assistant turn，且不 trim 用户输入；组件测试用连续两次发送断言 `messages` 数组与中强度字段，并验证不调用设置缓存或 TNG 配置持久化 API。
- [x] 2.3 将请求调试页改为单卡片多轮聊天布局：顶部为模型选择和默认“中”的思考强度滑块（关/低/中/高），固定高度 transcript 中用户消息靠右、assistant 消息靠左，底部 textarea 默认 1 行、最多 8 行后内部滚动；移除“本客户端不是聊天工具”提示；组件测试覆盖布局层级、1–8 行 autosize 参数、滑块默认值与禁止显示旧警告。
- [x] 2.4 实现按钮与状态渲染：发送期间显示 loading 且不可再次发起，reasoning 展示为独立的“思考过程”区域、content 展示为最终回答，完成后显示成功态、失败/断流时保留已到达文本并显示“响应不完整”和脱敏诊断；组件测试覆盖完成、失败、无 delta 失败和后续上下文排除。
- [x] 2.5 为每个 assistant turn 实现 520ms 五步阶段动画、最终阶段 500ms hold、后台 reasoning/content 缓冲和三条件揭示状态机；用 fake timers 或可注入延迟测试 early delta 缓冲、最终阶段 500ms 后无 delta 持续等待、首个 delta 到达后揭示、`[DONE]` 先到时等待揭示后完成、失败立即进入终态，并确认 timer 只在终态或应用最终卸载时清理，页面 deactivated 不清理。
- [x] 2.6 揭示后实时追加 reasoning/content 增量，并让整个固定高度聊天 transcript 在新消息、揭示和每个后续增量后自动滚动到底部；组件测试断言滚动发生在 transcript 容器而不是单条响应文本区域，完成/失败不改变 transcript 高度。
- [x] 2.7 实现思考强度滑块映射与作用域：进程内默认 `medium`，四档分别发送 `none`/`low`/`medium`/`high`，只在下一次发送生效，应用内切页保留当前值，不提供 `thinking_token_budget` 控件；组件测试覆盖默认值、四档请求字段、请求中调整不改已发出请求、切页保留当前值，以及 UI 文本不包含 token budget 配置项。
- [x] 2.8 在 `App.vue` 中用 `<KeepAlive include="InferenceView">` 缓存密态推理页，并为 `InferenceView.vue` 显式命名；页面切换只触发 deactivated/activated，不重置当前选项卡、输入草稿、聊天记录、模型清单/选中模型、思考强度、发送锁、诊断、阶段/流式状态或 in-flight Tauri 请求；返回时把 transcript 滚到底部显示离开期间的新输出；组件测试模拟切页离开/返回和进程退出默认值，并断言不调用设置缓存或 TNG 配置写入 API。

## 3. 文档与回归验证

- [x] 3.1 更新 `docs/tngui-ui-guide.md` 的密态推理调试章节，从“单次请求、不保留会话历史”改为多轮聊天、1–8 行输入框、阶段缓冲揭示、reasoning/content 分区、默认中强度、应用内切页进程内存保留和进程退出不落盘的行为说明；用文档检查确认没有旧提示或旧单请求措辞残留。
- [x] 3.2 跑完整自动化回归：`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`、`npm --prefix frontend test` 与 `npm --prefix frontend run build` 全部通过；同时确认测试中没有明文 API Key。
- [x] 3.3 使用本地 `resources/tng-linux-x86_64` 的 nora 模式和用户运行时提供的凭据做 vLLM 0.26 smoke 验证（凭据只进入进程参数，不写入源码、文档、设置缓存或日志）；验证默认 `medium` 能回收 `delta.reasoning`/`delta.content`、关档无 reasoning、多轮 body 符合预期、失败诊断已脱敏、流式过程中切换到概览/设置再返回后状态与增量连续；完成后关闭本地进程，确认重启进程后推理状态回到默认值，且未留下任何 credential artifact。

## 4. 停止推理与气泡状态视觉

- [x] 4.1 在 core / Tauri 契约中为推理请求增加稳定请求 ID 与显式 `Stopped` 结果，实现取消注册表和 `stop_inference_stream` 命令；停止时关闭进行中的 TCP / SSE 流，正常完成、停止、失败和命令清理均移除注册表项；用 core 与 Tauri 契约测试覆盖停止、停止后不追加 delta、完成与停止竞态幂等，并运行 `cargo test -p tngui-core inference` 验证。
- [x] 4.2 将前端底部主按钮实现为空闲/终态“发送”、请求中“停止”的双态控件；实现 `stopped` 终态、流式中停止保留已显示内容、阶段动画中停止丢弃隐藏缓冲并显示空白气泡、忽略迟到 chunk、清理阶段 timer、释放发送锁和排除后续上下文；组件测试覆盖流式中停止、阶段动画中停止、迟到 delta、停止后立即可发下一轮、切页返回后仍可停止，并运行相关 frontend 组件测试验证。
- [x] 4.3 为聊天气泡实现协调状态视觉：用户输入、进行中（阶段动画/流式输出）与完整 assistant 响应为同一淡绿色，用户主动停止为淡金色、异常中断/失败为淡红色；组件测试断言状态类、颜色 token 使用和状态切换，禁止进行中提前染成淡金或淡红。
- [x] 4.4 更新 `docs/tngui-ui-guide.md` 的主动停止、气泡状态颜色和停止后上下文行为说明；重跑 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`、`npm --prefix frontend test` 与 `npm --prefix frontend run build`，并用本地 vLLM 0.26 长流验证流式中停止保留部分输出、阶段动画中停止显示空白气泡、停止后下一个请求不携带被停止 assistant turn。
