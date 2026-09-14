## ADDED Requirements

### Requirement: tngui 反向代理对外暴露推理入口并注入 x-model 头

系统须（SHALL）在 tng 运行期间由 tngui 自身运行一个常驻 HTTP 反向代理作为推理对外入口：反代随 tng 启动而启动、随 tng 停止而停止。反代的对外绑定地址由用户配置——`host` 可在 `127.0.0.1`（仅本机）与 `0.0.0.0`（对外网卡）之间切换（默认 `127.0.0.1`），`port` 为用户可配的"本机端口"。反代为完整反代：把收到的请求 `method`/`path`/`header`/`body` 转发到 tng 的内部 ingress 本地监听（仅 `127.0.0.1:<tngui 注入的空闲端口>`，见"ingress 本地监听强制走回环"），并原样回传响应（先支持非流式，OpenAI 兼容默认）。反代须（SHALL）对收到的请求：读取并解析 JSON `body` 取 `model` 字段；当 `body` 为含 `model` 字段的 JSON 时，在转发前设置 `x-model: <body.model>` 头——以 `body.model` 为准，若请求已携带 `x-model` 则随之覆盖、不沿用客户端发来的值（与客户端 ingress 锁定 OHTTP `header_passthrough` 中已含的 `x-model` 对齐，经 OHTTP 隧道透传给网关），且不改写 `body`；不含 `model` 字段或 `body` 非 JSON 时不设置/覆盖 `x-model`、原样转发请求与响应。系统绝不（MUST NOT）把 tng 的 ingress 本地监听端口直接暴露给外部客户端——对外只经反代。系统绝不（MUST NOT）链接任何 tng crate——反代是 tngui 自有进程内的 HTTP 服务，与 tng 仅经其 ingress 本地监听端口做 HTTP 转发。

#### Scenario: 反代随 tng 生命周期启停

- **WHEN** 用户启动 tng（概览启动或设置离开自动重启）或停止 tng
- **THEN** tngui 反向代理随 tng 启动而开始监听对外端点、随 tng 停止而停止监听；未启动 tng 时反代不监听

#### Scenario: 含 model 的推理请求被注入 x-model 后转发

- **WHEN** 客户端以 OpenAI 兼容请求（JSON `body` 含 `model` 与 `messages`、`Authorization` 头）访问反代对外端点
- **THEN** 反代在转发给 tng 内部 ingress 前注入 `x-model: <body.model>` 头（若请求已带 `x-model` 则覆盖）、不改动 `body`，并把响应原样回传给客户端

#### Scenario: 请求自带 x-model 被覆盖为 body.model

- **WHEN** 客户端请求的 JSON `body` 含 `model` 字段，且请求自身已携带 `x-model` 头（与 `body.model` 可能不一致）
- **THEN** 反代以 `body.model` 覆盖该既有 `x-model` 头后转发，不沿用客户端发来的 `x-model`

#### Scenario: 无 model 字段请求不注入原样转发

- **WHEN** 客户端请求 `body` 不含 `model` 字段或非 JSON
- **THEN** 反代不注入 `x-model`、按完整反代原样转发请求与响应

#### Scenario: 对外绑定 host 可切换 127.0.0.1 / 0.0.0.0

- **WHEN** 用户在 ingress 编辑器行 1 以 toggle 在本机 `127.0.0.1` 与对外网卡 `0.0.0.0` 间切换反代对外绑定 host，并启动 tng
- **THEN** 反代绑定在所选 host + 配置的对外 port；默认为 `127.0.0.1`

#### Scenario: 不直连 tng ingress 端口

- **WHEN** 外部客户端请求推理入口
- **THEN** 客户端连接的是 tngui 反代对外端点，而非 tng 的内部 ingress 本地监听端口

### Requirement: 注入端口批探测并避让对外端口

tngui 须（SHALL）以批探测为拉起 tng 注入的全部回环端口——`control_interface.restful` 的管控端口与各 ingress 内部本地监听端口——一次性取齐：在同一回环面上**顺序 `bind` `127.0.0.1:0` 共 n 个 listener 并同时持住**（n = 1(管控) + ingress 条数），收集各自分配的端口后**整批统一释放**。因 n 个 listener 同时持在，系统绝不（MUST NOT）出现两个注入端口取到同一端口号。系统须（SHALL）将每条 ingress 的反代对外端口（用户"本机端口"，见"tngui 反向代理对外暴露推理入口并注入 x-model 头"）列为禁止集合：注入的管控端口与各内部端口绝不（MUST NOT）等于任一对外端口。若某次批探测结果命中禁止集合，系统须（SHALL）整批丢弃并重试批探测（有界重试，避免死循环），直到全部不命中为止；重试耗尽则启动失败并明示。

#### Scenario: 批取端口互不相同

- **WHEN** 一次启动取齐 1 个管控端口 + 多条 ingress 的内部端口
- **THEN** 这些注入端口两两互不相同（取号时 n 个 listener 同时持住，无可重复）

#### Scenario: 注入端口避让对外端口

- **WHEN** 批探测取到的某端口等于某条 ingress 的反代对外端口（如默认 `18443`）
- **THEN** 系统整批丢弃并重试批探测，最终注入的管控/内部端口无一等于任一对外端口

#### Scenario: 占住再放避免取号重复

- **WHEN** 批探测执行时
- **THEN** n 个 listener 先全部 `bind` 并同时持住、收齐端口后再统一释放，而非"取号即放、逐个单点探测"

## MODIFIED Requirements

### Requirement: ingress 本地监听强制走回环

系统须（SHALL）将每条 ingress 的本地监听 `host` 强制为 `127.0.0.1`、`port` 由 tngui 自动选取并注入——处理 `mapping` 的 `in`、`http_proxy` 的 `proxy_listen`：tngui 在拉起 tng 前以批探测选取空闲回环端口并先验避让对外端口（见"注入端口批探测并避让对外端口"；与"控制面 host 强制走回环地址""管控端口自动选取"同向）注入为该 ingress 本地监听 `port`、host 强制 `127.0.0.1`，覆盖用户任何 host/port 输入。ingress 本地监听 `host`/`port` 不出现在用户配置、结构化控件与原始 JSON 视图（与 `control_interface.restful` 同向向用户隐藏）；外部客户端不直连该 ingress 本地监听端口，而经 tngui 反向代理对外入口（见"tngui 反向代理对外暴露推理入口并注入 x-model 头"）。用户在 ingress 编辑器行 1 所配的"本机端口 + 对外绑定 host"是 tngui 反代对外绑定，非 tng ingress 本地监听。

#### Scenario: 用户缺省或写非回环 listen host

- **WHEN** 用户编写的 ingress 本地监听 `host` 缺省或被设为 `127.0.0.1` 以外的值
- **THEN** 传给 tng 的配置将 ingress 本地监听绑定到 `127.0.0.1`

#### Scenario: 结构化控件中 host 只读

- **WHEN** 渲染 ingress 的结构化控件
- **THEN** tng ingress 本地监听 `host`/`port` 不在结构化控件出现、不可编辑（由 tngui 启动时注入），不再以"host 只读、port 可编辑"形式呈现；行 1 呈现的是 tngui 反代对外绑定（`host` `127.0.0.1`/`0.0.0.0` toggle + 对外 `port`）

#### Scenario: 用户提供的 listen port 被覆盖

- **WHEN** 用户配置中 ingress 本地监听 `port` 存在为某值
- **THEN** 传给 tng 的配置使用 tngui 自动选取的空闲回环端口，而非用户提供的值

#### Scenario: ingress 本地监听对用户不可见

- **WHEN** 渲染"设置"视图的结构化控件或原始 JSON 视图
- **THEN** 界面不展示 tng ingress 本地监听的 `host` 或 `port`（对用户隐藏，由 tngui 启动时注入）；用户可见的"本机端口"是 tngui 反代对外绑定

### Requirement: 结构化配置控件

系统须（SHALL）在"设置"视图提供结构化控件，仅承载客户端 ingress（一条或多条 `add_ingress`），不承载 `add_egress`。每条 ingress 锁定为客户端 OHTTP 形态：
- 远端类型二选一：`地址端口`（`mapping`，`out = {host:<IP>, port:<port>}`，`host` 须为 IP）或 `域名`（`http_proxy`，`dst_filters = {domain:<单文本框原样>}`，单文本框、不结构限定 http/https、不拆分端口）；`socks5`/`netfilter`/`hook`/`mapping_udp` 不作为 ingress 模式提供。
- tng 本地监听 `host`/`port` 由 tngui 自动注入并对用户隐藏（见"ingress 本地监听强制走回环"）；ingress 编辑器行 1 改为呈现 tngui 反代对外绑定——`host` 在 `127.0.0.1`（仅本机）/`0.0.0.0`（对外网卡）间 toggle、`port` 可配（默认 `127.0.0.1`），作为 tngui 侧设置不进 tng 配置（见"tngui 反向代理对外暴露推理入口并注入 x-model 头"）。
- `ohttp` 永远开、且 `ohttp.header_passthrough.request_headers` 写死为 `["x-model","x-api-key","authorization"]`（见"客户端 ingress 锁定 OHTTP 协议"），用户不可关闭、不可编辑。
- 保留 `no_ra` 开关；其与 `verify` 的序列化语义见"ingress 的 no_ra 与 verify 互斥序列化"。

系统绝不（MUST NOT）提供 `control_interface.restful`（host 或 port）的任何结构化控件——管控面由 tngui 在启动时自行注入（承接"控制面 host 强制走回环地址"与"管控端口自动选取"）。系统绝不（MUST NOT）提供 `add_egress` 的任何结构化控件——客户端侧不承载 egress。系统绝不（MUST NOT）提供 tng ingress 本地监听 `host`/`port` 的任何结构化控件或可编辑字段（由 tngui 启动时注入）。

#### Scenario: 新增条目并选模式

- **WHEN** 用户在"设置"视图新增一条 ingress 并选择远端类型
- **THEN** 系统仅提供"地址端口(mapping) / 域名(http_proxy)"两种远端类型，并在选定类型后展示该形态对应字段集（`地址端口` = `out` 的 IP+port；`域名` = 单文本框 `domain`），不出现 `socks5`/`netfilter`/`hook` 选择

#### Scenario: 切换模式重置字段

- **WHEN** 用户切换某条 ingress 的远端类型
- **THEN** 系统以新形态的字段集替换该条原有字段，`ohttp`（常开、写死 header_passthrough）与 `no_ra` 保持不变

#### Scenario: 本地监听 host 锁死回环

- **WHEN** 用户编辑 ingress 的本机端口
- **THEN** 行 1 以 tngui 反代对外绑定呈现：`host` 在 `127.0.0.1`/`0.0.0.0` 间 toggle、`port` 可配（默认 `127.0.0.1`）；tng ingress 本地监听 `host`/`port` 不出现、不可编辑（由 tngui 注入，见"ingress 本地监听强制走回环"）

#### Scenario: 密态推理连接信息单一来源

- **WHEN** 渲染"设置"视图的密态推理卡片
- **THEN** 卡片只承载 API Key 与 Model；本机端口与远端一律取自结构化 ingress，不出现与结构化 ingress 断开的 `localPort`/`outboundAddress` 输入

#### Scenario: 启动时序列化为 TNG JSON

- **WHEN** 用户触发启动/重启
- **THEN** 系统将结构化控件状态序列化为符合 TNG 配置（外挂 tag 形式）的 JSON，其中不含 `control_interface.restful`（由启动流程注入，承接 `auto-manage-control-port`）、不含 `add_egress`、不含反代对外绑定字段（tngui 侧，由 tngui 用于反代绑定、不传给 tng），且每条 ingress 必含锁定 `ohttp`；tng ingress 本地监听 `host`/`port` 不出现在用户序列化的 ingress 里（由 tngui 在拉起 tng 前注入）

### Requirement: ingress 控件按行分组呈现

系统须（SHALL）在 ingress 的结构化编辑器中按以下三行分组呈现一条 ingress 的控件：第一行为本机端口/反代对外绑定（`host` 在 `127.0.0.1`（仅本机）/`0.0.0.0`（对外网卡）间 toggle + 对外 `port`，为 tngui 反代对外绑定、非 tng ingress 本地监听），独占一行；第二行为远端类型选择（`mapping`/`http_proxy`）与其当前远端类型对应的远端字段（`mapping` → 地址端口 IP+port，`http_proxy` → 域名单文本框），二者在同一横排依次出现，且远端类型切换须（SHALL）即时生效——直接切换控件显示状态与对应远端字段、将字段重置为该类型的默认值，绝不（MUST NOT）弹窗要求用户确认；第三行为远程证明开关（表示"ra"——是否启用远程证明，标签为"远程证明"）与其 verify 配置（model / as_provider，仅在开关开启即 `no_ra=false` 时出现），二者在同一横排依次出现；开关关闭即 `no_ra=true` 时该行仅显示开关，不渲染 verify。该分组不得改变锁定的字段集、不改变 ingress 仅为 `mapping`/`http_proxy` 两种形态、不改变 `no_ra`/`verify` 的互斥序列化语义——仅是呈现排布与切换交互的变化。窄屏下允许单一横排内换行，但不得把上述同一横排的两个控件错位到不相关行。

#### Scenario: 远端类型与远端字段同行

- **WHEN** 渲染一条 ingress 的远端配置
- **THEN** 远端类型选择与当前类型对应的远端字段出现在同一横排（`mapping` → 地址端口，`http_proxy` → 域名）

#### Scenario: 远端类型切换即时生效无弹窗

- **WHEN** 用户在远端类型选择中从当前类型切换为另一类型
- **THEN** 控件即时切换为该类型的显示状态、远端字段重置为该类型默认值，且不出现任何确认对话框

#### Scenario: 远程证明开关表示 ra

- **WHEN** 渲染一条 ingress 的远程证明配置
- **THEN** 远程证明开关标签为"远程证明"，表示"是否启用远程证明"（ra）；开关开启（ra=on/`no_ra=false`）时 verify 配置出现在同一横排；开关关闭（ra=off/`no_ra=true`）时该行仅显示开关，不渲染 verify

#### Scenario: 本地监听独立成行

- **WHEN** 渲染一条 ingress 的行 1
- **THEN** 行 1 独占一行，呈现 tngui 反代对外绑定（`host` `127.0.0.1`/`0.0.0.0` toggle + 对外 `port`），不与远端类型/远端字段或远程证明/verify 同行；tng ingress 本地监听不在此行出现

### Requirement: 默认开局模板

系统须（SHALL）在每次启动 GUI 时以内置默认配置模板初始化"设置"视图：一条锁定形态的 OHTTP `mapping` ingress——行 1 为 tngui 反代对外绑定（`host` 默认 `127.0.0.1`、`port` 取内置默认值），远端 `out` 为占位待用户填写、`no_ra=false`（默认 verify on）且 `verify` 取内置默认值（`model=passport`、`as_provider=tpm`）、`ohttp.header_passthrough.request_headers` 写死为 `["x-model","x-api-key","authorization"]`。模板不含 `add_egress`、不含 `control_interface.restful`（承接 `auto-manage-control-port`：管控面由 tngui 在拉起 tng 时注入）、不含 tng ingress 本地监听 `host`/`port`（由 tngui 在拉起 tng 时以空闲端口注入）。系统不在本地持久化用户编辑。

#### Scenario: 全新开局

- **WHEN** GUI 启动
- **THEN** "设置"视图加载内置锁定形态默认模板，而非任何上次编辑；模板不含 `add_egress`、不含 `control_interface.restful`、不含 tng ingress 本地监听端口

#### Scenario: 默认 ingress 为客户端 OHTTP 形态

- **WHEN** GUI 启动并加载默认模板
- **THEN** 默认 ingress 为 `mapping`（地址端口）形态、`no_ra=false`、含锁定 `ohttp`，行 1 默认为反代对外绑定（`127.0.0.1` + 内置默认 port），不出现 `socks5`/`netfilter`/`hook` 形态，不出现 `add_ingress` 之外的 egress

#### Scenario: 不持久化

- **WHEN** 用户编辑配置后关闭并重新打开 GUI
- **THEN** "设置"视图仍为默认模板（用户须显式导入或重新编辑）

### Requirement: 密态推理页面发送并显示推理请求

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板：用户在 prompt textarea 输入（发送后不清空、可改可重发）；发送时按 OpenAI 兼容格式 POST 到 tngui 反向代理对外端点 `http://<反代 bind host>:<对外 port>/v1/chat/completions`（携带 `Authorization: Bearer <apiKey>` 头、`{model, messages}` body）；`x-model` 头由 tngui 反代从 body 解析注入（见"tngui 反向代理对外暴露推理入口并注入 x-model 头"），而非前端或发送逻辑注入。输出区（只读）显示当次响应的 assistant 回复文本；不保留历史请求。RA 验证过程展示为 UI 占位（不接 stdout 数据）。

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND tng 已启动且 TNG 配置至少含一个 ingress
- **THEN** 系统向 tngui 反代对外端点（`http://<反代 bind host>:<对外 port>/v1/chat/completions`）发 POST，不直连 tng 内部 ingress 端口；反代注入 `x-model` 后转发至 tng 透明代理（ingress）；收到响应后输出区显示 `choices[0].message.content`

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应；不显示历史请求列表

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据
