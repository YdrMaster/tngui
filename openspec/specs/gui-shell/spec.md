## Purpose

渲染一个最小化 GUI，依据用户编写的 JSON 配置启动并重启 tng 进程，展示 tng 只读控制面的状态，且不链接任何 tng 代码。

## Requirements

### Requirement: 带配置编辑器与启动控制的 GUI 窗口

系统须（SHALL）渲染带左侧导航栏、含“概览”“密态推理”“设置”三视图的桌面 GUI 窗口；配置编辑控件位于“设置”视图，启动/停止控件位于“概览”视图；“设置”视图不含启动/停止控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在“设置”视图编辑 TNG 配置后，通过“概览”视图点击启动 OR 在“设置”视图离开时触发自动保存并重启
- **THEN** 系统将该配置写入文件并以该配置文件拉起 `tng launch`

#### Scenario: 重启时先终止既有进程

- **WHEN** GUI 启动的 tng 进程已在运行 AND 用户触发新启动/重启（概览启动按钮 或 设置页 dirty 时自动重启）
- **THEN** 系统在以新配置拉起新进程之前先终止既有 tng 子进程

#### Scenario: 三视图导航切换

- **WHEN** 用户点击导航的“概览”/“密态推理”/“设置”
- **THEN** 右侧视图区切换为对应视图

#### Scenario: 启停控件位于概览

- **WHEN** 用户在概览视图操作启动/停止
- **THEN** 点击启动 = 以当前 TNG 配置写盘并拉起 `tng launch`；点击停止 = 终止 GUI 拉起的 tng 子进程

#### Scenario: 设置视图不含启停控件

- **WHEN** 用户处于设置视图
- **THEN** 该视图不显示启动/重启按钮，仅显示配置编辑控件 + 原始 JSON + 导入导出 + 密态推理 API Key 输入框（模型名 `model` 不在“设置”视图配置，已移至“密态推理”视图的请求面板内编辑）

#### Scenario: 离开设置时按需自动重启

- **WHEN** 用户修改 TNG 配置后从设置视图切换到其他视图 AND tng 正在运行
- **THEN** 系统在切走前写盘并自动重启 tng（kill 旧 + spawn 新）

系统须（SHALL）渲染一个带左侧导航栏的桌面 GUI 窗口，提供“首页”与“配置”两个视图；配置编辑控件与启动/重启控件位于“配置”视图，“首页”视图不含配置编辑与启停控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在“配置”视图编辑配置（结构化控件或原始 JSON）并触发启动/重启控件
- **THEN** 系统将该配置写入文件并以该配置文件拉起 `tng launch`

#### Scenario: 重启时先终止既有进程

- **WHEN** GUI 启动的 tng 进程已在运行，且用户触发启动/重启控件
- **THEN** 系统在以当前配置拉起新进程之前先终止既有 tng 子进程


### Requirement: 控制面 host 强制走回环地址

系统须（SHALL）在拉起 tng 时由 tngui 自行注入 `control_interface.restful`：`host` 强制为 `127.0.0.1`、`port` 为 tngui 自动选取的空闲回环端口（见"管控端口自动选取"），无论用户配置中是否提供或写为何值，一律以此注入值覆盖。`control_interface.restful` 不出现在任何用户可见的配置控件或原始 JSON 视图中（tng 控制面无鉴权，须仅回环可达且对用户隐藏）。

#### Scenario: 用户缺省或写非回环 host

- **WHEN** 用户配置中 `control_interface.restful.host` 缺省或被设为 `127.0.0.1` 以外的值
- **THEN** 传给 tng 的配置将控制面绑定到 `127.0.0.1`（tngui 注入覆盖）

#### Scenario: 用户提供的端口被覆盖

- **WHEN** 用户配置中 `control_interface.restful.port` 存在为某值
- **THEN** 传给 tng 的配置使用 tngui 自动选取的空闲回环端口，而非用户提供的值

#### Scenario: 管控面对用户不可见

- **WHEN** 渲染"设置"视图的结构化控件或原始 JSON 视图
- **THEN** 界面不展示 `control_interface.restful`（host 或 port）


### Requirement: 从控制面只读 tng 状态

系统须（SHALL）周期性轮询 `127.0.0.1:<端口>` 上的 `GET /livez`、`GET /readyz`、`GET /status/` 以及 ingress 的 OHTTP keys 只读状态，并把这些结果提供给首页状态卡。运行状态卡依据探针和控制面可达性显示"关停 / 运行 / 错误"；原始状态数据面板渲染状态接口返回的 JSON。远端链路和远端证明不得由就绪探针单独推断。

#### Scenario: tng 不可达

- **WHEN** 对控制端口的轮询连接失败
- **THEN** 首页运行状态卡显示"关停"

#### Scenario: tng 启动中

- **WHEN** `/livez` 返回成功且 `/readyz` 返回 503
- **THEN** 首页运行状态卡显示"运行"以外的非终态，其副标题可说明本地服务正在启动；该状态不得改写远端链路或远端证明

#### Scenario: tng 就绪

- **WHEN** `/readyz` 返回成功
- **THEN** 首页运行状态卡显示"运行"

#### Scenario: 展示状态树

- **WHEN** `/status/` 返回 JSON body
- **THEN** 原始状态数据面板渲染该 JSON body

#### Scenario: 采集 ingress keys

- **WHEN** ingress OHTTP keys 接口返回 JSON body
- **THEN** 系统把该只读观测数据提供给首页远端链路和远端证明判定

#### Scenario: 无状态数据

- **WHEN** `/status/` 或 ingress OHTTP keys 接口没有返回 JSON body
- **THEN** 原始状态数据面板显示明确的空态，状态卡按无数据规则回落显示


### Requirement: 以只读方式呈现 tng 进程输出

系统须（SHALL）捕获所拉起 tng 进程的 stdout 与 stderr 并在只读区展示，使用户能看到配置被拒的错误——这类错误发生在 tng 的配置解析阶段，早于日志文件初始化。

#### Scenario: tng 拒绝严格 JSON

- **WHEN** 用户配置违反 tng 的严格 JSON 解析，tng 非零退出并把错误打到 stderr
- **THEN** 该错误文本出现在只读输出区


### Requirement: 对 tng 的松耦合

系统须（SHALL）仅通过 (A) 拉起 `tng` CLI、(B) 对只读控制面的 HTTP `GET` 请求、(C) 捕获进程 stdout/stderr 与 tng 交互。系统绝不（MUST NOT）链接、import 或编译任何 TNG Rust crate。

#### Scenario: tng 独立升级

- **WHEN** `tng` 二进制被替换为仍遵循启动 CLI 参数与只读 REST 路由的更新构建
- **THEN** GUI 无需重新编译即可继续工作


### Requirement: 结构化配置控件

系统须（SHALL）在"设置"视图提供结构化控件，仅承载客户端 ingress（一条或多条 `add_ingress`），不承载 `add_egress`。每条 ingress 锁定为客户端 OHTTP 形态：
- 远端类型二选一：`地址端口`（`mapping`，`out = {host:<IP>, port:<port>}`，`host` 须为 IP）或 `域名`（`http_proxy`，`dst_filters = [{domain:<主机名>, port:<端口号>}]`，主机名与端口分两个控件、主机名仅含主机名不含端口、端口走独立 `port` 字段；域名框接受可选 `http://` / `https://` 前缀，前缀触发 `ohttp.tls` 派生并剥离进 `domain`——`https://` 派生 `tls: true`，`http://` 或无前缀不派生）；`socks5`/`netfilter`/`hook`/`mapping_udp` 不作为 ingress 模式提供。
- tng 本地监听 `host`/`port` 由 tngui 自动注入并对用户隐藏（见"ingress 本地监听强制走回环"）；ingress 编辑器行 1 改为呈现 tngui 反代对外绑定——`host` 在 `127.0.0.1`（仅本机）/`0.0.0.0`（对外网卡）间 toggle、`port` 可配（默认 `127.0.0.1`），作为 tngui 侧设置不进 tng 配置（见"tngui 反向代理对外暴露推理入口并注入 x-model 头"）。
- `ohttp` 永远开、且 `ohttp.header_passthrough.request_headers` 写死为 `["x-model","x-api-key","authorization"]`（见"客户端 ingress 锁定 OHTTP 协议"），用户不可关闭、不可编辑。
- 保留 `no_ra` 开关；其与 `verify` 的序列化语义见"ingress 的 no_ra 与 verify 互斥序列化"。

系统绝不（MUST NOT）提供 `control_interface.restful`（host 或 port）的任何结构化控件——管控面由 tngui 在启动时自行注入（承接"控制面 host 强制走回环地址"与"管控端口自动选取"）。系统绝不（MUST NOT）提供 `add_egress` 的任何结构化控件——客户端侧不承载 egress。系统绝不（MUST NOT）提供 tng ingress 本地监听 `host`/`port` 的任何结构化控件或可编辑字段（由 tngui 启动时注入）。

#### Scenario: 新增条目并选模式

- **WHEN** 用户在"设置"视图新增一条 ingress 并选择远端类型
- **THEN** 系统仅提供"地址端口(mapping) / 域名(http_proxy)"两种远端类型，并在选定类型后展示该形态对应字段集（`地址端口` = `out` 的 IP+port；`域名` = 主机名 `domain` + 端口 `port` 两个控件），不出现 `socks5`/`netfilter`/`hook` 选择

#### Scenario: 切换模式重置字段

- **WHEN** 用户切换某条 ingress 的远端类型
- **THEN** 系统以新形态的字段集替换该条原有字段，`ohttp`（常开、写死 header_passthrough）与 `no_ra` 保持不变

#### Scenario: 本地监听 host 锁死回环

- **WHEN** 用户编辑 ingress 的本机端口
- **THEN** 行 1 以 tngui 反代对外绑定呈现：`host` 在 `127.0.0.1`/`0.0.0.0` 间 toggle、`port` 可配（默认 `127.0.0.1`）；tng ingress 本地监听 `host`/`port` 不出现、不可编辑（由 tngui 注入，见"ingress 本地监听强制走回环"）

#### Scenario: 密态推理连接信息单一来源

- **WHEN** 渲染"设置"视图的密态推理卡片
- **THEN** 卡片只承载 API Key（Model 已移至“密态推理”视图，见“密态推理页面发送并显示推理请求”）；本机端口与远端一律取自结构化 ingress，不出现与结构化 ingress 断开的 `localPort`/`outboundAddress` 输入

#### Scenario: 启动时序列化为 TNG JSON

- **WHEN** 用户触发启动/重启
- **THEN** 系统将结构化控件状态序列化为符合 TNG 配置（外挂 tag 形式）的 JSON，其中不含 `control_interface.restful`（由启动流程注入，承接 `auto-manage-control-port`）、不含 `add_egress`、不含反代对外绑定字段（tngui 侧，由 tngui 用于反代绑定、不传给 tng），且每条 ingress 必含锁定 `ohttp`；tng ingress 本地监听 `host`/`port` 不出现在用户序列化的 ingress 里（由 tngui 在拉起 tng 前注入）

#### Scenario: http_proxy dst_filters 序列化为带端口的数组

- **WHEN** 用户以 `域名`（`http_proxy`）形态配置远端（主机名 + 端口）并触发序列化为 TNG JSON
- **THEN** 该 ingress 的 `dst_filters` 序列化为数组 `[{ "domain": <主机名>, "port": <端口号> }]`——主机名仅含主机名（不含端口）、端口号走独立 `port` 字段；系统绝不（MUST NOT）把端口拼进 `domain` 字符串、绝不（MUST NOT）以 `{ "domain": "<host>:<port>" }` 单字段对象形式产出

#### Scenario: http_proxy 域名前缀决定 ohttp.tls

- **WHEN** 用户在 `域名`（`http_proxy`）的域名框输入 `https://host` 或 `http://host` 或无前缀的 `host` 并触发序列化为 TNG JSON
- **THEN** 输入为 `https://host` 时该 ingress 的 `ohttp` 带 `tls: true`；输入为 `http://host` 或无前缀时 `ohttp` 不含 `tls` 字段；三种输入下 `dst_filters[0].domain` 均不含 scheme 前缀（前缀被剥离）；`header_passthrough` 三头写死语义不变

#### Scenario: 导入含 ohttp.tls 的配置回填 tls

- **WHEN** 用户导入的 JSON 中某 `http_proxy` ingress 的 `ohttp` 含 `tls: true`
- **THEN** 该 ingress 回填前端内部 `tls=true` 并在域名框以 `https://` 前缀回显；`ohttp.tls` 在下次序列化时按前缀派生语义回写

#### Scenario: 反代转发 Host 含 dst 端口

- **WHEN** tngui 反代把请求转发给 tng 内部 `http_proxy` ingress
- **THEN** 请求 `Host` 头使用 tngui 远端目标——`dst_filters` 配了有效端口时为 `<domain>:<port>`，未配有效端口时为 `<domain>`（tng 据此 `Host` 头的 host 与端口解析其上游目标；`dst_filters.port` 不决定上游端口）

#### Scenario: 推理响应按 Content-Length 或 chunked 成帧均可解析

- **WHEN** tng/上游以 `Transfer-Encoding: chunked` 或 `Content-Length` 成帧返回非流式推理响应（实测 tng 2.9.2 成功响应走 chunked）
- **THEN** 密态推理发送逻辑剥除 chunk 帧（或按长度读取）后解析 `choices[0].message.content`，输出区显示真实回复文本——绝不（MUST NOT）把 chunk 尺寸/帧分隔符混进 JSON 而报"解析失败"

#### Scenario: 非 JSON/非 2xx 响应报可读调试详情

- **WHEN** 密态推理发送链路收到 2xx 但响应体非 JSON（如上游 WAF 拦截页 HTML）或非 2xx（如 tng 网关 `HttpCipherTextBadResponse` 502/403）
- **THEN** 输出区显示失败摘要、脱敏请求与响应原文（正文截断上限 8000 字符）；绝不（MUST NOT）只报"JSON 解析失败"而不带任何上下文

#### Scenario: https 上游经反代加密可达

- **WHEN** 用户以 `域名` 框输入 `https://<域名>` + 端口 `<TLS/HTTPS 端口>` 配置远端并启动 tng（反代 + tng 均就绪）
- **THEN** tng 以 TLS 连接该上游、反代转发的 `Host` 为 `<域名>:<端口>`，密态推理页面发起的推理请求可获真实回复（非占位、非拦截页）


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


### Requirement: tng 二进制随软件分发并从资源目录发现

系统须（SHALL）将 `tng` 二进制作为随包资源与 GUI 一同分发，并在启动/重启 tng 时从打包资源目录（Tauri `resource_dir`）解析对应平台的可执行名（Unix 为 `tng`、Windows 为 `tng.exe`）后拉起；若资源目录中不存在 `tng`，则回退使用 `PATH` 上的 `tng`。

#### Scenario: 随包分发命中

- **WHEN** 已安装的 GUI（随包含 `tng` 资源）触发启动/重启
- **THEN** 系统从 `resource_dir` 解析到 `tng`（或 Windows 的 `tng.exe`）并拉起，无需用户自行放置 `tng`

#### Scenario: 开发态 PATH 兜底

- **WHEN** 开发态（随包资源中无 `tng`，例如 `cargo run`）触发启动/重启
- **THEN** 系统回退使用 `PATH` 上的 `tng` 拉起

#### Scenario: 替换 tng 无需重编 GUI

- **WHEN** 用户替换 `resource_dir` 中的 `tng` 文件后触发启动/重启
- **THEN** GUI 拉起的是被替换后的 `tng`，无需重新编译 GUI


### Requirement: 概览展示进程、连接与 RA 状态并启停 tng

系统须（SHALL）在"概览"视图按"运行状态、入口信息、远端链路、远端证明"四卡呈现入口状态，并保留"原始状态数据"和"进程日志"两个调试面板；提供启动/停止 tng 的操作按钮。概览视图不含 TNG 配置编辑控件、不含密态推理 model/API Key 输入字段，不显示本地访问可达或本地访问错误，不把本地网关状态、XMPP 控制信道或就绪探针表达为远端健康。

#### Scenario: 显示进程状态

- **WHEN** TNG 处于不同运行情况
- **THEN** 运行状态卡显示互斥的"关停 / 运行 / 错误"状态

#### Scenario: 显示配置+连接状态

- **WHEN** 系统渲染远端链路卡
- **THEN** 远端链路卡显示互斥的"未初始化 / 已建联 / 失败"状态，不基于 stdout 中的 `encrypted=true` 单独推导

#### Scenario: RA 验证状态占位

- **WHEN** 系统渲染远端证明卡
- **THEN** 远端证明卡显示互斥的"未获取 / 已验证 / 待刷新 / 失败"状态，不使用静态占位文案

#### Scenario: 启停按钮

- **WHEN** 用户在概览视图点击启动/停止按钮
- **THEN** 执行对应的 tng 拉起/终止操作

#### Scenario: 概览不含配置编辑控件

- **WHEN** 用户处于概览视图
- **THEN** 界面不出现 TNG 配置编辑控件/原始 JSON/导入导出/密态推理 model+API Key 输入字段；仅含启动/停止按钮 + 四状态卡 + 原始状态数据 + 进程日志输出区


### Requirement: 密态推理页面发送并显示推理请求

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板：用户在 prompt textarea 输入（发送后不清空、可改可重发）。prompt textarea 须（SHALL）按其内容自动调整高度，最小 4 行且最高 16 行；达到最大高度后内容在框内滚动；用户无法通过拖拽调整其尺寸。“发送测试请求”按钮内的图标与文字须（SHALL）垂直居中；该按钮下方不得遗留单独的蓝色锁形提示框。面板的“可发”门锁只认两个条件——概览“运行状态”卡显示“运行”（即与概览左上角卡片相同的 `deriveIngressStates().runtime === "running"` 判定：控制面 reachable、`/livez` 与 `/readyz` 均 2xx、无 attestation/hpke 结构性失败日志、无进程错误）AND 本机已配置 api-key；满足即显示请求面板，否则显示“当前无法发送测试请求”占位。发送时按 OpenAI 兼容格式 POST 到 tngui 反向代理对外端点 `http://<反代 bind host>:<对外 port>/v1/chat/completions`（携带 `Authorization: Bearer <apiKey>` 头、`{model, messages}` body）；`x-model` 头由 tngui 反代从 body 解析注入（见“tngui 反向代理对外暴露推理入口并注入 x-model 头”），而非前端或发送逻辑注入。模型名 `model` 由用户在本面板内可编辑输入提供（会话内内存、不持久化、不入 tng 配置、不触发 tng 进程重启），不在“设置”视图配置、亦不作为可发门锁条件。输出区（只读）显示当次响应的 assistant 回复文本；不保留历史请求。RA 验证过程展示为 UI 占位（不接 stdout 数据）。

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: prompt 按内容自动伸缩

- **WHEN** 用户在 prompt textarea 中增删内容
- **THEN** textarea 高度随内容自动增高或收缩，最小 4 行、最大 16 行；达到最大高度后内容滚动，且拖拽角不能改变其高度

#### Scenario: 发送按钮图标垂直居中且无遗留提示框

- **WHEN** 渲染可交互的“发送测试请求”按钮
- **THEN** 按钮内图标与文字垂直居中；按钮下方不出现单独的蓝色锁形提示框

#### Scenario: 可发判定仅认概览运行态与 api-key

- **WHEN** 渲染密态推理视图的请求面板
- **THEN** 面板在且仅在概览“运行状态”卡显示“运行”（`deriveIngressStates().runtime === "running"`，与概览左上角同一判定，复用同一状态推导）AND api-key 已配置时可用；其余一律显示“当前无法发送测试请求”占位；`model` 是否填写、`readyz` 是否单列、反代对外端口是否独立判定，均不再作为可发门锁条件

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND 概览显示“运行” AND api-key 已配置
- **THEN** 系统向 tngui 反代对外端点（`http://<反代 bind host>:<对外 port>/v1/chat/completions`）发 POST，不直连 tng 内部 ingress 端口；反代按 body.model 注入 `x-model` 后转发至 tng 透明代理（ingress）；收到响应后输出区显示 `choices[0].message.content`

#### Scenario: model 在推理页可编辑且不持久化

- **WHEN** 用户在推理请求面板编辑模型名 `model`
- **THEN** 该 `model` 作为 body.model 经反代注入 `x-model`；`model` 为会话内内存，关闭 GUI 不保留、不写入 tng-runtime.json、不触发 TNG 配置 dirty 或 tng 进程重启

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应；不显示历史请求列表

#### Scenario: 失败响应框展示脱敏请求与响应调试内容

- **WHEN** 密态推理发送失败且失败发生在请求已构建之后（连接失败、读响应失败、非 2xx、响应非 JSON 或响应缺少 content）
- **THEN** 响应框显示失败摘要，并显示本次发出的请求文本与收到的响应原文；请求中的 `Authorization` 值必须脱敏，响应正文按 Content-Length/EOF 或解码后的 chunked 内容展示
- **WHEN** 请求在建立连接/读取响应阶段没有收到任何 HTTP 响应
- **THEN** 响应框仍显示失败摘要、脱敏请求，以及明确的“无 HTTP 响应”诊断；失败详情只在本次响应框展示，不保留历史

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据


### Requirement: 设置页离开时自动保存并自动重启 tng

系统须（SHALL）在用户从“设置”视图切换到其他视图时检测 TNG 配置是否变化（与最后一次已保存的序列化对比 dirty）；dirty 则写 tng-runtime.json；若 tng 当前正在运行 THEN 自动终止旧进程并拉起新配置下的 tng；未在运行 THEN 仅写盘不 spawn。设置视图不得（MUST NOT）提供 TNG 配置保存按钮；自动保存成功或配置未变化时绝不（MUST NOT）弹出成功、提示或确认弹窗，保存失败仍必须给出明确错误提示。修改 apiKey 不计入 dirty（模型名 `model` 现于“密态推理”视图编辑，不在“设置”视图，本身不构成设置页 dirty 因素）。

#### Scenario: dirty 且 tng 在跑 → 自动重启

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 正在运行
- **THEN** 系统写盘 + kill 旧进程 + spawn 新，成功后不弹保存成功提示

#### Scenario: dirty 且 tng 未在跑 → 仅写盘

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 未在运行
- **THEN** 系统只写盘 tng-runtime.json 不 spawn，成功后不弹保存成功提示

#### Scenario: 未 dirty → 不动

- **WHEN** 用户切出设置且 TNG 配置未变
- **THEN** 系统不写盘、不重启，也不显示“配置未变”或保存成功提示

#### Scenario: 保存失败仍可见

- **WHEN** 用户改 TNG 配置并切出设置 AND 配置保存或自动重启失败
- **THEN** 系统显示明确错误提示，不声称保存成功

#### Scenario: 不提供保存按钮

- **WHEN** 渲染设置视图的 TNG 配置区域
- **THEN** 界面不存在“保存”“保存并验证”等 TNG 配置保存按钮；该区域标题为“TNG 配置”

#### Scenario: 推理凭据改动不触发 tng 重启

- **WHEN** 用户仅改 apiKey 并切出设置，或仅改“密态推理”视图的 model
- **THEN** 不触发 TNG 配置 dirty / tng 写盘/重启逻辑


### Requirement: 设置页网关状态卡与概览同源

系统须（SHALL）在设置页 TNG Gateway 区域展示与概览视图第 1、3、4 张状态卡相同的“运行状态”“远端链路”“远端证明”三张卡。三张卡的状态判定、状态文本、副标题和颜色语义须（SHALL）与概览对应卡完全同源；设置页绝不（MUST NOT）另行使用独立的就绪判定、展示“控制信道已连接/已断开”摘要，或展示 TNG 版本概要。设置页 Gateway 区域不展示概览第 2 张“入口信息”卡，也不因此新增配置编辑控件。

#### Scenario: 设置页三卡与概览一致

- **WHEN** 概览与设置页在同一个 TNG 状态快照下渲染
- **THEN** 设置页显示“运行状态”“远端链路”“远端证明”三张卡，且每张卡的标题、状态文本、副标题和颜色语义分别与概览第 1、3、4 张卡一致

#### Scenario: 不显示独立连接摘要

- **WHEN** 渲染设置页 TNG Gateway 区域
- **THEN** 界面不出现“已连接/已断开”控制信道摘要、硬编码 TNG 版本摘要或“入口信息”卡

#### Scenario: 状态变化同步呈现

- **WHEN** TNG 的运行、远端链路或远端证明状态变化
- **THEN** 设置页对应状态卡与概览在同一次状态快照轮询后呈现相同结果

### Requirement: 导出 TNG 进程日志

系统须（SHALL）在设置页提供“导出日志”功能：点击后弹出原生“另存为”对话框；用户选择目标路径后，系统把概览“进程日志”所展示的当前 TNG 子进程 stdout/stderr 快照写入该路径。日志内容须（SHALL）与概览“进程日志”同源，按日志原始顺序连接；没有日志时写入空日志内容。用户取消对话框时绝不（MUST NOT）创建或覆盖目标文件。写入失败时须（SHALL）明确提示错误；导出日志不修改 TNG 进程、TNG 配置或调试面板内容。

#### Scenario: 选择路径后保存进程日志

- **WHEN** 用户点击“导出日志”并在原生另存为对话框选择路径
- **THEN** 系统把当前概览“进程日志”的 stdout/stderr 行按原始顺序写入所选路径

#### Scenario: 无日志时导出空文件

- **WHEN** TNG 尚无 stdout/stderr 日志且用户选择导出路径
- **THEN** 目标文件被写入空日志内容，界面不伪造“（暂无输出）”占位文本

#### Scenario: 用户取消导出

- **WHEN** 用户在原生另存为对话框中取消
- **THEN** 系统不创建、不覆盖目标文件，也不提示导出成功

#### Scenario: 保存失败可见

- **WHEN** 目标路径不可写或保存命令失败
- **THEN** 设置页显示导出错误，原始日志内容不变

### Requirement: 密态推理凭据只在 GUI 会话内

系统须（SHALL）将密态推理的 apiKey 与 model 作为仅 GUI 会话内的内存态（不写本地存储、不持久化、不入 tng 配置）：apiKey 在“设置”视图填写；model 在“密态推理”视图的请求面板内可编辑填写（不再于“设置”视图配置、亦非只读）；二者供密态推理视图发送使用；关闭 GUI 后这两个值不保留。设置页“密态推理”卡 SHALL 只保留一个普通文本输入框形式的 API Key 输入，不得（MUST NOT）做密码式遮罩、显隐切换、复制本地 URL、保存并验证，或在该卡内提供配置导入/导出、清除本机凭据、中心侧管理说明等额外控件与说明。

#### Scenario: 不入 tng-runtime.json

- **WHEN** 保存 TNG 配置时
- **THEN** 写盘的 tng-runtime.json 不含 model 或 apiKey 字段

#### Scenario: 不持久化跨会话

- **WHEN** 用户填写 model/apiKey 并关闭后重新打开 GUI
- **THEN** “设置”视图的 apiKey 与“密态推理”视图的 model 均为空

#### Scenario: 设置页 API Key 为普通文本框

- **WHEN** 渲染设置页“密态推理”卡
- **THEN** 仅出现一个 API Key 输入框，其文本可见、不使用密码遮罩且无显隐切换；界面不出现保存并验证、复制本地 URL、配置导入/导出、清除本机凭据或中心侧凭据说明

#### Scenario: 推理页只读 model 且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以可编辑输入呈现于请求面板（会话内内存、发送时作为 body.model）；apiKey 不在“密态推理”视图 UI 上明文展示（明文输入只出现在“设置”视图），发送时仅作为 Authorization 头使用

#### Scenario: model+apiKey 变动不影响 tng 进程

- **WHEN** 用户修改 model（在“密态推理”视图）或 apiKey（在“设置”视图）
- **THEN** 不触发 TNG 配置 dirty / tng 进程重启


### Requirement: 管控端口自动选取

系统须（SHALL）在拉起 tng 前由 tngui 自行选取一个空闲的回环端口（绑定 `127.0.0.1` 探测得到），将其作为 `control_interface.restful.port` 注入传给 tng 的配置；`control_interface` 的其余同级字段（如 `ttrpc` 等）保留不变。若 tngui 无法分配空闲回环端口，系统须（SHALL）拒绝启动 tng 并在界面展示说明性错误。

#### Scenario: 选取空闲端口并注入

- **WHEN** 用户触发启动/重启
- **THEN** 系统在拉起 tng 前选取一个空闲回环端口，传给 tng 的配置中 `control_interface.restful` 为 `{ "host": "127.0.0.1", "port": <空闲端口> }`，且该端口用于后续控制面轮询

#### Scenario: 无法分配端口则拒绝启动

- **WHEN** tngui 未能分配到空闲回环端口（绑定探测失败）
- **THEN** 系统不拉起 tng，并在界面中展示说明性错误


### Requirement: 客户端 ingress 锁定 OHTTP 协议

系统须（SHALL）对每条 ingress 强制启用 seg1 的 OHTTP（RFC 9458 / HPKE 消息级）加密：传给 tng 的 JSON 中，每条 ingress 必含 `ohttp`，且 `ohttp.header_passthrough.request_headers` 固定为 `["x-model","x-api-key","authorization"]`。系统绝不（MUST NOT）向用户提供关闭 `ohttp` 或编辑这组 `request_headers` 的控件。导入/回填中出现的 ingress `ohttp` 字段一律被丢弃，并由锁定值取代。

#### Scenario: ohttp 常开且 header_passthrough 写死
- **WHEN** 用户编辑或默认加载任意 ingress 并触发序列化
- **THEN** 序列化结果中该 ingress 含 `ohttp`，且 `ohttp.header_passthrough.request_headers` 恰为 `["x-model","x-api-key","authorization"]`

#### Scenario: 用户无法关闭或改写 ohttp
- **WHEN** 渲染 ingress 的结构化控件
- **THEN** 不出现关闭 `ohttp` 或编辑 `header_passthrough.request_headers` 的控件；导入/回填中自定义的 ingress `ohttp` 被丢弃并替换为锁定值


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


### Requirement: 密态推理视图准确描述加密链路

密态推理视图对加密链路与"建立加密通道"步骤的描述 SHALL 与真实链路一致：Seg1（客户端→网关）为 OHTTP（RFC 9458）/ HPKE 消息级加密、单向远程证明（客户端验证网关）；Seg2（网关→引擎）为 RA-TLS（TLS 1.3 + 远程证明）、双向互证。系统 MUST NOT 把 Seg1 标为 RATS-TLS 或 RA-TLS，也不得在"建立加密通道"步骤说明中称"RATS-TLS 会话绑定"。可信环境与 CPU-GPU 链路保护 SHALL 以原理表述、不绑定具体技术名：可信环境以"可信执行环境 + 远程证明"表述，不写具体 TEE/硬件/证明后端技术名、不以"硬件可信环境"作为字段名；CPU-GPU 链路以"PCIe 链路加密"原理表述，不写具体协议名（不写 TDX-IO、PCIe IDE）。

#### Scenario: Seg1 标为 OHTTP/HPKE 消息级加密

- **WHEN** 渲染安全说明页的两段加密链路描述（架构流图、加密边界、链路总览与可信证据的加密协议字段）
- **THEN** Seg1 标为 OHTTP/HPKE 消息级加密、单向远程证明（客户端验证网关），不出现"RATS-TLS 段 1"或把 Seg1 称为 RATS-TLS/RA-TLS

#### Scenario: Seg2 保持 RA-TLS 双向互证

- **WHEN** 渲染 Seg2（网关→引擎）的链路描述
- **THEN** 标为 RA-TLS（TLS 1.3 + 远程证明）、双向互证

#### Scenario: 可信环境以原理表述且不绑定具体技术

- **WHEN** 渲染安全说明页的可信环境/信任根描述
- **THEN** 以"可信执行环境 + 远程证明"原理表述，不出现具体 TEE/硬件/证明后端技术名（不写 Intel TDX 等），且不以"硬件可信环境"作为字段名

#### Scenario: CPU-GPU 链路以原理表述去品牌名

- **WHEN** 渲染 CPU-GPU 链路保护描述
- **THEN** 以"PCIe 链路加密"原理表述并保留"链路上加密"语义，不出现具体协议/技术名（不写 TDX-IO、PCIe IDE）

#### Scenario: 建立加密通道步骤不误称 RATS-TLS

- **WHEN** 渲染密态推理发送流程"建立加密通道"步骤的说明文案（步骤数据与发送进度动画）
- **THEN** 文案表述为以 OHTTP 加密并绑定网关证明后再发送，不出现"RATS-TLS 会话绑定"


### Requirement: 映射远端出口须合法 IPv4 否则拒绝启动

系统须（SHALL）在拉起 tng 前校验每条 `mapping` ingress 的远端 `out.host`：经首尾空格 trim 后须为合法 IPv4 地址（恰好 4 段、每段 0-255、拒绝前导零——与该字段在 tng 侧 `Option<Ipv4Addr>` 的解析一致）。任一 `mapping` 规则的 `out.host` 缺失、为空串/全空白、或非合法 IPv4 时，系统绝不（MUST NOT）写盘 `tng-runtime.json`、绝不（MUST NOT）拉起 tng，并须（SHALL）以明确错误拒绝该次启动。`http_proxy` 形态不因 `dst_filters.domain` 为空被拒（tng 仍加载该形态，空 domain 仅匹配不到远端）；`mapping` 的 `rules` 为空数组时不被拒（不携带生效规则不构成远端缺失）。

#### Scenario: 默认占位与空串/空白被拒

- **WHEN** 用户以默认模板、或以 `out.host` 为空/全空白的 `mapping` ingress 触发启动
- **THEN** 系统不写盘、不拉起 tng，并以明确错误拒绝（提示须填写远端网关 IPv4 地址）

#### Scenario: 非合法 IPv4 被拒

- **WHEN** 某条 `mapping` 规则的 `out.host` 为域名、非 4 段、含超界段、或含前导零（如 `010.0.0.1`）
- **THEN** 系统不写盘、不拉起 tng，并以明确错误拒绝

#### Scenario: 合法 IPv4 放行

- **WHEN** 所有 `mapping` 规则的 `out.host` 经 trim 后均为合法 IPv4
- **THEN** 启动流程继续（写盘并拉起 tng）

#### Scenario: 覆盖所有启动入口

- **WHEN** 用户经概览启动、或经设置页保存/重启、或经离开设置时的自动重启触发启动，且存在 `mapping` 的 `out.host` 未配置/非法
- **THEN** 任一入口均不拉起 tng，并给出明确错误

#### Scenario: http_proxy 空 domain 不在门禁范围

- **WHEN** 仅有的 ingress 为 `http_proxy` 且 `dst_filters.domain` 为空
- **THEN** 启动放行（本要求不门禁 `http_proxy` 远端；tng 加载该形态与空 domain 无关）

#### Scenario: 空 rules 不被拒

- **WHEN** 某条 `mapping` 的 `rules` 为空数组
- **THEN** 该条不触发"远端未配置"拒绝


### Requirement: 远端未配置时概览禁用启动并引导设置

系统须（SHALL）在概览视图，于 tng 未运行且远端未配置（按"映射远端出口须合法 IPv4 否则拒绝启动"的同一判定为"远端未配置"）时，禁用启动控件、保持停止控件可用，并通过引导式提示告知用户去设置视图填写远端网关地址；该引导须（SHALL）提供可直接跳转到设置视图的动作。远端已配置或 tng 运行中时不出现该禁用与引导。前端判定远端是否配置须（SHALL）与后端启动拒绝语义一致，使"启动控件可用"当且仅当"后端会接受"以避免按钮可点击却在点击后才报错。系统绝不（MUST NOT）以因远端未配置而弹出的启动失败弹窗作为其主引导方式——引导须在启动控件被禁用前完成。

#### Scenario: 远端未配置且未运行 → 禁用启动并引导

- **WHEN** tng 未运行且任一 `mapping` 的 `out.host` 缺失/为空/非合法 IPv4
- **THEN** 启动控件不可交互并附说明性提示；概览以引导式提示指引用户前往设置填写远端地址端口；该提示含可直接跳转到设置视图的动作

#### Scenario: 停止控件不受影响

- **WHEN** tng 处于运行中且远端未配置（例如运行中清空了远端）
- **THEN** 停止控件保持可用，且不出现远端引导

#### Scenario: 远端已配置 → 可启动且无引导

- **WHEN** 远端已按本判定配置完成，或 tng 正在运行
- **THEN** 启动控件可交互且不出现远端引导

#### Scenario: 前后端判定一致无事后弹窗

- **WHEN** 概览启动控件处于可交互状态且用户触发启动
- **THEN** 对同一配置经任意启动入口触发，后端均接受并启动，不产生因远端未配置的"启动失败"弹窗


### Requirement: ingress 控件按行分组呈现

系统须（SHALL）在 ingress 的结构化编辑器中按以下三行分组呈现一条 ingress 的控件：第一行为本机端口/反代对外绑定（`host` 在 `127.0.0.1`（仅本机）/`0.0.0.0`（对外网卡）间 toggle + 对外 `port`，为 tngui 反代对外绑定、非 tng ingress 本地监听），独占一行；第二行为远端类型选择（`mapping`/`http_proxy`）与其当前远端类型对应的远端字段（`mapping` → 地址端口 IP+port，`http_proxy` → 域名主机名 + 端口，分两控件），二者在同一横排依次出现，且远端类型切换须（SHALL）即时生效——直接切换控件显示状态与对应远端字段、将字段重置为该类型的默认值，绝不（MUST NOT）弹窗要求用户确认；第三行为远程证明开关（表示"ra"——是否启用远程证明，标签为"远程证明"）与其 verify 配置（model / as_provider，仅在开关开启即 `no_ra=false` 时出现），二者在同一横排依次出现；开关关闭即 `no_ra=true` 时该行仅显示开关，不渲染 verify。该分组不得改变锁定的字段集、不改变 ingress 仅为 `mapping`/`http_proxy` 两种形态、不改变 `no_ra`/`verify` 的互斥序列化语义——仅是呈现排布与切换交互的变化。窄屏下允许单一横排内换行，但不得把上述同一横排的两个控件错位到不相关行。

#### Scenario: 远端类型与远端字段同行

- **WHEN** 渲染一条 ingress 的远端配置
- **THEN** 远端类型选择与当前类型对应的远端字段出现在同一横排（`mapping` → 地址端口，`http_proxy` → 域名主机名 + 端口）

#### Scenario: 远端类型切换即时生效无弹窗

- **WHEN** 用户在远端类型选择中从当前类型切换为另一类型
- **THEN** 控件即时切换为该类型的显示状态、远端字段重置为该类型默认值，且不出现任何确认对话框

#### Scenario: 远程证明开关表示 ra

- **WHEN** 渲染一条 ingress 的远程证明配置
- **THEN** 远程证明开关标签为"远程证明"，表示"是否启用远程证明"（ra）；开关开启（ra=on/`no_ra=false`）时 verify 配置出现在同一横排；开关关闭（ra=off/`no_ra=true`）时该行仅显示开关，不渲染 verify

#### Scenario: 本地监听独立成行

- **WHEN** 渲染一条 ingress 的行 1
- **THEN** 行 1 独占一行，呈现 tngui 反代对外绑定（`host` `127.0.0.1`/`0.0.0.0` toggle + 对外 `port`），不与远端类型/远端字段或远程证明/verify 同行；tng ingress 本地监听不在此行出现


### Requirement: 设置页客户端信息展示编译期版本与操作系统

系统须（SHALL）在设置页“客户端信息”中以编译期变量驱动“客户端版本”与“操作系统”两项，不得写硬编码业务字面量：客户端版本取自编译期 `CARGO_PKG_VERSION`（`tngui-app` crate 版本）；操作系统取自编译期平台常量，并以平台友好名展示（windows→Windows、macos→macOS、linux→Linux；可附带架构）。该两项经系统对外命令暴露给前端，前端在渲染“客户端信息”时取自该命令返回值而非硬编码字面量。客户端信息 SHALL 只包含“客户端版本”和“操作系统”两项，绝不（MUST NOT）展示“更新通道”“稳定版(OTA)”或其他渠道字段。

#### Scenario: 客户端版本取自编译期变量

- **WHEN** 渲染“客户端信息”的“客户端版本”
- **THEN** 展示值等于编译期 `CARGO_PKG_VERSION`（当前 `tngui-app` workspace 版本），非任何硬编码字面量

#### Scenario: 操作系统取自编译期平台常量

- **WHEN** 渲染“客户端信息”的“操作系统”
- **THEN** 展示值由编译期平台常量经友好名映射得到（windows→Windows、macos→macOS、linux→Linux），非 `Desktop` 等写死字面量

#### Scenario: 不展示更新通道

- **WHEN** 渲染设置页“客户端信息”
- **THEN** 客户端信息恰好包含“客户端版本”和“操作系统”两项，不出现“更新通道”或“稳定版(OTA)”

#### Scenario: 跨平台构建值正确

- **WHEN** 在 Windows/Linux/macOS 任一平台编译并运行相应构建产物
- **THEN** 该产物“客户端版本”一致（同一 `CARGO_PKG_VERSION`），“操作系统”反映其编译期平台


### Requirement: tngui 反向代理对外暴露推理入口并注入 x-model 头

系统须（SHALL）在 tng 运行期间由 tngui 自身运行一个常驻 HTTP 反向代理作为推理对外入口：反代随 tng 启动而启动、随 tng 停止而停止。反代的对外绑定地址由用户配置——`host` 可在 `127.0.0.1`（仅本机）与 `0.0.0.0`（对外网卡）之间切换（默认 `127.0.0.1`），`port` 为用户可配的"本机端口"。反代为完整反代：把收到的请求 `method`/`path`/`header`/`body` 转发到 tng 的内部 ingress 本地监听（仅 `127.0.0.1:<tngui 注入的空闲端口>`，见"ingress 本地监听强制走回环"），并原样回传响应（先支持非流式，OpenAI 兼容默认）。反代须（SHALL）对收到的请求：读取并解析 JSON `body` 取 `model` 字段；当 `body` 为含 `model` 字段的 JSON 时，在转发前设置 `x-model: <body.model>` 头——以 `body.model` 为准，若请求已携带 `x-model` 则随之覆盖、不沿用客户端发来的值（与客户端 ingress 锁定 OHTTP `header_passthrough` 中已含的 `x-model` 对齐），且只剥离 JSON body 开头的 UTF-8 BOM、其余不改写 `body`；不含 `model` 字段或 `body` 非 JSON 时不设置/覆盖 `x-model`、原样转发请求与响应。系统绝不（MUST NOT）把 tng 的 ingress 本地监听端口直接暴露给外部客户端——对外只经反代。系统绝不（MUST NOT）链接任何 tng crate——反代是 tngui 自有进程内的 HTTP 服务，与 tng 仅经其 ingress 本地监听端口做 HTTP 转发。

#### Scenario: 反代随 tng 生命周期启停

- **WHEN** 用户启动 tng（概览启动或设置离开自动重启）或停止 tng
- **THEN** tngui 反向代理随 tng 启动而开始监听对外端点、随 tng 停止而停止监听；未启动 tng 时反代不监听

#### Scenario: 含 model 的推理请求被注入 x-model 后转发

- **WHEN** 客户端以 OpenAI 兼容请求（JSON `body` 含 `model` 与 `messages`、`Authorization` 头）访问反代对外端点
- **THEN** 反代在转发给 tng 内部 ingress 前剥离 JSON body 开头的 UTF-8 BOM（若有）、注入 `x-model: <body.model>` 头（若请求已带 `x-model` 则覆盖），其余 body 不改动，并把响应原样回传给客户端

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

- **WHEN** 批探测取到的某端口等于某条 ingress 的反代对外端口（如默认 `9443`）
- **THEN** 系统整批丢弃并重试批探测，最终注入的管控/内部端口无一等于任一对外端口

#### Scenario: 占住再放避免取号重复

- **WHEN** 批探测执行时
- **THEN** n 个 listener 先全部 `bind` 并同时持住、收齐端口后再统一释放，而非"取号即放、逐个单点探测"
