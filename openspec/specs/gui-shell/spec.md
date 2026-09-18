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

系统须（SHALL）在“设置”视图提供与结构化表单双向同步的原始 JSON 视图，供高级编辑与兜底。该视图在进行编辑时须（SHALL）与结构化表单保持同步；当 TNG 配置锁定开启时，原始 JSON 输入区域与“应用回填表单”操作须（SHALL）不可交互。该视图的序列化结果不含 `control_interface.restful`、不含 `add_egress`，且当前唯一 ingress 必含锁定 OHTTP 配置。对 RA 开启的 ingress，原始 JSON 中的自定义 `verify.model` / `verify.as_provider` 须（SHALL）在应用回填时被忽略并统一为默认值。

#### Scenario: 表单到 JSON 同步

- **WHEN** 用户在结构化控件中编辑
- **THEN** 原始 JSON 视图反映其序列化结果：结果不含 `control_interface.restful`、不含 `add_egress`，当前唯一 ingress 含锁定的 `ohttp.path_rewrites` 和 credential 请求头白名单

#### Scenario: JSON 到表单回填

- **WHEN** 用户在原始 JSON 视图编辑为合法 JSON 并确认
- **THEN** 结构化控件按该 JSON 回填：`control_interface.restful` 的 `host`/`port` 被丢弃、`add_egress` 被丢弃、ingress 的 `ohttp` 被丢弃（回填用锁定值）、RA 开启条目的 `verify` 被重置为 `model=passport` 与 `as_provider=tpm`；仅第一条 `mapping`/`http_proxy` 形态 ingress 被保留，其余形态或多余条目被丢弃并提示

#### Scenario: 锁定时原始 JSON 不可编辑

- **WHEN** TNG 配置锁定开启
- **THEN** 原始 JSON 输入区域与“应用回填表单”操作不可交互；关闭锁定后恢复可编辑
### Requirement: JSON 配置导入导出

系统须（SHALL）通过原生文件对话框支持导入与导出 JSON。导入/导出的内容为用户侧配置：不含 `control_interface.restful`、不含 `add_egress`。导入时须（SHALL）丢弃文件中的 `add_egress` 与 ingress 自定义 `ohttp`，仅认 `mapping`/`http_proxy` 形态的 ingress，并将 RA 开启条目的自定义 `verify.model` / `verify.as_provider` 重置为默认值；系统须（SHALL）只保留第一条 ingress，多余条目须（SHALL）被丢弃并提示。导入/导出按钮本身须（SHALL）不受 TNG 配置锁定影响。

#### Scenario: 导入填充

- **WHEN** 用户经原生打开文件对话框选择 JSON 文件并导入
- **THEN** 系统解析该文件并填充结构化控件与原始 JSON 视图；`control_interface.restful`、`add_egress`、ingress 自定义 `ohttp` 被丢弃或由锁定值回填；RA 开启条目的 `verify` 序列化为 `model=passport`、`as_provider=tpm`；仅第一条 `mapping`/`http_proxy` ingress 被保留，多余 ingress 被丢弃并提示；解析失败时显示错误且不改变当前配置

#### Scenario: 导出写入

- **WHEN** 用户经原生另存为对话框选择路径并导出
- **THEN** 系统将当前配置的 pretty JSON 写入该路径，其中不含 `control_interface.restful`、不含 `add_egress`，当前唯一 ingress 含锁定 OHTTP 配置，RA 开启条目含默认 `verify`

#### Scenario: 导入导出不受锁定影响

- **WHEN** TNG 配置锁定开启
- **THEN** “导入配置”与“导出配置”按钮仍可交互
### Requirement: 默认开局模板

系统须（SHALL）以内置默认配置模板初始化"设置"视图的 TNG 配置：一条锁定形态的 OHTTP `mapping` ingress，行 1 为 tngui 反代对外绑定（默认 `127.0.0.1` 和内置默认 port），远端 `out` 为占位；`no_ra=false` 并带默认 `verify`，且含锁定 OHTTP `path_rewrites` 与 credential passthrough。模板不含 `add_egress`、`control_interface.restful`、`x-model` 或 tng ingress 本地监听 `host`/`port`。该模板仅在设置缓存缺失、不支持、损坏或未通过设置缓存校验时使用；存在有效设置缓存时，GUI 须（SHALL）改为恢复缓存中的设置状态。

#### Scenario: 全新开局

- **WHEN** GUI 启动 AND 设置缓存缺失、无法解析、schema 不支持或未通过设置缓存校验
- **THEN** "设置"视图加载内置锁定形态默认模板，API Key 为空

#### Scenario: 默认 ingress 为客户端 OHTTP 形态

- **WHEN** GUI 启动并因无有效缓存而加载默认模板
- **THEN** 默认 ingress 为 `mapping`、`no_ra=false`、含锁定 path-model `ohttp` 配置

#### Scenario: 有效缓存优先于默认模板

- **WHEN** GUI 启动 AND 设置缓存通过校验
- **THEN** "设置"视图加载缓存中的 TNG 配置与 API Key，而不是默认占位模板

#### Scenario: 不持久化

- **WHEN** 用户在原始 JSON 视图编辑但未点击"应用回填表单"即关闭 GUI
- **THEN** 该未应用草稿不在本地持久化；下次启动按缓存校验规则恢复已提交设置或默认模板
### Requirement: tng 二进制随软件分发并从资源目录发现

系统须（SHALL）随 GUI 分发并区分两套 tng 二进制，并在每次启动/重启 tng 时依据远程证明开关选择其一：

- **普通版（远程证明关闭时使用）** 作为随包资源与 GUI 一同分发，资源名为 `tng-nora`（Unix）/ `tng-nora.exe`（Windows）；启动/重启时从打包资源目录（Tauri `resource_dir`）解析后拉起；若资源目录中不存在该文件，则回退使用 `PATH` 上的 `tng`。
- **远程证明版（RA 版，任一条 ingress 开启远程证明时使用）** 直接保存在源仓库 `resources/` 目录内并随包分发，按平台命名：Windows x64 为 `tng.exe`、Linux x86_64 为 `tng-linux-x86_64`、Linux aarch64 为 `tng-linux-aarch64`、macOS aarch64 为 `tng-aarch64-apple-darwin`；启动/重启时从 `resource_dir` 解析对应文件后拉起，绝不（MUST NOT）回退到 `PATH` 或普通版。

**RA 判定**：启动/重启 tng 时，若最后生效配置中任一条 `add_ingress` 开启远程证明（该条 `no_ra` 非 `true`——含序列化为 `verify` 的条目），系统须（SHALL）使用 RA 版二进制；仅当全部 ingress 均 `no_ra=true`（或没有 ingress 条目）时使用普通版。当需要 RA 版而其在 `resource_dir` 中不存在（含无 RA 版产物的平台，如 macOS x86_64——该架构不再受支持）时，系统须（SHALL）拒绝本次启动并返回明确错误，绝不（MUST NOT）静默回退到普通版，且不得终止当前已在运行的原会话。

#### Scenario: 随包分发命中

- **WHEN** 已安装的 GUI（随包含普通版 `tng-nora` 或 Windows 的 `tng-nora.exe` 资源）在全部 ingress 均 `no_ra=true` 时触发启动/重启
- **THEN** 系统从 `resource_dir` 解析到普通版二进制并拉起，无需用户自行放置

#### Scenario: 开发态 PATH 兜底

- **WHEN** 开发态（随包资源中无 `tng-nora`，例如 `cargo run`）且 RA 全关时触发启动/重启
- **THEN** 系统回退使用 `PATH` 上的 `tng` 拉起

#### Scenario: 替换 tng 无需重编 GUI

- **WHEN** 用户替换 `resource_dir` 中的普通版或 RA 版二进制文件后触发启动/重启
- **THEN** GUI 拉起被替换后的对应二进制文件，无需重新编译 GUI

#### Scenario: 任一 ingress 开启 RA 时使用 RA 版

- **WHEN** 最后生效配置中任一条 ingress 开启远程证明（`no_ra` 非 `true`）时触发启动/重启
- **THEN** 系统按当前平台从 `resource_dir` 解析对应 RA 版二进制（`tng.exe` / `tng-linux-x86_64` / `tng-linux-aarch64` / `tng-aarch64-apple-darwin`）并拉起

#### Scenario: RA 版缺失拒绝启动且不回退

- **WHEN** 任一条 ingress 开启远程证明，而当前平台的 RA 版二进制在 `resource_dir` 中不存在（如 macOS x86_64，或文件被移除）
- **THEN** 本次启动被拒绝并返回明确错误，不拉起普通版、不回退 `PATH`，且不终止当前已在运行的原会话

#### Scenario: 切换 RA 开关重启后换用对应二进制

- **WHEN** 全部 ingress 为 `no_ra=true`（普通版运行中）时，用户开启任一条 ingress 的远程证明后保存/重启
- **THEN** 重启完成后的本次会话由 RA 版二进制承载；反向把全部 ingress 关闭远程证明并重启后，会话改由普通版承载
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
### Requirement: 密态推理发送阶段垂直转场

系统须（SHALL）在密态推理请求发送期间，把响应卡中的五步安全流程呈现为单张当前阶段卡：显示当前阶段的图标、阶段标题和阶段说明；上方只提供进度点/序号等小型阶段指示，不得把五个阶段节点横向一字铺开。发送阶段推进时，前一阶段卡须（SHALL）向上淡出，新到达阶段卡须（SHALL）从下方淡入；切换区域须（SHALL）使用固定占位高度，不得因阶段切换引发响应卡高度跳变。阶段内容与现有五步安全语义一致，继续保留现有线性进度条。

当用户声明偏好减少动态效果时，系统须（SHALL）禁用垂直位移动画；阶段内容可直接切换，但不得再横向展开。

#### Scenario: 发送中只显示当前阶段卡

- **WHEN** 用户发送推理请求且响应卡处于发送中
- **THEN** 卡片以小型阶段指示加一个当前阶段卡展示，不出现五个阶段节点横向排布

#### Scenario: 阶段推进向上淡出并向下滑入

- **WHEN** 发送阶段从任一阶段推进到下一阶段
- **THEN** 前一阶段卡向上淡出，当前阶段卡从下方淡入，形成垂直幻灯片式转场

#### Scenario: 阶段切换不抖动布局

- **WHEN** 阶段卡内容切换
- **THEN** 转场区域高度保持稳定，响应卡不发生发出去阶段的上下抖动

#### Scenario: 阶段文案保持安全语义

- **WHEN** 发送阶段进入“建立加密通道”
- **THEN** 阶段说明表述为 OHTTP 加密并绑定网关证明后再发送，不出现“RATS-TLS 会话绑定”等错误表述

#### Scenario: 减少动态效果回退

- **WHEN** 用户系统偏好为减少动态效果
- **THEN** 阶段切换不随动垂直位移或淡入淡出，内容直接切换，并不横向展开五节点
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

系统须（SHALL）在设置页 TNG Gateway 区域展示与概览视图第 1、3、4 张状态卡相同的“运行状态”“远端链路”“远端证明”三张卡。三张卡的状态判定、状态文本、副标题和颜色语义须（SHALL）与概览对应卡完全同源；设置页“远端证明”卡 SHALL 具有与概览相同的图标-only 导出报告动作，且可用性、报告来源与导出结果语义与概览完全一致。设置页绝不（MUST NOT）另行使用独立的就绪判定、展示“控制信道已连接/已断开”摘要，或展示 TNG 版本概要。设置页 Gateway 区域不展示概览第 2 张“入口信息”卡，也不因此新增配置编辑控件。

#### Scenario: 设置页三卡与概览一致

- **WHEN** 概览与设置页在同一个 TNG 状态快照下渲染
- **THEN** 设置页显示“运行状态”“远端链路”“远端证明”三张卡，且每张卡的标题、状态文本、副标题和颜色语义分别与概览第 1、3、4 张卡一致

#### Scenario: 远端证明导出入口同源

- **WHEN** 概览与设置页在同一个 TNG 状态快照下渲染
- **THEN** 两处“远端证明”卡均显示同一图标-only 导出动作，该动作的可用状态与导出的报告 JSON 相同

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

系统须（SHALL）在桌面端启动时把主窗口呈现为最大化窗口，而不是以 1440×960 逻辑像素直接呈现；系统绝不（MUST NOT）使用全屏模式代替窗口最大化。系统可以保留 1440×960 作为还原/取消最大化时的基准尺寸。最小可调整窗口尺寸仍为 1120×720 逻辑像素。全局内容最小逻辑宽度不得超过 1120 像素；界面在最大化及最小窗口尺寸下均须（SHALL）避免因全局内容最小宽度超视口而横向滚动，概览的四卡与调试面板不因窗口过小而退化为不可读排布。设置页与入口编辑控件须（SHALL）采用紧凑但可用的宽度、高度和间距：主要输入控件不得横向截断；长内容页可保留纵向滚动。

#### Scenario: 默认窗口够宽够高

- **WHEN** 用户首次启动桌面 GUI
- **THEN** 主窗口以桌面窗口最大化方式呈现，且不是全屏

#### Scenario: 还原时不小于最小尺寸

- **WHEN** 用户取消最大化或把窗口缩到允许的最小尺寸
- **THEN** 窗口不小于 1120×720 逻辑像素，还原基准可回到配置的窗口尺寸

#### Scenario: 最小窗口保留可用布局

- **WHEN** 用户将窗口缩到允许的最小尺寸
- **THEN** 界面不出现因全局内容最小宽度超出视口而导致的横向滚动

#### Scenario: 表单控件不因默认尺寸截断

- **WHEN** 用户在最大化或最小窗口中打开设置页
- **THEN** 入口编辑器与 API Key 等主要输入控件完整可见、可交互，不因控件固定宽度过大而被迫横向滚动
### Requirement: 设置页密态推理功能卡布局

设置页“密态推理”功能卡标题区须（SHALL）使用比原有标题区高约 50% 的专门布局，且标题区最小高度不小于 66 逻辑像素；功能图标、标题和副标题在该标题行内保持相对位置并整体垂直居中。该卡内容区的应用字号一般的输入行上下留白须（SHALL）比原有布局约缩短 50%：卡片分隔线到 API Key 行上缘的额外间距和 API Key 行下缘到卡片内容底缘的额外间距均不超过 12 逻辑像素。API Key 输入框使用默认/普通表单行高，不使用大号输入框。这些调整仅作用于“密态推理”功能卡，绝不（MUST NOT）改变其他卡片、入口编辑行或全局卡片基础布局。

#### Scenario: 标题行加高且垂直居中

- **WHEN** 渲染设置页“密态推理”功能卡
- **THEN** 标题区高度不小于 66 逻辑像素，同时图标、标题和副标题整体垂直居中且相对位置保持稳定

#### Scenario: 内容留白收紧

- **WHEN** 渲染设置页“密态推理”功能卡
- **THEN** API Key 行上、下的功能卡额外间距均不超过 12 逻辑像素，输入框使用默认/普通表单行高

#### Scenario: 布局影响范围受限

- **WHEN** 渲染其他设置页卡片、TNG 配置入口编辑器或客户端信息卡
- **THEN** 这些区域不因“密态推理”功能卡布局调整而改变标题高度、内容留白或输入框尺寸
### Requirement: Ingress 新建与重置默认远端端口

当 GUI 初始化默认模板、新增 ingress 或用户切换 ingress 远端类型并重置远端字段时，mapping 形态的远端 `out.port` 须（SHALL）默认填充 `80`，http_proxy 形态的远端 `dst_filters.port` 须（SHALL）默认填充 `443`。该默认值只作用于远端目标端口，绝不（MUST NOT）改变 tngui 反代对外绑定默认端口 `9443` 或 TNG 内部注入端口。导入 JSON、用户显式修改后的端口和已有配置中的显式端口不被该默认值覆盖；http_proxy 域名前缀决定 `ohttp.tls` 的语义保持不变。

#### Scenario: 默认模板使用 mapping 80

- **WHEN** GUI 启动并渲染默认 mapping ingress
- **THEN** 远端 `out.port` 显示并序列化为 `80`

#### Scenario: 切换到 mapping 默认 80

- **WHEN** 用户把某条 ingress 的远端类型切换为 mapping 并重置字段
- **THEN** 远端 `out.port` 默认填充为 `80`

#### Scenario: 切换到 http_proxy 默认 443

- **WHEN** 用户把某条 ingress 的远端类型切换为 http_proxy 并重置字段
- **THEN** 远端 `dst_filters.port` 默认填充为 `443`

#### Scenario: 显式端口不被覆盖

- **WHEN** 用户导入或编辑一条远端端口为其他有效值的 ingress
- **THEN** 该显式端口保持不变；反代对外绑定仍默认使用 `9443`，TNG 内部注入端口逻辑不变
### Requirement: 可编辑文本输入禁用自动改写

对应用中用户可编辑、可输入英文文本的文本框和文本域，系统须（SHALL）通过输入控件属性禁用 WebKit/WebView 的自动首字母大写，并禁用自动更正；英文文本输入须（SHALL）按用户实际键入内容保留大小写。相关控件须（SHALL）携带 `autocapitalize=off` 与 `autocorrect=off`；通常还应禁用拼写检查以免平台辅助行为改写结果。该要求须（SHALL）覆盖设置页 API Key、ingress 远端主机名/域名、verify 字段、密态推理 model 与 prompt 以及原始 JSON 编辑器；纯数值控件可按数值输入实现。系统绝不（MUST NOT）在应用层自动将英文首字母改为大写。

#### Scenario: 英文首字母保持小写

- **WHEN** 用户在受支持的英文文本输入控件中输入以小写字母开头的内容
- **THEN** 控件值保持用户输入的小写首字母，应用层不自动改为大写

#### Scenario: 输入控件携带禁改写属性

- **WHEN** 渲染 API Key、远端主机名/域名、verify、model、prompt 或原始 JSON 等可编辑文本控件
- **THEN** 实际输入元素携带 `autocapitalize="off"` 和 `autocorrect="off"`，且不启用拼写检查

#### Scenario: 不改变校验与序列化

- **WHEN** 用户在禁用自动改写的输入框中配置主机名或 JSON
- **THEN** 配置校验、TLS 前缀派生和 JSON 序列化仍按原语义执行，不因禁用平台输入辅助而改变
### Requirement: 密态推理凭据只在 GUI 会话内

系统须（SHALL）将密态推理的 model 作为仅 GUI 会话内的内存态：model 在"密态推理"视图的请求面板内编辑，供发送使用，关闭 GUI 后不保留，也绝不（MUST NOT）写入 tng 配置或设置缓存。设置页的 apiKey 须（SHALL）随应用关闭流程写入设置缓存，并在下次 GUI 启动且缓存有效时恢复；apiKey 绝不（MUST NOT）写入 tng 配置或 `tng-runtime.json`。设置页"密态推理"卡 SHALL 只保留一个 API Key 输入框；该输入框 SHALL 默认以密码式遮盖渲染，并提供明确的显隐切换按钮。用户未显式切换前绝不（MUST NOT）明文展示；切换后 SHALL 显示真实值。该卡不得提供复制本地 URL、保存并验证、配置导入/导出、清除本机凭据或中心侧管理说明等额外控件与说明。

#### Scenario: 不入 tng-runtime.json

- **WHEN** 离开设置页触发 TNG 配置自动保存
- **THEN** 写盘的 `tng-runtime.json` 不含 model 或 apiKey 字段

#### Scenario: apiKey 跨会话恢复

- **WHEN** 用户填写 apiKey 后通过正常关闭流程退出 GUI AND 重新打开 GUI AND 设置缓存有效
- **THEN** "设置"视图的 apiKey 恢复为关闭前值

#### Scenario: 不持久化跨会话

- **WHEN** 用户填写 model 或设置缓存中 apiKey 非字符串并关闭后重新打开 GUI
- **THEN** "密态推理"视图的 model 为空；非法 apiKey 也恢复为空；有效 apiKey 按设置缓存规则恢复

#### Scenario: 设置页 API Key 为普通文本框

- **WHEN** 渲染设置页"密态推理"卡
- **THEN** 仅出现一个默认遮盖的 API Key 输入框和其显隐切换按钮；未切换时界面不显示 API Key 明文，切换后显示真实值；界面不出现保存并验证、复制本地 URL、配置导入/导出、清除本机凭据或中心侧凭据说明

#### Scenario: 推理页只读 model 且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以可编辑输入呈现于请求面板；apiKey 不在"密态推理"视图 UI 上展示，发送时仅作为 Authorization 头使用

#### Scenario: 推理页 model 输入与 apiKey 不展示

- **WHEN** 渲染密态推理视图
- **THEN** model 以可编辑输入呈现于请求面板（会话内内存、发送时作为 body.model）；apiKey 不在"密态推理"视图 UI 上展示，发送时仅作为 Authorization 头使用

#### Scenario: model+apiKey 变动不影响 tng 进程

- **WHEN** 用户修改 model（在"密态推理"视图）或 apiKey（在"设置"视图）
- **THEN** 不触发 TNG 配置 dirty / tng 进程重启；apiKey 边界仅在应用关闭 flush 时写入设置缓存
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

系统须（SHALL）为当前唯一 ingress 提供远程证明开关，并按以下互斥规则序列化：开关开启即 `no_ra=false`（默认）时序列化含 `verify = { model: "passport", as_provider: "tpm" }` 且不含 `no_ra` 键；开关关闭即 `no_ra=true` 时序列化含 `"no_ra": true` 且不含 `verify`。系统绝不（MUST NOT）同时输出 `no_ra` 与 `verify`，也绝不（MUST NOT）恒定平铺 `no_ra` 布尔，且绝不（MUST NOT）向用户提供编辑 `verify.model` / `verify.as_provider` 的结构化控件。导入 JSON、原始 JSON 应用回填或既有设置中的自定义 verify 字段须（SHALL）被标准化为默认值。

#### Scenario: verify 开（no_ra=false）

- **WHEN** 当前唯一 ingress 的远程证明开关开启，即 `no_ra=false`
- **THEN** 序列化该 ingress 含 `verify = { model: "passport", as_provider: "tpm" }`，且不含 `no_ra` 键

#### Scenario: verify 关（no_ra=true）

- **WHEN** 当前唯一 ingress 的远程证明开关关闭，即 `no_ra=true`
- **THEN** 序列化该 ingress 含 `"no_ra": true`，且不含 `verify`

#### Scenario: verify 可配置两条字段

- **WHEN** 渲染 RA 开启的 ingress，或导入/回填带有自定义 `verify.model` / `verify.as_provider` 的配置
- **THEN** 界面不提供两条 verify 可编辑字段，下一次用户侧序列化统一输出 `model=passport`、`as_provider=tpm`
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

系统须（SHALL）在设置页为当前唯一 ingress 呈现结构化编辑控件：卡片标题行显示“入口配置”标识与远程证明开关；内容第一行为本机端口/反代对外绑定（`host` 在 `127.0.0.1`（仅本机）/`0.0.0.0`（对外网卡）间 toggle + 对外 `port`，为 tngui 反代对外绑定、非 tng ingress 本地监听），独占一行；内容第二行为远端类型选择与其当前远端类型对应的远端字段，二者在同一横排依次出现。远端类型选项须（SHALL）为中文文案“端点映射”与“域名代理”，且不显示英文 `mapping` / `http_proxy`。系统默认须（SHALL）选中“域名代理”，并默认填写 `https://inference.cloud.misuan.com` 与远端端口 `443`。远端类型切换须（SHALL）即时生效，直接切换控件显示状态与对应字段值，绝不（MUST NOT）弹窗要求确认。系统绝不（MUST NOT）渲染独立的远程证明/verify 内容行，也绝不（MUST NOT）渲染 `verify.model` / `verify.as_provider` 输入框；设置页不得（MUST NOT）显示 `add_ingress` 管理层级、说明性文字 `（客户端 OHTTP 形态）`、新增 ingress 操作或删除 ingress 操作。

#### Scenario: 远端类型与远端字段同行

- **WHEN** 渲染当前唯一 ingress 的远端配置
- **THEN** 远端类型选择与当前类型对应的远端字段出现在同一横排

#### Scenario: 远端类型文案仅中文

- **WHEN** 渲染远端类型选择
- **THEN** 可选项显示为“端点映射”和“域名代理”，不显示英文 `mapping` 或 `http_proxy`

#### Scenario: 默认选中域名代理

- **WHEN** 用户未导入、未回填且无有效缓存配置
- **THEN** 远端类型默认选中“域名代理”，域名为 `https://inference.cloud.misuan.com`，远端端口为 `443`

#### Scenario: 远端类型切换即时生效无弹窗

- **WHEN** 用户在远端类型选择中从当前类型切换为另一类型
- **THEN** 控件即时切换为该类型的显示状态、当前远端字段更新为该类型默认值，且不出现任何确认对话框

#### Scenario: 远程证明开关表示 ra

- **WHEN** 渲染当前唯一 ingress 的远程证明配置
- **THEN** 远程证明开关位于 ingress 卡片标题行，表示“是否启用远程证明”（ra）；开关开启（ra=on/`no_ra=false`）时序列化使用默认 verify，开关关闭（ra=off/`no_ra=true`）时不渲染 verify，内容区不出现独立远程证明行或 verify 输入框

#### Scenario: 本地监听独立成行

- **WHEN** 渲染当前唯一 ingress 的内容第一行
- **THEN** 该行独占一行，呈现 tngui 反代对外绑定（`host` `127.0.0.1`/`0.0.0.0` toggle + 对外 `port`），不与远端类型/远端字段或远程证明开关同行；tng ingress 本地监听不在此行出现

#### Scenario: 不显示 add_ingress 管理层级

- **WHEN** 渲染设置页 ingress 配置
- **THEN** 界面显示当前唯一入口的“入口配置”卡片，不出现 `add_ingress` 管理标题、`（客户端 OHTTP 形态）` 说明文字、新增 ingress 按钮或删除 ingress 按钮
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
### Requirement: 用户可编辑端口限制为有效 TCP 端口

系统须（SHALL）将用户显式编辑的服务端口取值限定为 `1~65535`。该要求覆盖反代对外绑定端口、`mapping` 形态的远端端口和 `http_proxy` 形态的目标端口；服务端口 `0` 不是有效用户输入，越界数字也不是有效用户输入。系统绝不（MUST NOT）因表单输入缺失或越界而静默回退为另一个端口。

结构化端口输入控件须（SHALL）在输入发生前拦截一切会让端口文本变为非法值的行为：非法字符、`0`、越界数字、小数、前导 `0` 或多余位数均不得进入端口控件的可提交文本。反代对外端口与 `mapping` 远端端口为必填；在它们为空时控件须（SHALL）显示红色错误态。`http_proxy` 目标端口为可选，其留空不视为错误。若用户尝试任何非法输入，端口控件须（SHALL）保留当前合法文本并显示红色错误态作为反馈，不依赖失焦后的值修正。模型、序列化、导入、回填、启动前与后端校验仍须（SHALL）拒绝非法端口，不得因表单层已拦截而放宽。系统仍可对自动注入的 TNG 内部监听端口和管控端口自动选取端口，这些端口不属于用户编辑范围。

#### Scenario: 结构化端口控件限定可输入范围

- **WHEN** 用户在反代对外端口、mapping 远端端口或 http_proxy 目标端口输入框中输入超出 TCP 端口范围的数字
- **THEN** 界面不允许该输入以越界值提交为配置模型；结构化端口的可提交值只能是 `1~65535` 或对可选端口为空

#### Scenario: 必填端口缺失或非法时启动被拒

- **WHEN** 用户通过结构化表单、原始 JSON 或导入得到一条配置，且某条入口的反代对外端口或 mapping 远端端口缺失、等于 `0` 或超出 `65535`
- **THEN** 系统在拉起 tng 前以明确错误拒绝启动，不写另一个端口到最终配置

#### Scenario: http_proxy 端口留空表示不限定

- **WHEN** 用户把某条 `http_proxy` ingress 的目标端口留空
- **THEN** 序列化结果的对应 `dst_filters` 对象不含 `port` 键，配置不会被填充为默认端口或 `0`

#### Scenario: http_proxy 显式端口有效时保留

- **WHEN** 用户把某条 `http_proxy` ingress 的目标端口填写或导入为 `1` 到 `65535` 内的有效值
- **THEN** 序列化结果把该显式端口写入对应 `dst_filters` 的 `port` 字段且数值不改变

#### Scenario: 导入或回填非法端口不生效

- **WHEN** 用户导入或应用回填的 JSON 中，任一受管端口为 `0`、负数、超过 `65535`、非整数或必填端口缺失
- **THEN** 该导入/回填以明确错误失败且不改变当前配置；`http_proxy` 中缺失而非非法的 `dst_filters.port` 仍视为“不限定端口”

#### Scenario: 结构化端口控件拒绝非法文本进入

- **WHEN** 用户以键入、粘贴、拖入或选区替换方式试图让结构化端口框形成非数字文本、前导 `0`、小数、负数或 `65536`
- **THEN** 该文本不得进入控件或模型，控件保持原有值并呈现红色错误态

#### Scenario: 必填端口为空时显示错误

- **WHEN** 反代对外端口或 `mapping` 远端端口被用户清空
- **THEN** 端口控件呈现红色错误态，模型保留空值，且启动/保存前的既有校验继续拒绝该状态

#### Scenario: 可选端口留空不显示错误

- **WHEN** 用户清空 `http_proxy` 目标端口
- **THEN** 端口控件不呈现错误态，序列化结果省略 `dst_filters.port`
### Requirement: 设置页跨会话缓存

系统须（SHALL）在正常应用关闭流程中，于关闭完成前将设置页的已提交状态 flush 到本机应用数据目录内独立的设置缓存文件。缓存内容限定为当前结构化配置模型序列化出的用户侧 TNG 配置与设置页 apiKey；系统绝不（MUST NOT）缓存未点"应用回填表单"的原始 JSON 草稿、`model`、`control_interface.restful` 注入端口、tng 内部监听端口或其他推理 prompt。系统不得（MUST NOT）把该独立缓存文件用作 `tng-runtime.json`，也不得将 tng 内部注入值写入该缓存。

GUI 启动时系统须（SHALL）在渲染设置状态前读取该缓存，并仅恢复通过设置缓存校验的字段：TNG 配置须能按用户侧配置语义回填，且用户可编辑端口保持有效；apiKey 须为字符串。若校验失败、缓存缺失、schema 不支持、文件损坏或字段不合法，对应字段使用默认模板或空值，GUI 不得（MUST NOT）因此无法启动。恢复缓存只初始化设置状态，绝不（MUST NOT）自动启动 tng、自动重启 tng 或改写控制端口。

#### Scenario: 关闭前 flush 已提交设置

- **WHEN** 用户编辑结构化设置或 API Key 后通过正常关闭流程退出应用
- **THEN** 系统在应用关闭完成前把当前 TNG 配置模型序列化结果和 apiKey 写入独立设置缓存文件

#### Scenario: 原始 JSON 草稿不进入缓存

- **WHEN** 用户在原始 JSON 视图修改文本但未点击"应用回填表单"即退出应用
- **THEN** 该未应用草稿不写入设置缓存；下次启动按已提交的 TNG 配置模型或默认模板恢复

#### Scenario: 重启后恢复设置

- **WHEN** GUI 正常关闭前成功 flush AND 用户重新打开 GUI AND 缓存 schema 与内容均有效
- **THEN** 设置视图恢复关闭前的 TNG 配置（含 `tngui_outward`、ingress、no_ra/verify 状态）与 API Key，且 tng 不会被自动拉起

#### Scenario: 不合理配置不恢复

- **WHEN** 设置缓存中的 TNG 配置无法回填、缺必需端口、端口非法、字段类型不匹配，或缓存文件损坏/schema 不支持
- **THEN** 该 TNG 配置不恢复，设置视图使用内置默认模板；界面仍可正常打开和编辑

#### Scenario: 非法 API Key 不恢复

- **WHEN** 设置缓存中的 apiKey 非字符串
- **THEN** 系统不恢复该 apiKey，设置页 API Key 为空，其余有效设置仍可恢复

#### Scenario: 关闭流程失败可感知但不阻塞既有控制流

- **WHEN** 应用关闭中设置缓存 flush 因文件系统错误失败
- **THEN** 系统记录可诊断的失败信息并继续既有关闭流程；下次启动按无有效缓存处理
### Requirement: 远程证明服务配置与 RVS 地址一致性

系统须（SHALL）在“设置”视图的 TNG 配置区域中，为远程证明提供标题为“远程证明服务配置”的配置块；当任意一条 ingress 开启远程证明时，该配置块展示在 TNG 配置内容下方，并承载一个可编辑的 RVS 地址输入。首次启动、设置缓存缺失/损坏、schema不支持或校验失败时，该地址必须预填为 `https://rvs.tsk.com:9443`；存在有效设置缓存时，系统必须直接恢复缓存中的用户填写值，不得覆盖为默认地址。该值必须被视为 TNG 配置状态的一部分，并随设置缓存跨会话保存。
当远程证明开启并启动或重启 tng 进程时，系统必须把界面中当前提交的 RVS 地址放入 tng 子进程环境变量 `RATS_TEE_VERIFIER_URL`，且该值必须与界面中当前显示/提交的值完全一致；若用户在 tng 运行期间修改 RVS 地址，保存/离开设置时须按现有 TNG 配置修改语义触发重启，使新值生效。
为了保持 TNG 严格 JSON 解析兼容，该值不得作为未知字段写入 `tng-runtime.json`；GUI 须（SHALL）在生成 TNG 对外配置时忽略/剥离该字段，只把该字段作为 GUI 侧配置状态并在进程启动时注入为环境变量。

#### Scenario: RA 开启时显示远程证明服务配置

- **WHEN** 任意一条 ingress 开启远程证明，且用户进入“设置”视图
- **THEN** TNG 配置内容下方展示标题“远程证明服务配置”，并出现可编辑的 RVS 地址输入

#### Scenario: 首次启动预填默认 RVS 地址

- **WHEN** 应用首次启动或设置缓存缺失/无效，且有任何 ingress 开启远程证明
- **THEN** “远程证明服务配置”中的 RVS 地址预填为 `https://rvs.tsk.com:9443`

#### Scenario: 有效缓存优先恢复用户填写值

- **WHEN** 设置缓存有效且其中保存了用户修改后的 RVS 地址
- **THEN** 应用启动后“远程证明服务配置”恢复该缓存值，不会被 `https://rvs.tsk.com:9443` 覆盖

#### Scenario: RVS 地址变化触发重启

- **WHEN** 用户修改 RVS 地址并保存/离开设置视图，且 tng 正在运行
- **THEN** 系统按现有 TNG 配置修改语义保存配置并重启 tng，使新 RVS 地址生效

#### Scenario: 启动进程使用的地址与界面一致

- **WHEN** 用户在“远程证明服务配置”中填写或恢复某个 RVS 地址，并触发 tng 启动或重启
- **THEN** tng 子进程环境变量 `RATS_TEE_VERIFIER_URL` 的值与界面当前提交的值完全一致

#### Scenario: 不破坏 TNG runtime JSON

- **WHEN** 系统创建传给 tng 的配置文件
- **THEN** 该配置文件不包含 GUI 侧 RVS 地址字段，TNG JSON 结构与现有 `deny_unknown_fields` schema 保持兼容

#### Scenario: 全部 ingress 关闭远程证明时不展示配置块

- **WHEN** 所有 ingress 均关闭远程证明
- **THEN** “设置”视图不展示“远程证明服务配置”作为当前生效的配置块，同时已保存的 RVS 地址值仍可留在设置缓存中供后续 RA 开启时恢复

### Requirement: 单一 ingress 与默认远端配置

系统须（SHALL）只允许配置一条 ingress。设置页不得（MUST NOT）展示 `add_ingress` 层级或多 ingress 列表，也不得（MUST NOT）提供新增 ingress 操作。导入 JSON、应用原始 JSON 回填或恢复设置缓存时，系统须（SHALL）仅保留第一条 ingress；若不存在可识别的 `mapping` / `http_proxy` 条目，系统须（SHALL）回退到默认单 ingress 配置。序列化结果仍须（SHALL）使用 TNG 兼容的 `add_ingress` 数组，且仅含一个元素。默认远端类型须（SHALL）为“域名代理”，默认域名为 `https://inference.cloud.misuan.com`，默认远端端口为 `443`。RVS 地址默认值须（SHALL）为 `https://rvs.tsk.com`，且仅在缺少导入值、回填值或有效缓存值时使用，不得（MUST NOT）覆盖用户显式配置。

#### Scenario: 仅保留一条 ingress

- **WHEN** 导入或回填的 JSON 中存在多条 ingress
- **THEN** 系统仅保留第一条 ingress，并在 UI 上仍只呈现一条配置

#### Scenario: 无可识别 ingress 时回退默认

- **WHEN** 导入、回填或缓存中没有可识别的 `mapping` / `http_proxy` ingress
- **THEN** 系统回退到默认单 ingress 配置，并选中“域名代理”，默认域名与端口按默认值填充

#### Scenario: 序列化仍为数组

- **WHEN** 系统导出或应用配置
- **THEN** 生成的 JSON 中 `add_ingress` 为数组且仅含一个元素，保持 TNG wire format 兼容

#### Scenario: RVS 默认值不覆盖用户配置

- **WHEN** 导入的 JSON、回填的原始 JSON 或有效设置缓存中已有 RVS 地址
- **THEN** RVS 地址使用该显式值，不使用默认 `https://rvs.tsk.com`

### Requirement: 设置页 TNG 配置锁定

系统须（SHALL）在设置页“导入配置”与“导出配置”按钮左侧提供锁定 toggle。锁定 toggle 默认须（SHALL）为开启状态。锁定开启时，TNG 配置区域内所有编辑控件须（SHALL）不可交互，包括远程证明开关、RVS 地址、远端类型选择、远端字段、本机绑定、端口输入和原始 JSON 编辑。锁定关闭时，上述控件须（SHALL）恢复可交互。锁定 toggle 本身、导入配置按钮和导出配置按钮不因锁定而不可交互；该状态仅影响配置控件，不影响概览状态卡、报告导出或 tng 进程管理。

#### Scenario: 默认锁定开启

- **WHEN** 用户打开设置页
- **THEN** TNG 配置锁定 toggle 默认开启

#### Scenario: 锁定生效

- **WHEN** 锁定开启
- **THEN** TNG 配置区域内的远程证明开关、RVS 地址、远端类型选择、远端字段、本机绑定、端口输入与原始 JSON 编辑均不可交互

#### Scenario: 解锁恢复可编辑

- **WHEN** 用户关闭锁定
- **THEN** 上述配置控件恢复可交互

#### Scenario: 不影响导入导出与报告导出

- **WHEN** 锁定开启
- **THEN** “导入配置”“导出配置”按钮与远端证明卡右侧图标-only 导出动作仍可正常使用

#### Scenario: 锁定状态不写入 TNG JSON

- **WHEN** 用户切换锁定状态并导出配置
- **THEN** 导出的 TNG 配置 JSON 不包含锁定状态字段

### Requirement: 文本输入首尾空白规范化

系统须（SHALL）对以下文本输入框的字符串值执行首尾 trim：ingress `http_proxy` 形态的域名 / 主机名输入框，以及密态推理请求面板的模型输入框。trim 须（SHALL）在值进入对应前端状态、配置序列化、推理请求或接入示例前完成，且仅删除前导与尾部空白字符；系统不得（MUST NOT）删除字符串内部字符、改变大小写或做其它格式化。系统不得（MUST NOT）把该 trim 行为扩展到 prompt textarea、API Key、RVS 地址或端口输入控件。

导入 JSON、原始 JSON 回填或设置缓存恢复得到的 `dst_filters.domain` 值也须（SHALL）按同一规则扣除首尾空白，避免隐藏空白状态。纯空白模型值须（SHALL）规范化为空字符串，并沿用现有空模型语义；模型是否填写仍不得（MUST NOT）影响密态推理请求面板的可发送门锁。

#### Scenario: 域名输入去除首尾空白

- **WHEN** 用户在 `http_proxy` ingress 的域名输入框输入或粘贴包含首尾空白的值
- **THEN** 文本框提交到配置模型与序列化结果的域名不含首尾空白；字符串内部字符保持原样，`https://` 前缀仍按现有规则剥离并派生 `ohttp.tls: true`

#### Scenario: 导入或恢复的域名规范化

- **WHEN** 导入 JSON、应用原始 JSON 回填或恢复设置缓存时，某条 `http_proxy` ingress 的 `dst_filters.domain` 带有首尾空白
- **THEN** 结构化域名输入框和下一次用户侧序列化结果不保留这些空白

#### Scenario: 模型输入去除首尾空白

- **WHEN** 用户在密态推理请求面板的模型输入框输入或粘贴包含首尾空白的值
- **THEN** 前端使用 trim 后的值作为请求 `body.model`、curl 示例与 Model ID 预览中的模型值

#### Scenario: 纯空白模型按空值处理

- **WHEN** 模型输入框只包含空白字符
- **THEN** 该输入规范化为空字符串，并沿用现有空模型语义；不得（MUST NOT）以纯空白字符串作为模型身份发送，且可发送门锁仍不因模型未填写而关闭

#### Scenario: Prompt 不被该规则处理

- **WHEN** 用户在 prompt textarea 中输入首尾空白
- **THEN** prompt 内容保持原样，不套用域名 / 模型输入框的 trim 行为
