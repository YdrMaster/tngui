# Spec Delta

## MODIFIED Requirements

### Requirement: 密态推理模型清单驱动测试请求

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板。面板的“可发”门锁须（SHALL）同时满足：概览“运行状态”为“运行”、本机已配置 api-key、模型发现请求成功返回至少一个模型，且当前选中模型属于最新模型清单。发送时按 OpenAI 兼容格式 POST 到 tngui 反代对外端点，携带 `Authorization: Bearer <apiKey>` 和 `{model, messages, stream: true}` body——`stream` 恒为 `true`，系统不依赖上游非流式全量响应。响应须（SHALL）按 OpenAI 兼容 SSE 数据流逐事件处理：每节 `choices[0].delta.content` 文本到达即向输出区增量渲染，无需等待后续事件或流结束；收到 `data: [DONE]` 时标记当次响应完整完成。推理流在 `[DONE]` 前中断（连接断开、提前 EOF 或事件解析失败）时，系统须（SHALL）保留已到达的增量文本、标注当次响应不完整并给出失败摘要，绝不（MUST NOT）清空或改写已渲染文本。系统绝不（MUST NOT）在前端或反代中另发 `x-model` 头；模型身份由反代按 body.model 改写请求 path。输出区只显示当次响应，再次发送须（SHALL）先清空此前内容；RA 过程保持占位。

密态推理请求面板的模型控件须（SHALL）是基于 `/v1/models` 响应创建的选项下拉菜单。系统须（SHALL）解析 OpenAI 兼容响应中的 `data[].id` 作为模型 ID，只允许用户在下拉选项之间切换，不得提供自由文本输入、创建新值、空选项或清除选择。

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: prompt 按内容自动伸缩

- **WHEN** 用户在 prompt textarea 中增删内容
- **THEN** textarea 高度自动增高或收缩，最小 4 行、最大 16 行；达到最大高度后内容滚动，且拖拽角不能改变其高度

#### Scenario: 发送按钮图标垂直居中且无遗留提示框

- **WHEN** 渲染可交互的“发送测试请求”按钮
- **THEN** 按钮内图标与文字垂直居中；按钮下方不出现单独的蓝色锁形提示框

#### Scenario: 可发判定包含运行态、api-key 与清单内选中模型

- **WHEN** 渲染密态推理视图的请求面板
- **THEN** 面板仅在概览运行态、api-key、模型发现成功、模型清单非空与清单内选中模型同时满足时可发送

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND 概览显示“运行” AND api-key 已配置 AND 模型在下拉清单中被选中
- **THEN** 系统向 tngui 反代对外端点发 POST，不直连 tng 内部 ingress 端口；请求经 pre-TNG path 注入代理进入 TNG

#### Scenario: 请求体携带 stream true

- **WHEN** 用户点击发送且满足可发门锁
- **THEN** 发往反代的 JSON body 含 `"stream": true`，且 `model` 与 `messages` 语义保持不变；系统不构造非流式请求

#### Scenario: 首个增量到达即开始渐进渲染

- **WHEN** 推理请求已发出且上游 SSE 流的首节 content 增量到达
- **THEN** 输出区立即显示该增量文本，不等后续事件或流结束

#### Scenario: 后续增量逐节追加

- **WHEN** SSE 流持续返回多节 `choices[0].delta.content`
- **THEN** 输出区按到达顺序把各节文本增量追加到已渲染内容之后

#### Scenario: 收到 DONE 标记完整完成

- **WHEN** SSE 流返回 `data: [DONE]` 事件
- **THEN** 系统停止追加并把当次响应标记为完整完成；发送控件回到可再次发送状态

#### Scenario: 无内容事件不产生空渲染

- **WHEN** SSE 事件不含 `delta.content`（如首节仅含 role、终止节仅含 finish_reason）
- **THEN** 该事件被跳过，不向输出区追加空文本或占位内容

#### Scenario: 断流保留部分文本并标注不完整

- **WHEN** SSE 流在 `[DONE]` 前连接断开或提前 EOF
- **THEN** 已到达的增量文本保持显示，界面标注当次响应不完整并给出失败摘要；已渲染文本不被清空或改写

#### Scenario: 模型发现返回空列表

- **WHEN** `/v1/models` 成功返回空模型清单
- **THEN** 模型下拉菜单不可交互并显示文本 `未检测到密态模型`；发送测试请求按钮不可交互；系统不以空模型发送请求

#### Scenario: 单模型自动选中

- **WHEN** `/v1/models` 成功返回一个模型 ID
- **THEN** 模型下拉菜单显示并选中该模型 ID；用户无需先手动选择即满足模型侧发送条件

#### Scenario: 多模型默认选中且可切换

- **WHEN** `/v1/models` 成功返回多个模型 ID
- **THEN** 模型下拉菜单默认选中返回清单中的第一个 ID，用户可切换为清单内其他 ID；下拉菜单不提供空选项，也不允许清除选择

#### Scenario: 模型清单刷新保留或回落选择

- **WHEN** `/v1/models` 成功返回新模型清单
- **THEN** 若当前选中 ID 仍在新清单中则保持选中；若当前选中 ID 不在新清单中则选中新清单第一个 ID；若新清单为空则清空选中并按空列表规则禁用

#### Scenario: 模型发现失败区别于空列表

- **WHEN** `/v1/models` 请求失败或返回不能解析的响应
- **THEN** 请求面板显示明确的模型发现失败状态；发送测试请求按钮不可交互，且界面不得把失败状态显示为 `未检测到密态模型`

#### Scenario: 模型选项不允许自由输入

- **WHEN** 用户查看或操作模型下拉控件
- **THEN** 界面只允许选择 `/v1/models` 返回的模型 ID；搜索或输入行为只能用于过滤既有选项，不能创建、提交或把文本当作模型 ID

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应，首个新增量到达前不残留上一次的文本

#### Scenario: 失败响应框展示脱敏请求与响应调试内容

- **WHEN** 密态推理发送失败（连接失败、非 2xx、2xx 但响应不满足 SSE data 事件语义，或流中断）
- **THEN** 响应框显示失败摘要、脱敏请求与响应原文；请求中的 `Authorization` 值必须脱敏；流中断场景已到达的部分文本保留显示

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据

### Requirement: 密态推理发送阶段垂直转场

系统须（SHALL）在密态推理请求发送期间、首个响应增量文本到达前，把响应卡中的五步安全流程呈现为单张当前阶段卡：显示当前阶段的图标、阶段标题和阶段说明；上方只提供进度点/序号等小型阶段指示，不得把五个阶段节点横向一字铺开。发送阶段推进时，前一阶段卡须（SHALL）向上淡出，新到达阶段卡须（SHALL）从下方淡入；切换区域须（SHALL）使用固定占位高度，不得因阶段切换引发响应卡高度跳变。阶段内容与现有五步安全语义一致，继续保留现有线性进度条。

首个响应增量文本到达后，阶段推进须（SHALL）停止并保持当前阶段卡，响应区切换为渐进文本渲染（见“密态推理模型清单驱动测试请求”）；此后阶段卡不再随时间推进，直至本次发送结束或失败。

当用户声明偏好减少动态效果时，系统须（SHALL）禁用垂直位移动画；阶段内容可直接切换，但不得再横向展开。

#### Scenario: 发送中只显示当前阶段卡

- **WHEN** 用户发送推理请求且响应卡处于发送中（首个增量到达前）
- **THEN** 卡片以小型阶段指示加一个当前阶段卡展示，不出现五个阶段节点横向排布

#### Scenario: 阶段推进向上淡出并向下滑入

- **WHEN** 发送阶段从任一阶段推进到下一阶段（首个增量到达前）
- **THEN** 前一阶段卡向上淡出，当前阶段卡从下方淡入，形成垂直幻灯片式转场

#### Scenario: 首个增量到达后阶段卡停止推进

- **WHEN** 首个响应增量文本到达
- **THEN** 阶段卡保持当前阶段不再推进，响应区切换为渐进文本渲染

#### Scenario: 阶段切换不抖动布局

- **WHEN** 阶段卡内容切换
- **THEN** 转场区域高度保持稳定，响应卡不发生发出去阶段的上下抖动

#### Scenario: 阶段文案保持安全语义

- **WHEN** 发送阶段进入“建立加密通道”
- **THEN** 阶段说明表述为 OHTTP 加密并绑定网关证明后再发送，不出现“RATS-TLS 会话绑定”等错误表述

#### Scenario: 减少动态效果回退

- **WHEN** 用户系统偏好为减少动态效果
- **THEN** 阶段切换不随动垂直位移或淡入淡出，内容直接切换，并不横向展开五节点

### Requirement: 结构化配置控件

系统须（SHALL）在"设置"视图提供结构化控件，仅承载客户端 ingress（一条或多条 `add_ingress`），不承载 `add_egress`。每条 ingress 锁定为客户端 OHTTP 形态：
- 远端类型二选一：`地址端口`（`mapping`，`out = {host:<IP>, port:<port>}`，`host` 须为 IP）或 `域名`（`http_proxy`，`dst_filters = [{domain:<主机名>, port:<端口号>}]`，主机名与端口分两个控件、主机名仅含主机名不含端口、端口走独立 `port` 字段；域名框接受可选 `http://` / `https://` 前缀，前缀触发 `ohttp.tls` 派生并剥离进 `domain`——`https://` 派生 `tls: true`，`http://` 或无前缀不派生）；`socks5`/`netfilter`/`hook`/`mapping_udp` 不作为 ingress 模式提供。
- tng 本地监听 `host`/`port` 由 tngui 自动注入并对用户隐藏；ingress 编辑器行 1 改为呈现 tngui 反代对外绑定——`host` 在 `127.0.0.1`（仅本机）/`0.0.0.0`（对外网卡）间 toggle、`port` 可配（默认 `127.0.0.1`），作为 tngui 侧设置不进 tng 配置（见"tngui 反向代理作为 pre-TNG path 注入代理"）。
- `ohttp` 永远开，且每条 ingress 的 `ohttp.path_rewrites` 与 `ohttp.header_passthrough.request_headers` 写死为 capi path 模型鉴权契约（见"客户端 ingress 锁定 OHTTP 协议"），用户不可关闭、不可编辑。
- 保留 `no_ra` 开关；其与 `verify` 的序列化语义见"ingress 的 no_ra 与 verify 互斥序列化"。

系统绝不（MUST NOT）提供 `control_interface.restful`（host 或 port）、`path_rewrites`、`header_passthrough.request_headers` 的任何结构化控件。系统绝不（MUST NOT）提供 `add_egress` 的任何结构化控件——客户端侧不承载 egress。系统绝不（MUST NOT）提供 tng ingress 本地监听 `host`/`port` 的任何结构化控件或可编辑字段（由 tngui 启动时注入）。

#### Scenario: 新增条目并选模式
- **WHEN** 用户在"设置"视图新增一条 ingress 并选择远端类型
- **THEN** 系统仅提供"地址端口(mapping) / 域名(http_proxy)"两种远端类型，并在选定类型后展示该形态对应字段集，不出现 `socks5`/`netfilter`/`hook` 选择

#### Scenario: 切换模式重置字段
- **WHEN** 用户切换某条 ingress 的远端类型
- **THEN** 系统以新形态的字段集替换该条原有字段，`ohttp`（常开且写死 path rewrite 与 credential passthrough）与 `no_ra` 保持不变

#### Scenario: 本地监听 host 锁死回环
- **WHEN** 用户编辑 ingress 的本机端口
- **THEN** 行 1 以 tngui 反代对外绑定呈现：`host` 在 `127.0.0.1`/`0.0.0.0` 间 toggle、`port` 可配；tng ingress 本地监听 `host`/`port` 不出现、不可编辑

#### Scenario: 密态推理连接信息单一来源
- **WHEN** 渲染"设置"视图的密态推理卡片
- **THEN** 卡片只承载 API Key；本机端口与远端一律取自结构化 ingress，不出现与结构化 ingress 断开的 `localPort`/`outboundAddress` 输入

#### Scenario: 启动时序列化为 TNG JSON
- **WHEN** 用户触发启动/重启
- **THEN** 系统将结构化控件状态序列化为 TNG JSON，不含 `control_interface.restful`、不含 `add_egress`、不含反代对外绑定字段，且每条 ingress 必含锁定 `ohttp.path_rewrites` 和请求头透传白名单；tng ingress 本地监听 `host`/`port` 不出现在用户序列化的 ingress 里

#### Scenario: http_proxy dst_filters 序列化为带端口的数组
- **WHEN** 用户以 `域名`（`http_proxy`）形态配置远端并触发序列化为 TNG JSON
- **THEN** 该 ingress 的 `dst_filters` 序列化为数组 `[{ "domain": <主机名>, "port": <端口号> }]`，主机名不含端口，端口写入独立字段

#### Scenario: http_proxy 域名前缀决定 ohttp.tls
- **WHEN** 用户在 `域名`（`http_proxy`）的域名框输入 `https://host` 或 `http://host` 或无前缀的 `host`
- **THEN** `https://` 派生 `ohttp.tls: true`；`http://` 或无前缀不派生 `tls`；三种输入下 `dst_filters[0].domain` 均不含 scheme 前缀；锁定的 `path_rewrites` 与 credential passthrough 语义不变

#### Scenario: 导入含 ohttp.tls 的配置回填 tls
- **WHEN** 用户导入的 JSON 中某 `http_proxy` ingress 的 `ohttp` 含 `tls: true`
- **THEN** 系统回填前端内部 `tls=true` 并在域名框以 `https://` 前缀回显；`ohttp.tls` 在下次序列化时按前缀派生语义回写

#### Scenario: 反代转发 Host 含 dst 端口
- **WHEN** tngui 反代把请求转发给 tng 内部 `http_proxy` ingress
- **THEN** 请求 `Host` 头使用 tngui 远端目标；`dst_filters` 配了有效端口时为 `<domain>:<port>`，未配有效端口时为 `<domain>`

#### Scenario: 推理响应按 Content-Length 或 chunked 成帧均可解析
- **WHEN** tng/上游以 `Transfer-Encoding: chunked` 成帧返回 OpenAI 兼容 SSE 流（`Content-Type: text/event-stream`），或以 `Content-Length` 成帧 / EOF 结尾返回非 SSE body（如网关错误 JSON、WAF HTML 拦截页）
- **THEN** SSE 流路径逐块剥除 chunk 帧并逐事件解析 `data:` 行，每节 `choices[0].delta.content` 即时送达输出区、不等待整个响应体收齐；非 SSE body 按缓冲解析并进入失败诊断路径展示原文摘要，不尝试按 SSE 渐进渲染

#### Scenario: 累积响应体上限保持防护
- **WHEN** 响应体（含 SSE 流）累计达到 10 MiB
- **THEN** 密态推理发送逻辑停止接收并以失败处理，不无限累积

#### Scenario: 非 JSON/非 2xx 响应报可读调试详情
- **WHEN** 密态推理发送链路收到 2xx 但响应不满足 SSE data 事件语义、非 2xx，或 SSE 流中断
- **THEN** 输出区显示失败摘要、脱敏请求与响应原文；绝不（MUST NOT）只报"JSON 解析失败"而不带任何上下文

#### Scenario: https 上游经反代加密可达
- **WHEN** 用户以 `域名` 框输入 `https://<域名>` + 端口配置远端并启动 tng
- **THEN** tng 以 TLS 连接该上游，反代转发的 `Host` 为 `<域名>:<端口>`，密态推理页面发起的流式推理请求可经 SSE 获得真实增量回复
