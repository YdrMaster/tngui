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

### Requirement: 密态推理不可用时直接引导到设置

系统须（SHALL）在密态推理视图的可发门锁不满足时，在请求面板的引导区提供“前往设置”动作，并让该动作直接切换到设置视图。该动作绝不（MUST NOT）只显示要求用户自行点击左侧导航的提示弹窗；也不得因跳转动作本身新增确认对话框。

#### Scenario: 前往设置直接切换

- **WHEN** 密态推理请求面板不可发送且用户点击“前往设置”
- **THEN** 右侧视图直接切换为“设置”，不出现“请点击左侧导航「设置」”等提示弹窗

#### Scenario: 不新增跳转确认

- **WHEN** 用户触发“前往设置”
- **THEN** 视图切换前不出现该跳转专属的确认对话框

### Requirement: 桌面默认窗口与紧凑布局

系统须（SHALL）以 1440×960 逻辑像素作为桌面默认初始窗口尺寸，并以 1120×720 逻辑像素作为最小可调整窗口尺寸。全局内容最小逻辑宽度不得超过 1120 像素；界面须（SHALL）在默认初始尺寸下避免横向滚动，概览的四卡与调试面板不因窗口过小而退化为不可读排布。设置页与入口编辑控件须（SHALL）采用紧凑但可用的宽度、高度和间距：在默认初始尺寸下主要输入控件不得横向截断；长内容页可保留纵向滚动。

#### Scenario: 默认窗口够宽够高

- **WHEN** 用户首次启动桌面 GUI
- **THEN** 默认窗口为 1440×960 逻辑像素

#### Scenario: 最小窗口保留可用布局

- **WHEN** 用户将窗口缩到允许的最小尺寸
- **THEN** 窗口不小于 1120×720 逻辑像素，且界面不出现因全局内容最小宽度超出视口而导致的横向滚动

#### Scenario: 表单控件不因默认尺寸截断

- **WHEN** 用户在默认初始窗口中打开设置页
- **THEN** 入口编辑器与 API Key 等主要输入控件完整可见、可交互，不因控件固定宽度过大而被迫横向滚动

### Requirement: 密态推理凭据只在 GUI 会话内

系统须（SHALL）将密态推理的 apiKey 与 model 作为仅 GUI 会话内的内存态（不写本地存储、不持久化、不入 tng 配置）：apiKey 在“设置”视图填写；model 在“密态推理”视图的请求面板内可编辑填写；二者供密态推理视图发送使用；关闭 GUI 后这两个值不保留。设置页“密态推理”卡 SHALL 只保留一个 API Key 输入框；该输入框 SHALL 默认以密码式遮盖渲染，并提供明确的显隐切换按钮。用户未显式切换前绝不（MUST NOT）明文展示；切换后 SHALL 显示真实值。该卡不得提供复制本地 URL、保存并验证、配置导入/导出、清除本机凭据或中心侧管理说明等额外控件与说明。

#### Scenario: 不入 tng-runtime.json

- **WHEN** 保存 TNG 配置时
- **THEN** 写盘的 tng-runtime.json 不含 model 或 apiKey 字段

#### Scenario: 不持久化跨会话

- **WHEN** 用户填写 model/apiKey 并关闭后重新打开 GUI
- **THEN** “设置”视图的 apiKey 与“密态推理”视图的 model 均为空

#### Scenario: 设置页 API Key 为普通文本框

- **WHEN** 渲染设置页“密态推理”卡
- **THEN** 仅出现一个默认遮盖的 API Key 输入框和其显隐切换按钮；未切换时界面不显示 API Key 明文，切换后显示真实值；界面不出现保存并验证、复制本地 URL、配置导入/导出、清除本机凭据或中心侧凭据说明

#### Scenario: 推理页只读 model 且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以可编辑输入呈现于请求面板；apiKey 不在“密态推理”视图 UI 上展示，发送时仅作为 Authorization 头使用

#### Scenario: 推理页 model 输入与 apiKey 不展示

- **WHEN** 渲染密态推理视图
- **THEN** model 以可编辑输入呈现于请求面板（会话内内存、发送时作为 body.model）；apiKey 不在“密态推理”视图 UI 上展示，发送时仅作为 Authorization 头使用

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
