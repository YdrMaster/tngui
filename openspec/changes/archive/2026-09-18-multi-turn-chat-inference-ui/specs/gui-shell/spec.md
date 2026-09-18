# Spec Delta

## MODIFIED Requirements

### Requirement: 密态推理模型清单驱动测试请求

系统须（SHALL）在密态推理视图提供当前 GUI 会话内的多轮对话请求面板。面板的“可发”门锁须（SHALL）同时满足：概览“运行状态”为“运行”、本机已配置 api-key、模型发现请求成功返回至少一个模型，且当前选中模型属于最新模型清单。

发送时按 OpenAI compatible 格式 POST 到 tngui 反代对外端点，携带 `Authorization: Bearer <apiKey>` 与 `{model, messages, stream: true, reasoning_effort}` body。`stream` 恒为 `true`。`messages` 须（SHALL）包含当前 GUI 会话中此前已完整完成的 user 消息与 assistant 最终 `content`，并追加本轮用户输入原文；assistant 的 `reasoning` 绝不（MUST NOT）进入后续请求上下文，失败、中断或用户主动停止的 assistant 消息也不得作为已完成上下文传给模型。系统不得（MUST NOT）对用户输入内容做 trim 或其他本地格式化。系统绝不（MUST NOT）在前端或反代中另发 `x-model` 头；模型身份由反代按 body.model 改写请求 path。

响应须（SHALL）按 OpenAI compatible SSE 数据流逐事件处理，并保留事件到达顺序：每节非空 `choices[0].delta.reasoning` 和每节非空 `choices[0].delta.content` 均须（SHALL）作为带类型的增量交给聊天 UI；不含 reasoning/content、或对应字段为空的事件须（SHALL）跳过。收到 `data: [DONE]` 时标记当次响应完整完成。推理流在 `[DONE]` 前中断（连接断开、提前 EOF 或事件解析失败）时，系统须（SHALL）保留已到达的 reasoning 与 content、标注当次响应不完整并给出失败摘要，绝不（MUST NOT）清空或改写已到达文本。失败诊断中的 Authorization 须（SHALL）脱敏。

密态推理请求面板的模型控件须（SHALL）是基于 `/v1/models` 响应创建的选项下拉菜单。系统须（SHALL）解析 OpenAI compatible 响应中的 `data[].id` 作为模型 ID，只允许用户在下拉选项之间切换，不得提供自由文本输入、创建新值、空选项或清除选择。GUI 进程内存中的模型清单、选中模型、对话消息与思考强度须（SHALL）在应用内页面导航之间保留；GUI 进程退出后不得保留，也绝不（MUST NOT）写入 tng 配置或设置缓存。RA 过程保持占位。

#### Scenario: 可发判定包含运行态、api-key 与清单内选中模型

- **WHEN** 用户处于密态推理请求面板
- **THEN** 面板仅在概览运行态、api-key、模型发现成功、模型清单非空与清单内选中模型同时满足时可发送

#### Scenario: 多轮请求携带完整消息上下文

- **WHEN** 上一轮 user 输入和 assistant 最终回答均已完成，用户发送下一轮输入
- **THEN** 请求 body 的 `messages` 依次包含此前 user 消息、此前 assistant 最终 `content` 和本轮 user 输入原文，并携带 `"stream": true` 与当前思考强度对应的 `reasoning_effort`

#### Scenario: reasoning 不进入后续上下文

- **WHEN** 上一轮 assistant 响应包含 reasoning 与最终 content，并作为已完成消息保留在聊天 UI 中
- **THEN** 下一轮请求 `messages` 中的 assistant 消息只包含最终 `content`，不包含 reasoning

#### Scenario: 失败响应不进入后续上下文

- **WHEN** 上一轮 assistant 响应失败或在 `[DONE]` 前中断
- **THEN** 该 assistant 消息仍可在聊天 UI 中展示失败或部分内容，但不作为已完成上下文进入下一轮请求 `messages`

#### Scenario: thinking 模型增量按类型分流

- **WHEN** SSE 流依次返回包含 `delta.reasoning`、空 `delta`、包含 `delta.content` 与 `data: [DONE]` 的事件
- **THEN** 系统按到达顺序把非空 reasoning 和 content 区分为两种增量交给聊天 UI，跳过空增量，收到 `[DONE]` 后标记当次响应完整完成

#### Scenario: 断流保留部分文本并标注不完整

- **WHEN** SSE 流在 `[DONE]` 前已到达部分 reasoning 与部分 content 后中断
- **THEN** 聊天 UI 保留已到达的 reasoning 与 content，标注响应不完整，并显示含脱敏请求信息的失败摘要；不清空或改写已到达文本

#### Scenario: 模型发现返回空列表

- **WHEN** `/v1/models` 成功返回空模型清单
- **THEN** 模型下拉菜单不可交互并显示文本 `未检测到密态模型`；发送按钮不可交互，系统不以空模型发送请求

#### Scenario: 多模型默认选中且可切换

- **WHEN** `/v1/models` 成功返回多个模型 ID
- **THEN** 模型下拉菜单默认选中返回清单中的第一个 ID，用户可切换为清单内其他 ID；下拉菜单不提供空选项，也不允许清除选择或提交任意输入文本

#### Scenario: 模型清单刷新保留或回落选择

- **WHEN** `/v1/models` 成功返回新模型清单
- **THEN** 若当前选中 ID 仍在新清单中则保持选中；若不在新清单中则选中新清单第一个 ID；若新清单为空则清空选中并按空列表规则禁用

#### Scenario: 进程内状态跨页面保留且不落盘

- **WHEN** 用户进行多轮对话、调整思考强度并保留输入草稿后切换到概览或设置页，再返回密态推理页
- **THEN** 对话消息、模型清单、选中模型、思考强度、输入草稿和页面选项卡保持不变，且不写入 tng 配置或设置缓存

#### Scenario: 进程退出不恢复旧状态

- **WHEN** 用户关闭 GUI 进程后重新启动应用
- **THEN** 密态推理页回到默认状态，不从前次进程恢复模型清单、选中模型、思考强度或对话消息

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** 底部聊天输入框清空，输入原文立即保留为右侧用户气泡；上一轮 assistant 进入终态后可发送下一轮多轮请求

#### Scenario: prompt 按内容自动伸缩

- **WHEN** 用户在底部聊天输入框中增删内容
- **THEN** 输入框高度自动增高或收缩，最小 1 行、最大显示 8 行；超过 8 行后内部纵向滚动，且拖拽角不能改变其高度

#### Scenario: 发送按钮图标垂直居中且无遗留提示框

- **WHEN** 渲染可交互的发送按钮
- **THEN** 按钮内图标与文字垂直居中；按钮下方不出现单独的蓝色锁形提示框，且一轮请求未终态前不能再发起并行请求

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND 概览显示“运行” AND api-key 已配置 AND 模型在下拉清单中被选中
- **THEN** 系统向 tngui 反代对外端点发 POST，不直连 tng 内部 ingress 端口；请求经 pre-TNG path 注入代理进入 TNG

#### Scenario: 请求体携带 stream true

- **WHEN** 用户点击发送且满足可发门锁
- **THEN** 发往反代的 JSON body 含 `"stream": true`，含当前多轮 `messages` 和当前思考强度对应的 `reasoning_effort`；系统不构造非流式请求

#### Scenario: 首个增量到达即开始渐进渲染

- **WHEN** 推理请求已发出且首个非空 reasoning 或 content 增量到达
- **THEN** 客户端立即接收并缓冲该增量，但不中断阶段动画，也不在阶段卡附近渲染文本；满足三条件揭示契约后才开始渐进渲染

#### Scenario: 后续增量逐节追加

- **WHEN** 输出已揭示且 SSE 流继续返回 reasoning 或 content 增量
- **THEN** assistant 气泡按到达顺序分别追加到 reasoning 或 content 区域，不丢弃或重排事件

#### Scenario: 收到 DONE 标记完整完成

- **WHEN** SSE 流返回 `data: [DONE]` 事件
- **THEN** 系统停止追加并把当次响应在协议层标记为完整完成；若输出尚未揭示，则等待揭示后显示完整态，不得提前清空阶段卡

#### Scenario: 无内容事件不产生空渲染

- **WHEN** SSE 事件不含非空 `delta.reasoning` 或 `delta.content`（如首节仅含 role、终止节仅含 finish_reason）
- **THEN** 该事件被跳过，不向 assistant 气泡追加空文本或空占位内容，也不改变阶段动画

#### Scenario: 单模型自动选中

- **WHEN** `/v1/models` 成功返回一个模型 ID
- **THEN** 模型下拉菜单显示并选中该模型 ID；用户无需先手动选择即满足模型侧发送条件

#### Scenario: 模型发现失败区别于空列表

- **WHEN** `/v1/models` 请求失败或返回不能解析的响应
- **THEN** 请求面板显示明确的模型发现失败状态；发送按钮不可交互，且界面不得把失败状态显示为 `未检测到密态模型`

#### Scenario: 模型选项不允许自由输入

- **WHEN** 用户查看或操作模型下拉控件
- **THEN** 界面只允许选择 `/v1/models` 返回的模型 ID；搜索或输入行为只能用于过滤既有选项，不能创建、提交或把文本当作模型 ID

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求或关闭 GUI
- **THEN** 当前 GUI 会话的聊天 transcript 可继续显示既有对话并携带已完成上下文，但不写入任何持久化存储；失败或中断的 assistant turn 不进入下一轮请求上下文

#### Scenario: 失败响应框展示脱敏请求与响应调试内容

- **WHEN** 密态推理发送失败（连接失败、非 2xx、2xx 但响应不满足 SSE data 事件语义，或流中断）
- **THEN** assistant 气泡显示失败摘要、脱敏请求与响应原文；请求中的 `Authorization` 值必须脱敏；流中断场景已到达的 reasoning/content 保留显示

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据

### Requirement: 密态推理发送阶段垂直转场

系统须（SHALL）在每轮推理请求发送期间、流式输出尚未揭示前，把左侧 assistant 气泡中的五步安全流程呈现为单张当前阶段卡：显示当前阶段的图标、阶段标题和阶段说明；上方只提供进度点/序号等小型阶段指示，不得把五个阶段节点横向一字铺开。发送阶段推进时，前一阶段卡须（SHALL）向上淡出，新到达阶段卡须（SHALL）从下方淡入；切换区域须（SHALL）使用固定占位高度，不得因阶段切换引发气泡高度跳变。阶段内容与现有五步安全语义一致，继续保留现有线性进度条。

后台推理流与阶段动画并发执行。在输出揭示前，客户端须（SHALL）继续接收并缓冲非空 reasoning/content 增量，但不得在阶段卡中或阶段卡下方渲染这些增量。仅当以下三个条件同时满足时，阶段卡才须（SHALL）消失并揭示缓冲输出：

1. 五步阶段动画已经播放到最后一个阶段；
2. 最后一个阶段卡片已经显示至少 0.5 秒；
3. 已收到至少 1 个 reasoning 或 content 增量。

若最后一个阶段卡已显示至少 0.5 秒但尚未收到任何增量，系统须（SHALL）保持最后阶段卡等待；后续收到首个增量时若第三个条件尚不满足，须（SHALL）等该条件满足后再揭示。若网络流在揭示前已成功完成，系统须（SHALL）保持阶段展示直到揭示条件满足，一次性显示缓冲内容并进入完成态。若流失败，系统须（SHALL）进入失败终态，保留已到达的 reasoning/content 和脱敏诊断。输出揭示后，后续增量须（SHALL）实时渲染，整个聊天消息区域须（SHALL）自动滚动到底部以持续显示最新输出。

当用户声明偏好减少动态效果时，系统须（SHALL）禁用垂直位移动画；阶段内容可直接切换，但不得再横向展开。

#### Scenario: 阶段动画完整播放

- **WHEN** 用户发送请求且流式输出尚未满足揭示条件
- **THEN** assistant 气泡内按现有五步顺序播放单张当前阶段卡和线性进度条，阶段切换高度保持稳定，不把五个阶段横向铺开

#### Scenario: 后台增量先到时保持缓冲

- **WHEN** reasoning 或 content 增量在阶段动画仍在中途时到达
- **THEN** 客户端继续接收并缓冲该增量，但不渲染文本，也不中断或重置阶段动画

#### Scenario: 满足揭示条件后关闭阶段卡

- **WHEN** 阶段动画已到达最后阶段，最后阶段卡已显示 0.5 秒，且至少一个 reasoning 或 content 增量已到达
- **THEN** 阶段卡消失，assistant 气泡开始显示缓冲输出的两类文本，后续增量继续实时追加

#### Scenario: 无增量时保留最后阶段卡

- **WHEN** 阶段动画已播放到最后一个阶段并保持超过 0.5 秒，但尚未收到任何非空 reasoning/content 增量
- **THEN** 最后阶段卡继续显示，不显示空输出，也不提前进入完成态

#### Scenario: 流先完成也等待揭示

- **WHEN** SSE 流在阶段动画未完成或最后阶段卡未显示满 0.5 秒时已收到 `data: [DONE]`
- **THEN** 系统保留已完成输出，等待揭示条件满足后再显示该输出并标记完整完成

#### Scenario: 揭示后自动跟随最新输出

- **WHEN** 输出已揭示且 reasoning 或 content 持续追加
- **THEN** 整个聊天消息区域自动滚动到底部，始终展示最新输出，而不是只滚动单个响应文本区域

#### Scenario: 失败进入终态

- **WHEN** 输出揭示前后流发生非 2xx、断流或解析失败
- **THEN** assistant 气泡进入失败终态，保留已到达的 reasoning/content、显示不完整或失败标注，并展示 Authorization 已脱敏的调试详情

#### Scenario: 发送中只显示当前阶段卡

- **WHEN** 用户发送推理请求且 assistant 气泡处于输出揭示前
- **THEN** 气泡内以小型阶段指示加一个当前阶段卡展示，不出现五个阶段节点横向排布

#### Scenario: 阶段推进向上淡出并向下滑入

- **WHEN** 输出尚未揭示且发送阶段从任一阶段推进到下一阶段
- **THEN** 前一阶段卡向上淡出，当前阶段卡从下方淡入，形成垂直幻灯片式转场

#### Scenario: 首个增量到达后阶段卡停止推进

- **WHEN** 首个非空 reasoning/content 增量到达而输出尚未揭示
- **THEN** 增量进入后台缓冲，阶段动画继续按原节奏推进；本变更取代旧的“首个增量冻结阶段”行为

#### Scenario: 阶段切换不抖动布局

- **WHEN** 阶段卡内容切换
- **THEN** 转场区域高度保持稳定，assistant 气泡和聊天 transcript 不发生发送阶段的上下抖动

#### Scenario: 阶段文案保持安全语义

- **WHEN** 发送阶段进入“建立加密通道”
- **THEN** 阶段说明表述为 OHTTP 加密并绑定网关证明后再发送，不出现“RATS-TLS 会话绑定”等错误表述

#### Scenario: 减少动态效果回退

- **WHEN** 用户系统偏好为减少动态效果
- **THEN** 阶段切换不随动垂直位移或淡入淡出，内容直接切换，并不横向展开五节点

### Requirement: 密态推理多轮对话界面

系统须（SHALL）以固定高度的多轮聊天区域承载密态推理请求调试：历史消息按时间顺序渲染，用户消息靠右侧气泡显示，assistant 消息靠左侧气泡显示；模型选择和可发状态保留在聊天区域上方。用户输入框须（SHALL）固定在聊天区域下方，默认呈现 1 行高度，随内容自动增长，最高显示 8 行；超过 8 行后在输入框内部纵向滚动，不得让整个页面因输入内容持续撑大。输入框右侧主操作控件须（SHALL）在空闲或上一轮终态时显示“发送”，在本轮请求未终态时显示“停止”。

用户发送后，输入框须（SHALL）清空，用户输入原文须（SHALL）立即显示为右侧气泡；随后须（SHALL）立即创建左侧 assistant 气泡承载阶段动画或响应输出。聊天消息区域在整个流式过程中须（SHALL）使用固定高度的纵向滚动容器，接收新消息或增量时自动滚动到底部；流式完成或失败不改变消息区域高度。界面不得（MUST NOT）显示“本客户端不是聊天工具”或“不提供会话历史、多轮对话管理”提示。

#### Scenario: 用户输入立即进入右侧气泡

- **WHEN** 用户输入非空内容并触发发送
- **THEN** 输入框清空，用户输入原文立即作为右侧用户气泡显示在聊天区域内

#### Scenario: assistant 气泡立即出现

- **WHEN** 右侧用户气泡加入聊天区域
- **THEN** 左侧 assistant 气泡立即出现并进入当轮阶段动画或响应状态

#### Scenario: 输入框高度一至八行自动调整

- **WHEN** 用户在输入框中增删内容
- **THEN** 输入框默认高度为 1 行，内容增加时自动增高，最高显示 8 行；超过 8 行后输入框内部纵向滚动且页面高度不随输入持续增长

#### Scenario: 聊天消息区域高度稳定

- **WHEN** assistant reasoning/content 流式持续超过消息区域可显示高度，或响应结束进入完成态
- **THEN** 消息区域保持固定高度并在内部纵向滚动，不出现流式期间撑大响应框、结束后收缩的布局变化

#### Scenario: 新输出始终可见

- **WHEN** 新消息加入或流式增量追加导致消息内容超过当前可视高度
- **THEN** 聊天消息区域自动滚动到底部，始终显示最新输出

#### Scenario: 不显示非聊天客户端提示

- **WHEN** 渲染密态推理请求调试页面
- **THEN** 界面不显示“本客户端不是聊天工具”以及不提供会话历史、多轮对话管理的提示

#### Scenario: 主操作按钮随请求状态切换

- **WHEN** 没有请求进行中或上一轮 assistant 已进入终态
- **THEN** 底部输入框右侧主操作按钮显示并发送新消息；当本轮请求尚未进入终态时，该按钮显示并提供“停止”操作

### Requirement: 密态推理思考强度控制

系统须（SHALL）在模型选择控件右上角提供“思考强度”滑块控件，停靠值为“关 / 低 / 中 / 高”，默认值为“中”。控件值须（SHALL）按以下映射进入每轮推理请求：关 → `reasoning_effort: "none"`；低 → `"low"`；中 → `"medium"`；高 → `"high"`。控件状态仅保留在 GUI 进程内存中，不得（MUST NOT）写入设置缓存或 tng 配置。

滑块调整不得（MUST NOT）改变已经发出的进行中请求，只影响下一次发送。系统不得（MUST NOT）向用户提供 `thinking_token_budget` 输入或 token 数值控制。思考强度在应用内页面导航之间随推理页进程内存状态保留，GUI 进程退出后重置为默认值。

#### Scenario: 默认中强度

- **WHEN** GUI 进程首次打开密态推理视图
- **THEN** 思考强度滑块选中“中”，下一次请求携带 `reasoning_effort: "medium"`

#### Scenario: 滑块映射请求字段

- **WHEN** 用户分别选择“关”“低”“中”“高”后发送请求
- **THEN** 请求 body 依次携带 `reasoning_effort` 为 `none`、`low`、`medium`、`high`

#### Scenario: 调整不影响进行中请求

- **WHEN** 一轮请求仍在阶段动画、流式接收或终态完成前
- **THEN** 调整思考强度滑块只更新下一次请求使用的值，不修改进行中请求已发送的 body，也不重启 TNG

#### Scenario: 不暴露 token budget

- **WHEN** 渲染密态推理请求调试页面
- **THEN** 界面不提供 `thinking_token_budget` 文本框、滑块或数值显示作为用户可编辑配置

### Requirement: 密态推理页面进程内状态保留

系统须（SHALL）在 GUI 进程存续期间，跨应用内页面导航完整保留密态推理页的页面状态与进行中推理状态。保留范围至少须（SHALL）包含：当前选项卡、未发送输入草稿、聊天消息与滚动位置、每个 assistant turn 的阶段/流式/完成/失败/停止状态与已到达 reasoning/content、失败诊断、发送锁、模型发现状态与清单、选中模型和思考强度。

切换离开密态推理页不得（MUST NOT）重置上述状态、取消正在进行的流式请求或清理阶段动画 timer；流式请求、阶段状态机和模型发现状态须（SHALL）继续在后台推进。返回密态推理页时须（SHALL）直接呈现当前状态；若离开期间有新输出到达，聊天消息区域须（SHALL）滚动到底部显示最新内容。GUI 进程退出后上述状态须（SHALL）全部丢弃；系统不得（MUST NOT）把推理页状态写入设置缓存、tng 配置或任何文件，重新启动进程后须（SHALL）回到默认状态。

#### Scenario: 应用内切页保留完整状态

- **WHEN** 用户在推理页保留未发送草稿、选择模型与思考强度，且存在正在流式输出的 assistant turn，随后切换到概览或设置页
- **THEN** 推理页实例仍保活，输入草稿、聊天记录、模型状态、思考强度、阶段/流式状态、诊断与发送锁不重置；进行中的流式请求与阶段状态机继续推进

#### Scenario: 返回后展示离开期间的新输出

- **WHEN** 推理页处于后台时收到新的 reasoning/content 增量或进入终态，用户随后返回推理页
- **THEN** assistant 气泡展示最新状态，聊天消息区域滚动到底部，不重启请求、不重复追加 delta，也不因页面切换显示默认空态

#### Scenario: 进程退出后不恢复状态

- **WHEN** GUI 进程退出
- **THEN** 推理页选项卡、输入草稿、聊天记录、模型清单、选中模型、思考强度和进行中状态全部丢弃；重新启动进程后显示默认状态

#### Scenario: 切页不触发落盘

- **WHEN** 用户离开或返回密态推理页
- **THEN** 系统不为保留推理页状态写入设置缓存、tng 配置或其它文件；仅有既有设置缓存语义继续处理 API Key 与 TNG 配置，且不包含推理页状态

## ADDED Requirements
### Requirement: 密态推理停止响应控制

系统须（SHALL）允许用户在本轮推理请求尚未进入终态时主动停止推理。用户点击停止后，系统须（SHALL）立即把当轮 assistant 消息标记为 `stopped` 终态并向后端发出取消指令；取消须（SHALL）终止当前 SSE 读取和传输连接，忽略取消后迟到的 reasoning/content 增量，清理阶段动画 timer 并释放发送锁。主动停止不得（MUST NOT）被视为网络或协议错误，也不得（MUST NOT）显示失败诊断。

停止时的显示语义须（SHALL）按揭示状态区分：

1. 输出已经揭示并处于流式输出状态时，已显示的 reasoning/content 须（SHALL）按原样保留，系统停止追加后续增量；
2. 输出尚未揭示且仍在阶段动画或最终卡等待阶段时，系统须（SHALL）不显示任何后台缓冲 chunk，如同没有收到任何增量；阶段卡消失，assistant 气泡正文保持空白，仅显示“已停止⚪响应不完整”。

进入 `stopped` 终态后，该 assistant 消息须（SHALL）继续保留在聊天 transcript 中，但不得（MUST NOT）作为已完成上下文进入后续请求 `messages`。应用内切换到其他页面不得（MUST NOT）自动停止请求；返回推理页后，请求仍未终态时须（SHALL）继续提供停止操作。

#### Scenario: 流式输出中停止保留已显示内容

- **WHEN** assistant 气泡已揭示并显示部分 reasoning/content，用户点击“停止”
- **THEN** 系统取消推理流并停止追加新内容，已显示的 reasoning/content 保持原样，气泡标记“已停止⚪响应不完整”

#### Scenario: 阶段动画中停止不揭示缓冲

- **WHEN** assistant 仍处于输出揭示前的阶段动画状态，后台已接收至少 1 个隐藏缓冲 chunk，用户点击“停止”
- **THEN** 阶段卡和阶段动画消失，隐藏的 reasoning/content 不被显示，assistant 气泡正文保持空白并标记“已停止⚪响应不完整”

#### Scenario: 停止后忽略迟到增量

- **WHEN** 用户点击停止后，Tauri 通道随后仍收到 reasoning 或 content 增量
- **THEN** 迟到增量被忽略，不追加到 stopped 气泡，也不把状态改回生成中或完成

#### Scenario: 停止后可发送下一轮

- **WHEN** 一轮 inference 进入 stopped 终态
- **THEN** 发送锁释放，输入区主按钮恢复为“发送”，用户可发起新一轮请求

#### Scenario: 停止消息不进入后续上下文

- **WHEN** 上一轮 assistant 因用户点击停止进入 stopped 终态，随后用户发送新输入
- **THEN** 新请求不携带被停止 assistant 消息的 reasoning 或 content；该消息仍可见于聊天 transcript

#### Scenario: 切页不自动停止但返回后可停止

- **WHEN** 本轮推理尚未终态，用户切换到概览或设置页再返回推理页
- **THEN** 系统不自动取消请求，推理状态继续后台推进；返回后主按钮仍为“停止”并可执行取消

### Requirement: 密态推理响应气泡状态颜色

系统须（SHALL）用轻量、低饱和且协调的气泡颜色呈现对话状态：用户输入气泡，以及处于阶段动画、已揭示流式输出和完整完成状态的 assistant 气泡，均须（SHALL）使用同一淡绿色；用户主动停止的 assistant 气泡须（SHALL）为淡金色；异常中断或失败的 assistant 气泡须（SHALL）为淡红色。进行中的 assistant 气泡不得（MUST NOT）提前呈现淡金或淡红色；状态标签仍须（SHALL）区分安全链路、生成中和完整完成。气泡文字须（SHALL）保持高对比深色。

#### Scenario: 正常对话使用淡绿色气泡

- **WHEN** 用户发送输入，assistant 后续处于阶段动画、流式输出或收到 `data: [DONE]` 后的完整完成状态
- **THEN** 右侧用户气泡与该左侧 assistant 气泡始终呈现同一淡绿色风格；状态标签区分“安全链路”“生成中”与完成，但气泡底色不切换

#### Scenario: 主动停止使用淡金色气泡

- **WHEN** 用户点击停止且 assistant 气泡进入 stopped 终态
- **THEN** 该 assistant 气泡呈现淡金色风格，状态标识使用警示/停止语义，并显示“已停止⚪响应不完整”

#### Scenario: 异常中断使用淡红色气泡

- **WHEN** assistant 响应因连接失败、非 2xx、SSE 解析失败或 `[DONE]` 前断流进入 failed 终态
- **THEN** 该 assistant 气泡呈现淡红色风格，状态标识使用错误/失败语义，已到达内容按失败契约保留显示

#### Scenario: 进行中气泡使用正常淡绿色

- **WHEN** assistant 处于阶段动画或已揭示但仍流式输出
- **THEN** 气泡使用与用户输入和完整响应相同的淡绿色，不提前变为淡金色或淡红色
