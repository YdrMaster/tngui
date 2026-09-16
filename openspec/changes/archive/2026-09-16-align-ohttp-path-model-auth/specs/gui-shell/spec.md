## MODIFIED Requirements

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
- **THEN** 该 ingress 回填前端内部 `tls=true` 并在域名框以 `https://` 前缀回显；`ohttp.tls` 在下次序列化时按前缀派生语义回写

#### Scenario: 反代转发 Host 含 dst 端口
- **WHEN** tngui 反代把请求转发给 tng 内部 `http_proxy` ingress
- **THEN** 请求 `Host` 头使用 tngui 远端目标；`dst_filters` 配了有效端口时为 `<domain>:<port>`，未配有效端口时为 `<domain>`

#### Scenario: 推理响应按 Content-Length 或 chunked 成帧均可解析
- **WHEN** tng/上游以 `Transfer-Encoding: chunked` 或 `Content-Length` 成帧返回非流式推理响应
- **THEN** 密态推理发送逻辑剥除 chunk 帧（或按长度读取）后解析 `choices[0].message.content`，输出区显示真实回复文本

#### Scenario: 非 JSON/非 2xx 响应报可读调试详情
- **WHEN** 密态推理发送链路收到 2xx 但响应体非 JSON，或非 2xx
- **THEN** 输出区显示失败摘要、脱敏请求与响应原文；绝不（MUST NOT）只报"JSON 解析失败"而不带任何上下文

#### Scenario: https 上游经反代加密可达
- **WHEN** 用户以 `域名` 框输入 `https://<域名>` + 端口配置远端并启动 tng
- **THEN** tng 以 TLS 连接该上游，反代转发的 `Host` 为 `<域名>:<端口>`，密态推理页面发起的推理请求可获真实回复

### Requirement: 原始 JSON 高级视图

系统须（SHALL）在"设置"视图提供与结构化表单双向同步的原始 JSON 视图，供高级编辑与兜底。该视图的序列化结果不含 `control_interface.restful`、不含 `add_egress`，且每条 ingress 必含锁定 OHTTP 配置。

#### Scenario: 表单到 JSON 同步
- **WHEN** 用户在结构化控件中编辑
- **THEN** 原始 JSON 视图反映其序列化结果：结果不含 `control_interface.restful`、不含 `add_egress`，每条 ingress 含锁定的 `ohttp.path_rewrites` 和 credential 请求头白名单

#### Scenario: JSON 到表单回填
- **WHEN** 用户在原始 JSON 视图编辑为合法 JSON 并确认
- **THEN** 结构化控件按该 JSON 回填：`control_interface.restful` 的 `host`/`port` 被丢弃、`add_egress` 被丢弃、ingress 的 `ohttp` 被丢弃（回填用锁定值）、`verify` 回填到 `no_ra`/verify 控件；仅 `mapping`/`http_proxy` 形态 ingress 被回填，其余形态被丢弃并提示

### Requirement: JSON 配置导入导出

系统须（SHALL）通过原生文件对话框支持导入与导出 JSON。导入/导出的内容为用户侧配置：不含 `control_interface.restful`、不含 `add_egress`。导入时丢弃文件中的 `add_egress` 与 ingress 自定义 `ohttp`，并仅认 `mapping`/`http_proxy` 形态的 ingress。

#### Scenario: 导入填充
- **WHEN** 用户经原生打开文件对话框选择 JSON 文件并导入
- **THEN** 系统解析该文件并填充结构化控件与原始 JSON 视图；`control_interface.restful`、`add_egress`、ingress 自定义 `ohttp` 被丢弃或由锁定值回填；解析失败时显示错误且不改变当前配置

#### Scenario: 导出写入
- **WHEN** 用户经原生另存为对话框选择路径并导出
- **THEN** 系统将当前配置的 pretty JSON 写入该路径，其中不含 `control_interface.restful`、不含 `add_egress`，每条 ingress 含锁定 OHTTP 配置

### Requirement: 默认开局模板

系统须（SHALL）在每次启动 GUI 时以内置默认配置模板初始化"设置"视图：一条锁定形态的 OHTTP `mapping` ingress，行 1 为 tngui 反代对外绑定（默认 `127.0.0.1` 和内置默认 port），远端 `out` 为占位；`no_ra=false` 并带默认 `verify`，且含锁定 OHTTP `path_rewrites` 与 credential passthrough。模板不含 `add_egress`、`control_interface.restful`、`x-model` 或 tng ingress 本地监听 `host`/`port`。不在本地持久化用户编辑。

#### Scenario: 全新开局
- **WHEN** GUI 启动
- **THEN** "设置"视图加载内置锁定形态默认模板

#### Scenario: 默认 ingress 为客户端 OHTTP 形态
- **WHEN** GUI 启动并加载默认模板
- **THEN** 默认 ingress 为 `mapping`、`no_ra=false`、含锁定 path-model `ohttp` 配置

#### Scenario: 不持久化
- **WHEN** 用户编辑配置后关闭并重新打开 GUI
- **THEN** "设置"视图仍为默认模板

### Requirement: 密态推理页面发送并显示推理请求

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板。面板的“可发”门锁只认概览“运行状态”为“运行”AND 本机已配置 api-key。发送时按 OpenAI 兼容格式 POST 到 tngui 反代对外端点，携带 `Authorization: Bearer <apiKey>` 和 `{model, messages}` body。系统绝不（MUST NOT）在前端或反代中另发 `x-model` 头；模型身份由反代按 body.model 改写请求 path。model 为会话内内存、不持久化、不入 tng 配置。输出区只显示当次响应；RA 过程保持占位。

#### Scenario: prompt 发送后不清空且可重发
- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: prompt 按内容自动伸缩
- **WHEN** 用户在 prompt textarea 中增删内容
- **THEN** textarea 高度自动增高或收缩，最小 4 行、最大 16 行；达到最大高度后内容滚动，且拖拽角不能改变其高度

#### Scenario: 发送按钮图标垂直居中且无遗留提示框
- **WHEN** 渲染可交互的“发送测试请求”按钮
- **THEN** 按钮内图标与文字垂直居中；按钮下方不出现单独的蓝色锁形提示框

#### Scenario: 可发判定仅认概览运行态与 api-key
- **WHEN** 渲染密态推理视图的请求面板
- **THEN** 面板仅在概览运行态与 api-key 同时满足时可用；model 是否填写不作为可发门锁条件

#### Scenario: 真发送经 tng 透明代理
- **WHEN** 用户点击发送 AND 概览显示“运行” AND api-key 已配置
- **THEN** 系统向 tngui 反代对外端点发 POST，不直连 tng 内部 ingress 端口；请求经 pre-TNG path 注入代理进入 TNG

#### Scenario: model 在推理页可编辑且不持久化
- **WHEN** 用户在推理请求面板编辑模型名 `model`
- **THEN** 该 `model` 仍作为 body.model 供反代解析；关闭 GUI 不保留，也不触发 TNG 配置 dirty 或 tng 进程重启

#### Scenario: 不保留历史请求
- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应

#### Scenario: 失败响应框展示脱敏请求与响应调试内容
- **WHEN** 密态推理发送失败
- **THEN** 响应框显示失败摘要、脱敏请求与响应原文；请求中的 `Authorization` 值必须脱敏

#### Scenario: RA 过程占位
- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据

### Requirement: 客户端 ingress 锁定 OHTTP 协议

系统须（SHALL）对每条 ingress 强制启用 seg1 的 OHTTP 加密与 capi path 模型鉴权契　约：`ohttp.path_rewrites` 固定为
`[{ "match_regex": "^/models/([^/]+)(?:/.*)?$", "substitution": "/models/$1" }]`；`ohttp.header_passthrough.request_headers` 固定为 `["authorization","x-api-key"]`。系统绝不（MUST NOT）将 `x-model` 写入透传白名单，也绝不（MUST NOT）向用户提供关闭 `ohttp`、编辑 `path_rewrites` 或编辑请求头白名单的控件。导入/回填中出现的 ingress `ohttp` 字段一律被丢弃，并由锁定值取代。

#### Scenario: ohttp 常开且 header_passthrough 写死
- **WHEN** 用户编辑或默认加载任意 ingress 并触发序列化
- **THEN** 序列化结果中该 ingress 的 `ohttp.header_passthrough.request_headers` 恰为 `["authorization","x-api-key"]`

#### Scenario: ohttp path_rewrites 写死
- **WHEN** 用户编辑或默认加载任意 ingress 并触发序列化
- **THEN** 序列化结果中该 ingress 的 `ohttp.path_rewrites` 恰为上述一条规则

#### Scenario: 用户无法关闭或改写 ohttp
- **WHEN** 渲染 ingress 的结构化控件
- **THEN** 不出现关闭 `ohttp`、编辑 `path_rewrites` 或编辑 `header_passthrough.request_headers` 的控件；导入/回填中自定义的 ingress `ohttp` 被丢弃并替换为锁定值

#### Scenario: 远端构建的 outer path 具备模型语义
- **WHEN** pre-TNG proxy 已改写内部请求为 `/models/{model-segment}{original-path}`
- **THEN** TNG ingress 生成的 OHTTP outer path 为 `/models/{model-segment}`，credential 请求头进入 outer 请求；未匹配 path rewrite 的请求不得自动获得模型语义

## ADDED Requirements

### Requirement: tngui 反向代理作为 pre-TNG path 注入代理

系统须（SHALL）在 tng 运行期间由 tngui 自身运行常驻 HTTP 反向代理作为推理对外入口。反代随 tng 启动/停止而启/停，反代把请求转发到 tng 内部 ingress 本地监听，并按 TNG OHTTP path 模型契约执行 pre-TNG path 注入；响应原样回传。系统绝不（MUST NOT）把 tng ingress 本地监听端口直接暴露给外部客户端，也绝不（MUST NOT）链接任何 tng crate。

对 `POST /v1/chat/completions` 与 `POST /v1/messages`，反代须（SHALL）将 body 按 UTF-8 JSON object 解析，读取顶层字符串 `model`，trim 后做单一路径 segment percent-encoding，并把 path 改写为 `/models/{encoded-model-segment}{original-path}`。请求 body 字节、query、method 以及 `Authorization`、`x-api-key`、`Content-Type` 须保留。反代须在 model 缺失、不是字符串、trim 后为空、body 不是合法 UTF-8 JSON object 时返回 400；超过 10 MiB 返回 413；以上失败均不得转发 TNG。

反代绝不（MUST NOT）注入、生成或使用 `x-model` 作为模型身份；客户端携带的 `x-model` 不得影响 path 模型或鉴权结果。非上述两个 path 的请求不产生模型语义，可按通用反代规则转发。

#### Scenario: 反代随 tng 生命周期启停
- **WHEN** 用户启动或停止 tng
- **THEN** tngui 反向代理随 tng 生命周期启停；未启动时不监听

#### Scenario: OpenAI 请求注入模型路径
- **WHEN** 客户端 `POST /v1/chat/completions` 携带 JSON body `{"model":"  model-a  "}` 和 `Authorization`
- **THEN** 反代不改写 body，并把内部请求路径改写为 `/models/model-a/v1/chat/completions`

#### Scenario: Anthropic 请求注入模型路径
- **WHEN** 客户端 `POST /v1/messages` 携带 JSON body `{"model":"provider/model"}` 和 `x-api-key`
- **THEN** 反代把内部请求路径改写为 `/models/provider%2Fmodel/v1/messages`，并保留 `x-api-key` 与原始 body 字节

#### Scenario: 请求 path 与 query 保持可恢复
- **WHEN** 客户端请求 `/v1/chat/completions?trace=1` 且 `body.model` 有效
- **THEN** 反代转发 `/models/{encoded-model-segment}/v1/chat/completions?trace=1`

#### Scenario: 客户端伪造 x-model 不影响身份
- **WHEN** 客户端请求 body.model 解析为 `model-a` 且请求头携带 `x-model: model-b`
- **THEN** 反代不使用或覆盖 `x-model`，最终 pre-TNG path 表示 `model-a`

#### Scenario: 非法 model 阻断在 pre-TNG proxy
- **WHEN** 支持端点的 body 缺失 `model`、`model` 不是字符串、为空/纯空白，或不是 JSON object
- **THEN** 反代返回 HTTP 400，不建立 TNG 请求

#### Scenario: 超大请求返回 413
- **WHEN** 支持端点的请求体超过 10 MiB 声明上限
- **THEN** 反代返回 HTTP 413，不建立 TNG 请求

#### Scenario: 非模型 path 不改写
- **WHEN** 客户端请求的 path 不是 `POST /v1/chat/completions` 或 `POST /v1/messages`
- **THEN** pre-TNG path 注入逻辑不产生模型前缀

#### Scenario: 对外绑定 host 可切换
- **WHEN** 用户在 ingress 编辑器行 1 以 toggle 切换反代对外绑定 host 并启动 tng
- **THEN** 反代绑定在所选 host + 配置的对外 port；默认为 `127.0.0.1`

#### Scenario: 不直连 tng ingress 端口
- **WHEN** 外部客户端请求推理入口
- **THEN** 客户端连接的是 tngui 反代对外端点，而非 tng 的内部 ingress 本地监听端口

## REMOVED Requirements

### Requirement: tngui 反向代理对外暴露推理入口并注入 x-model 头

**Reason**: capi path 模型鉴权方案将模型身份移动到 `/models/{model-segment}`，`x-model` 不再是模型身份，也不再进入 OHTTP request passthrough。
**Migration**: 客户端继续提供 `body.model`，由 tngui 反代生成模型 path；TNG ingress 使用锁定的 `path_rewrites` 与 credential passthrough。
