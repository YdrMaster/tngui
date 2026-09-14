## MODIFIED Requirements

### Requirement: 结构化配置控件

系统须（SHALL）在"设置"视图提供结构化控件，仅承载客户端 ingress（一条或多条 `add_ingress`），不承载 `add_egress`。每条 ingress 锁定为客户端 OHTTP 形态：
- 远端类型二选一：`地址端口`（`mapping`，`out = {host:<IP>, port:<port>}`，`host` 须为 IP）或 `域名`（`http_proxy`，`dst_filters = {domain:<单文本框原样>}`，单文本框、不结构限定 http/https、不拆分端口）；`socks5`/`netfilter`/`hook`/`mapping_udp` 不作为 ingress 模式提供。
- 本地监听 `host` 强制 `127.0.0.1`（只读、不可改），监听 `port` 可配（见"ingress 本地监听强制走回环"）。
- `ohttp` 永远开、且 `ohttp.header_passthrough.request_headers` 写死为 `["x-model","x-api-key","authorization"]`（见"客户端 ingress 锁定 OHTTP 协议"），用户不可关闭、不可编辑。
- 保留 `no_ra` 开关；其与 `verify` 的序列化语义见"ingress 的 no_ra 与 verify 互斥序列化"。

系统绝不（MUST NOT）提供 `control_interface.restful`（host 或 port）的任何结构化控件——管控面由 tngui 在启动时自行注入（承接"控制面 host 强制走回环地址"与"管控端口自动选取"）。系统绝不（MUST NOT）提供 `add_egress` 的任何结构化控件——客户端侧不承载 egress。

#### Scenario: 新增条目并选模式
- **WHEN** 用户在"设置"视图新增一条 ingress 并选择远端类型
- **THEN** 系统仅提供"地址端口(mapping) / 域名(http_proxy)"两种远端类型，并在选定类型后展示该形态对应字段集（`地址端口` = `out` 的 IP+port；`域名` = 单文本框 `domain`），不出现 `socks5`/`netfilter`/`hook` 选择

#### Scenario: 切换模式重置字段
- **WHEN** 用户切换某条 ingress 的远端类型
- **THEN** 系统以新形态的字段集替换该条原有字段，`ohttp`（常开、写死 header_passthrough）与 `no_ra` 保持不变

#### Scenario: 本地监听 host 锁死回环
- **WHEN** 用户编辑 ingress 的本地监听
- **THEN** 监听 `host` 以 `127.0.0.1` 只读呈现、不可编辑，仅 `port` 可编辑

#### Scenario: 密态推理连接信息单一来源
- **WHEN** 渲染"设置"视图的密态推理卡片
- **THEN** 卡片只承载 API Key 与 Model；本地端口与远端一律取自结构化 ingress，不出现与结构化 ingress 断开的 `localPort`/`outboundAddress` 输入

#### Scenario: 启动时序列化为 TNG JSON
- **WHEN** 用户触发启动/重启
- **THEN** 系统将结构化控件状态序列化为符合 TNG 配置（外挂 tag 形式）的 JSON，其中不含 `control_interface.restful`（由启动流程注入，承接 `auto-manage-control-port`）、不含 `add_egress`，且每条 ingress 必含锁定 `ohttp`

### Requirement: 默认开局模板

系统须（SHALL）在每次启动 GUI 时以内置默认配置模板初始化"设置"视图：一条锁定形态的 OHTTP `mapping` ingress——本地监听 `host=127.0.0.1`（端口取内置默认值）、远端 `out` 为占位待用户填写、`no_ra=false`（默认 verify on）且 `verify` 取内置默认值（`model=passport`、`as_provider=tpm`）、`ohttp.header_passthrough.request_headers` 写死为 `["x-model","x-api-key","authorization"]`。模板不含 `add_egress`、不含 `control_interface.restful`（承接 `auto-manage-control-port`：管控面由 tngui 在拉起 tng 时注入）。系统不在本地持久化用户编辑。

#### Scenario: 全新开局
- **WHEN** GUI 启动
- **THEN** "设置"视图加载内置锁定形态默认模板，而非任何上次编辑；模板不含 `add_egress`、不含 `control_interface.restful`

#### Scenario: 默认 ingress 为客户端 OHTTP 形态
- **WHEN** GUI 启动并加载默认模板
- **THEN** 默认 ingress 为 `mapping`（地址端口）形态、`no_ra=false`、含锁定 `ohttp`，不出现 `socks5`/`netfilter`/`hook` 形态，不出现 `add_ingress` 之外的 egress

#### Scenario: 不持久化
- **WHEN** 用户编辑配置后关闭并重新打开 GUI
- **THEN** "设置"视图仍为默认模板（用户须显式导入或重新编辑）

### Requirement: 原始 JSON 高级视图

系统须（SHALL）在"设置"视图提供与结构化表单双向同步的原始 JSON 视图，供高级编辑与兜底（含 `control_interface` 同级如 `ttrpc`、顶层如 `metric/trace`、以及 ingress 条目内未结构化字段）。该视图的序列化结果不含 `control_interface.restful`（承接 `auto-manage-control-port`）、不含 `add_egress`，且每条 ingress 必含锁定 `ohttp`。

#### Scenario: 表单到 JSON 同步
- **WHEN** 用户在结构化控件中编辑
- **THEN** 原始 JSON 视图反映其序列化结果：结果不含 `control_interface.restful`、不含 `add_egress`，每条 ingress 含锁定 `ohttp`（`header_passthrough` 为写死的 3 个 header）

#### Scenario: JSON 到表单回填
- **WHEN** 用户在原始 JSON 视图编辑为合法 JSON 并确认
- **THEN** 结构化控件按该 JSON 回填：`control_interface.restful` 的 `host`/`port` 被丢弃、`add_egress` 被丢弃、ingress 的 `ohttp` 被丢弃（回填用锁定值）、`verify` 回填到 `no_ra`/verify 控件；仅 `mapping`/`http_proxy` 形态的 ingress 条目被回填，其余形态被丢弃并提示；若 JSON 非法则提示错误且不破坏表单状态

### Requirement: JSON 配置导入导出

系统须（SHALL）通过原生文件对话框支持导入（读取文件填充配置）与导出（把当前配置写入文件）JSON 配置。导入/导出的内容为用户侧配置：不含 `control_interface.restful`（承接 `auto-manage-control-port`，由 tngui 在拉起 tng 时注入）、不含 `add_egress`。导入时丢弃文件中的 `add_egress`，并仅认 `mapping`/`http_proxy` 形态的 ingress（其余形态丢弃并提示）。

#### Scenario: 导入填充
- **WHEN** 用户经原生打开文件对话框选择 JSON 文件并导入
- **THEN** 系统解析该文件并填充结构化控件与原始 JSON 视图：`control_interface.restful` 的 `host`/`port` 被丢弃、`add_egress` 被丢弃、ingress 的 `ohttp` 被丢弃（回填用锁定值）、仅 `mapping`/`http_proxy` 形态 ingress 被回填；解析失败时显示错误且不改变当前配置

#### Scenario: 导出写入
- **WHEN** 用户经原生另存为对话框选择路径并导出
- **THEN** 系统将当前配置的 pretty JSON 写入该路径，其中不含 `control_interface.restful`、不含 `add_egress`、每条 ingress 含锁定 `ohttp`；写入失败时显示错误

## ADDED Requirements

### Requirement: 客户端 ingress 锁定 OHTTP 协议

系统须（SHALL）对每条 ingress 强制启用 seg1 的 OHTTP（RFC 9458 / HPKE 消息级）加密：传给 tng 的 JSON 中，每条 ingress 必含 `ohttp`，且 `ohttp.header_passthrough.request_headers` 固定为 `["x-model","x-api-key","authorization"]`。系统绝不（MUST NOT）向用户提供关闭 `ohttp` 或编辑这组 `request_headers` 的控件。导入/回填中出现的 ingress `ohttp` 字段一律被丢弃，并由锁定值取代。

#### Scenario: ohttp 常开且 header_passthrough 写死
- **WHEN** 用户编辑或默认加载任意 ingress 并触发序列化
- **THEN** 序列化结果中该 ingress 含 `ohttp`，且 `ohttp.header_passthrough.request_headers` 恰为 `["x-model","x-api-key","authorization"]`

#### Scenario: 用户无法关闭或改写 ohttp
- **WHEN** 渲染 ingress 的结构化控件
- **THEN** 不出现关闭 `ohttp` 或编辑 `header_passthrough.request_headers` 的控件；导入/回填中自定义的 ingress `ohttp` 被丢弃并替换为锁定值

### Requirement: ingress 本地监听强制走回环

系统须（SHALL）将每条 ingress 的本地监听 `host` 强制为 `127.0.0.1`——`mapping` 的 `in.host`、`http_proxy` 的 `proxy_listen.host`——无论用户如何编写，前端结构化控件以只读 `127.0.0.1` 呈现且不接受更改，后端 `prepare_config` 在拉起 tng 前将其一律覆盖为 `127.0.0.1`（与 `control_interface.restful` 强制回环同法）。监听 `port` 由用户配置。

#### Scenario: 用户缺省或写非回环 listen host
- **WHEN** 用户编写的 ingress 本地监听 `host` 缺省或被设为 `127.0.0.1` 以外的值
- **THEN** 传给 tng 的配置将 ingress 本地监听绑定到 `127.0.0.1`

#### Scenario: 结构化控件中 host 只读
- **WHEN** 渲染 ingress 的结构化控件
- **THEN** 本地监听 `host` 以 `127.0.0.1` 只读呈现、不可编辑，仅 `port` 可编辑

### Requirement: ingress 的 no_ra 与 verify 互斥序列化

系统须（SHALL）为每条 ingress 提供 `no_ra` 开关，并按以下互斥规则序列化（与 cmaas-deploy 客户端配置一致）：`no_ra=false`（默认）时序列化含 `verify = {model, as_provider}`（默认 `model=passport`、`as_provider=tpm`，二者可由用户配置）且不含 `no_ra` 键；`no_ra=true` 时序列化含 `"no_ra": true` 且不含 `verify`。系统绝不（MUST NOT）同时输出 `no_ra` 与 `verify`，也绝不（MUST NOT）恒定平铺 `no_ra` 布尔。

#### Scenario: verify 开（no_ra=false）
- **WHEN** 一条 ingress 的 `no_ra` 关闭
- **THEN** 序列化该 ingress 含 `verify = {model, as_provider}`，且不含 `no_ra` 键

#### Scenario: verify 关（no_ra=true）
- **WHEN** 一条 ingress 的 `no_ra` 打开
- **THEN** 序列化该 ingress 含 `"no_ra": true`，且不含 `verify`

#### Scenario: verify 可配置两条字段
- **WHEN** 用户在 `no_ra=false` 下编辑 `verify`
- **THEN** 系统提供 `model` 与 `as_provider` 两个可编辑字段，默认 `passport`/`tpm`
