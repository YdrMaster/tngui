## Purpose

渲染一个最小化 GUI，依据用户编写的 JSON 配置启动并重启 tng 进程，展示 tng 只读控制面的状态，且不链接任何 tng 代码。

## Requirements

### Requirement: 带配置编辑器与启动控制的 GUI 窗口

系统须（SHALL）渲染带左侧导航栏、含"概览""密态推理""设置"三视图的桌面 GUI 窗口；配置编辑控件位于"设置"视图，启动/停止控件位于"概览"视图；"设置"视图不含启动/停止控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在"设置"视图编辑 TNG 配置后，通过"概览"视图点击启动 OR 在"设置"视图离开时触发自动保存并重启
- **THEN** 系统将该配置写入文件并以该配置文件拉起 `tng launch`

#### Scenario: 重启时先终止既有进程

- **WHEN** GUI 启动的 tng 进程已在运行 AND 用户触发新启动/重启（概览启动按钮 或 设置页 dirty 时自动重启）
- **THEN** 系统在以新配置拉起新进程之前先终止既有 tng 子进程

#### Scenario: 三视图导航切换

- **WHEN** 用户点击导航的"概览"/"密态推理"/"设置"
- **THEN** 右侧视图区切换为对应视图

#### Scenario: 启停控件位于概览

- **WHEN** 用户在概览视图操作启动/停止
- **THEN** 点击启动 = 以当前 TNG 配置写盘并拉起 `tng launch`；点击停止 = 终止 GUI 拉起的 tng 子进程

#### Scenario: 设置视图不含启停控件

- **WHEN** 用户处于设置视图
- **THEN** 该视图不显示启动/重启按钮，仅显示配置编辑控件 + 原始 JSON + 导入导出 + 密态推理 model/API Key 输入框

#### Scenario: 离开设置时按需自动重启

- **WHEN** 用户修改 TNG 配置后从设置视图切换到其他视图 AND tng 正在运行
- **THEN** 系统在切走前写盘并自动重启 tng（kill 旧 + spawn 新）

系统须（SHALL）渲染一个带左侧导航栏的桌面 GUI 窗口，提供"首页"与"配置"两个视图；配置编辑控件与启动/重启控件位于"配置"视图，"首页"视图不含配置编辑与启停控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在"配置"视图编辑配置（结构化控件或原始 JSON）并触发启动/重启控件
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

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板：用户在 prompt textarea 输入（发送后不清空、可改可重发）；发送时按 OpenAI 兼容格式通过 tng 透明代理 POST 到 `http://127.0.0.1:<tng-ingress-端口>/v1/chat/completions`（携带 `Authorization: Bearer <apiKey>` 头、`{model, messages}` body），输出区（只读）显示当次响应的 assistant 回复文本；不保留历史请求。RA 验证过程展示为 UI 占位（不接 stdout 数据）。

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND tng 已启动且 TNG 配置至少含一个 ingress
- **THEN** 系统向 `http://127.0.0.1:(配置中第一个 ingress 的 listen 端口)/v1/chat/completions` 发 POST；收到响应后输出区显示 `choices[0].message.content`

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应；不显示历史请求列表

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据

### Requirement: 设置页离开时自动保存并自动重启 tng

系统须（SHALL）在用户从"设置"视图切换到其他视图时检测 TNG 配置是否变化（与最后一次已保存的序列化对比 dirty）；dirty 则写 tng-runtime.json；若 tng 当前正在运行 THEN 自动终止旧进程并拉起新配置下的 tng；未在运行 THEN 仅写盘不 spawn。修改 model/apiKey 不计入 dirty。

#### Scenario: dirty 且 tng 在跑 → 自动重启

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 正在运行
- **THEN** 系统写盘 + kill 旧进程 + spawn 新

#### Scenario: dirty 且 tng 未在跑 → 仅写盘

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 未在运行
- **THEN** 系统只写盘 tng-runtime.json 不 spawn

#### Scenario: 未 dirty → 不动

- **WHEN** 用户切出设置且 TNG 配置未变
- **THEN** 系统不写盘、不重启

#### Scenario: 推理凭据改动不触发 tng 重启

- **WHEN** 用户仅改 model/apiKey 并切出设置
- **THEN** 不触发 TNG 配置 dirty / tng 写盘/重启逻辑

### Requirement: 密态推理凭据只在 GUI 会话内

系统须（SHALL）将密态推理的 model 与 apiKey 作为仅 GUI 会话内的内存态（不写本地存储、不持久化、不入 tng 配置），在设置视图填写后供密态推理视图使用；关闭 GUI 后这两个值不保留。

#### Scenario: 不入 tng-runtime.json

- **WHEN** 保存 TNG 配置时
- **THEN** 写盘的 tng-runtime.json 不含 model 或 apiKey 字段

#### Scenario: 不持久化跨会话

- **WHEN** 用户填写 model/apiKey 并关闭后重新打开 GUI
- **THEN** 设置视图的 model/apiKey 为空

#### Scenario: 推理页只读 model 且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以只读形式显示设置页填写的值；apiKey 不在 UI 上明文展示（发送时作为 Authorization 头使用）

#### Scenario: model+apiKey 变动不影响 tng 进程

- **WHEN** 用户修改 model/apiKey
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

系统须（SHALL）在 ingress 的结构化编辑器中按以下三行分组呈现一条 ingress 的控件：第一行为本地监听（host 只读 `127.0.0.1` + port），独占一行；第二行为远端类型选择（`mapping`/`http_proxy`）与其当前远端类型对应的远端字段（`mapping` → 地址端口 IP+port，`http_proxy` → 域名单文本框），二者在同一横排依次出现，且远端类型切换须（SHALL）即时生效——直接切换控件显示状态与对应远端字段、将字段重置为该类型的默认值，绝不（MUST NOT）弹窗要求用户确认；第三行为远程证明开关（表示"ra"——是否启用远程证明，标签为"远程证明"）与其 verify 配置（model / as_provider，仅在开关开启即 `no_ra=false` 时出现），二者在同一横排依次出现；开关关闭即 `no_ra=true` 时该行仅显示开关，不渲染 verify。该分组不得改变锁定的字段集、不改变 ingress 仅为 `mapping`/`http_proxy` 两种形态、不改变 `no_ra`/`verify` 的互斥序列化语义——仅是呈现排布与切换交互的变化。窄屏下允许单一横排内换行，但不得把上述同一横排的两个控件错位到不相关行。

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

- **WHEN** 渲染一条 ingress 的本地监听
- **THEN** 本地监听独占一行，不与远端类型/远端字段或远程证明/verify 同行

### Requirement: 设置页客户端信息展示编译期版本与操作系统

系统须（SHALL）在设置页"客户端信息"中以编译期变量驱动"客户端版本"与"操作系统"两项，不得写死：客户端版本取自编译期 `CARGO_PKG_VERSION`（`tngui-app` crate 版本）；操作系统取自编译期平台常量，并以平台友好名展示（windows→Windows、macos→macOS、linux→Linux；可附带架构）。该两项经系统对外命令暴露给前端，前端在渲染"客户端信息"时取自该命令返回值而非硬编码字面量。系统绝不（MUST NOT）在"客户端信息"中以硬编码字面量作为客户端版本或操作系统的展示值。

#### Scenario: 客户端版本取自编译期变量

- **WHEN** 渲染"客户端信息"的"客户端版本"
- **THEN** 展示值等于编译期 `CARGO_PKG_VERSION`（当前 `tngui-app` workspace 版本），非任何硬编码字面量

#### Scenario: 操作系统取自编译期平台常量

- **WHEN** 渲染"客户端信息"的"操作系统"
- **THEN** 展示值由编译期平台常量经友好名映射得到（windows→Windows、macos→macOS、linux→Linux），非 `Desktop` 等写死字面量

#### Scenario: 跨平台构建值正确

- **WHEN** 在 Windows/Linux/macOS 任一平台编译并运行相应构建产物
- **THEN** 该产物"客户端版本"一致（同一 `CARGO_PKG_VERSION`），"操作系统"反映其编译期平台
