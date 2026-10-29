## Purpose

渲染一个最小化 GUI，依据用户编写的 JSON 配置启动并重启 tng 进程，展示 tng 只读控制面的状态，且不链接任何 tng 代码。

## Requirements

### Requirement: 左侧导航品牌区紧凑布局

系统须（SHALL）在左侧导航栏顶部使用紧凑品牌区：第一行展示品牌图标与“可信网关”，第二行单独展示“Trusted Network Gateway”。英文全名须（SHALL）完整可见，不得因品牌区布局溢出左侧导航栏。品牌图标容器须（SHALL）为圆角矩形，圆角半径为 `4px`。

#### Scenario: 品牌区两行显示

- **WHEN** 用户打开应用并查看左侧导航栏
- **THEN** 品牌图标的右侧同一行显示“可信网关”，而不是右侧显示英文名
- **AND** 英文名“Trusted Network Gateway”显示在图标所在行的下方
- **AND** 英文全名完整可见且不超出左侧导航栏

#### Scenario: 品牌图标圆角

- **WHEN** 用户查看左侧导航栏品牌图标容器
- **THEN** 该容器为圆角矩形，且圆角半径为 `4px`

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

系统须（SHALL）在"设置"视图提供结构化控件，仅承载唯一客户端 ingress（`add_ingress` 中只保留一个元素），不承载 `add_egress`。当前唯一 ingress 锁定为客户端 OHTTP 形态：
- 远端类型二选一：`地址端口`（`mapping`，`out = {host:<IP>, port:<port>}`，`host` 须为 IP）或 `域名`（`http_proxy`，`dst_filters = [{domain:<主机名>, port:<端口号>}]`，主机名与端口分两个控件、主机名仅含主机名不含端口、端口走独立 `port` 字段；域名框接受可选 `http://` / `https://` 前缀，前缀触发 `ohttp.tls` 派生并剥离进 `domain`——`https://` 派生 `tls: true`，`http://` 或无前缀不派生）；`socks5`/`netfilter`/`hook`/`mapping_udp` 不作为 ingress 模式提供。
- tng 本地监听 `host`/`port` 由 tngui 自动注入并对用户隐藏；ingress 编辑器行 1 改为呈现 tngui 反代对外绑定——`host` 在 `127.0.0.1`（仅本机）/`0.0.0.0`（对外网卡）间 toggle、`port` 可配（默认 `127.0.0.1`），作为 tngui 侧设置不进 tng 配置（见"tngui 反向代理作为 pre-TNG path 注入代理"）。
- `ohttp` 永远开，且当前唯一 ingress 的 `ohttp.path_rewrites` 与 `ohttp.header_passthrough.request_headers` 锁定为 tngui 本地 path-model 反代注入所需配置（见"客户端 ingress 锁定 OHTTP 配置"），用户不可关闭、不可编辑。
- 保留 `no_ra` 开关；其与 `verify` 的序列化语义见"ingress 的 no_ra 与 verify 互斥序列化"。

系统绝不（MUST NOT）提供 `control_interface.restful`（host 或 port）、`path_rewrites`、`header_passthrough.request_headers` 的任何结构化控件。系统绝不（MUST NOT）提供 `add_egress` 的任何结构化控件——客户端侧不承载 egress。系统绝不（MUST NOT）提供 tng ingress 本地监听 `host`/`port` 的任何结构化控件或可编辑字段（由 tngui 启动时注入）。

#### Scenario: 选择远端类型
- **WHEN** 用户在"设置"视图当前唯一 ingress 上选择远端类型
- **THEN** 系统仅提供"地址端口(mapping) / 域名(http_proxy)"两种远端类型，并在选定类型后展示该形态对应字段集，不出现 `socks5`/`netfilter`/`hook` 选择

#### Scenario: 切换模式重置字段
- **WHEN** 用户切换当前唯一 ingress 的远端类型
- **THEN** 系统以新形态的字段集替换该条原有字段，`ohttp`（常开且写死 path rewrite 与 credential passthrough）与 `no_ra` 保持不变

#### Scenario: 本地监听 host 锁死回环
- **WHEN** 用户编辑 ingress 的本机端口
- **THEN** 行 1 以 tngui 反代对外绑定呈现：`host` 在 `127.0.0.1`/`0.0.0.0` 间 toggle、`port` 可配；tng ingress 本地监听 `host`/`port` 不出现、不可编辑

#### Scenario: 密态推理连接信息单一来源
- **WHEN** 渲染"设置"视图的密态推理卡片
- **THEN** 卡片承载 API Key 与本规格定义的缓存盐配置项；本机端口与远端一律取自结构化 ingress，不出现与结构化 ingress 断开的 `localPort`/`outboundAddress` 输入

#### Scenario: 启动时序列化为 TNG JSON
- **WHEN** 用户触发启动/重启
- **THEN** 系统将结构化控件状态序列化为 TNG JSON，不含 `control_interface.restful`、不含 `add_egress`、不含反代对外绑定字段，当前唯一 ingress 必含锁定 `ohttp.path_rewrites` 和请求头透传白名单；tng ingress 本地监听 `host`/`port` 不出现在用户序列化的 ingress 里

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
- **远程证明版（RA 版，当前唯一 ingress 开启远程证明时使用）** 直接保存在源仓库 `resources/` 目录内并随包分发，按平台命名：Windows x64 为 `tng.exe`、Linux x86_64 为 `tng-linux-x86_64`、Linux aarch64 为 `tng-linux-aarch64`、macOS aarch64 为 `tng-aarch64-apple-darwin`；启动/重启时从 `resource_dir` 解析对应文件后拉起，绝不（MUST NOT）回退到 `PATH` 或普通版。

**RA 判定**：启动/重启 tng 时，若最后生效配置中唯一 ingress 开启远程证明（`no_ra` 非 `true`——含序列化为 `verify` 的条目），系统须（SHALL）使用 RA 版二进制；仅当该 ingress `no_ra=true` 时使用普通版。当需要 RA 版而其在 `resource_dir` 中不存在（含无 RA 版产物的平台，如 macOS x86_64——该架构不再受支持）时，系统须（SHALL）拒绝本次启动并返回明确错误，绝不（MUST NOT）静默回退到普通版，且不得终止当前已在运行的原会话。

#### Scenario: 随包分发命中

- **WHEN** 已安装的 GUI（随包含普通版 `tng-nora` 或 Windows 的 `tng-nora.exe` 资源）在当前唯一 ingress `no_ra=true` 时触发启动/重启
- **THEN** 系统从 `resource_dir` 解析到普通版二进制并拉起，无需用户自行放置

#### Scenario: 开发态 PATH 兜底

- **WHEN** 开发态（随包资源中无 `tng-nora`，例如 `cargo run`）且 RA 全关时触发启动/重启
- **THEN** 系统回退使用 `PATH` 上的 `tng` 拉起

#### Scenario: 替换 tng 无需重编 GUI

- **WHEN** 用户替换 `resource_dir` 中的普通版或 RA 版二进制文件后触发启动/重启
- **THEN** GUI 拉起被替换后的对应二进制文件，无需重新编译 GUI

#### Scenario: 当前唯一 ingress 开启 RA 时使用 RA 版

- **WHEN** 最后生效配置中唯一 ingress 开启远程证明（`no_ra` 非 `true`）时触发启动/重启
- **THEN** 系统按当前平台从 `resource_dir` 解析对应 RA 版二进制（`tng.exe` / `tng-linux-x86_64` / `tng-linux-aarch64` / `tng-aarch64-apple-darwin`）并拉起

#### Scenario: RA 版缺失拒绝启动且不回退

- **WHEN** 唯一 ingress 开启远程证明，而当前平台的 RA 版二进制在 `resource_dir` 中不存在（如 macOS x86_64，或文件被移除）
- **THEN** 本次启动被拒绝并返回明确错误，不拉起普通版、不回退 `PATH`，且不终止当前已在运行的原会话

#### Scenario: 切换 RA 开关重启后换用对应二进制

- **WHEN** 当前唯一 ingress 原为 `no_ra=true`（普通版运行中）时，用户开启远程证明后保存/重启
- **THEN** 重启完成后的本次会话由 RA 版二进制承载；反向关闭远程证明并重启后，会话改由普通版承载

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

### Requirement: 密态推理模型清单驱动测试请求

系统须（SHALL）在密态推理视图提供当前 GUI 会话内的多轮对话请求面板。面板的“可发”门锁须（SHALL）同时满足：概览“运行状态”为“运行”、本机已配置 api-key、模型发现请求成功返回至少一个模型，且当前选中模型属于最新模型清单。

发送时按 OpenAI compatible 格式 POST 到 tngui 反代对外端点，携带 `Authorization: Bearer <apiKey>` 与 `{model, messages, stream: true, reasoning_effort}` body。`stream` 恒为 `true`。`messages` 须（SHALL）逐字携带当前共享会话中此前已完整完成的 user 消息、assistant 最终 `content` 与其 `tool_calls`、以及 `role:"tool"` 的工具结果消息，并追加本轮用户输入原文；两种运行模式共用该上下文，不因模式切换清空或裁剪。assistant 的 `reasoning` 绝不（MUST NOT）进入后续请求上下文，失败、中断或用户主动停止的 assistant 消息也不得作为已完成上下文传给模型。系统不得（MUST NOT）对用户输入内容做 trim 或其他本地格式化。系统绝不（MUST NOT）在前端或反代中另发 `x-model` 头；模型身份由反代按 body.model 改写请求 path。

响应须（SHALL）按 OpenAI compatible SSE 数据流逐事件处理，并保留事件到达顺序：每节非空 `choices[0].delta.reasoning` 和每节非空 `choices[0].delta.content` 均须（SHALL）作为带类型的增量交给聊天 UI，`choices[0].delta.tool_calls` 增量须（SHALL）作为工具调用事件按到达顺序交给聊天 UI；不含 reasoning/content/tool_calls、或对应字段为空的事件须（SHALL）跳过。收到 `data: [DONE]` 时标记当次响应完整完成。推理流在 `[DONE]` 前中断（连接断开、提前 EOF 或事件解析失败）时，系统须（SHALL）保留已到达的 reasoning 与 content、标注当次响应不完整并给出失败摘要，绝不（MUST NOT）清空或改写已到达文本。失败诊断中的 Authorization 须（SHALL）脱敏。

密态推理请求面板的模型控件须（SHALL）是基于 `/v1/models` 响应创建的选项下拉菜单。系统须（SHALL）解析 OpenAI compatible 响应中的 `data[].id` 作为模型 ID，只允许用户在下拉选项之间切换，不得提供自由文本输入、创建新值、空选项或清除选择。GUI 进程内存中的模型清单、选中模型、对话消息与思考强度须（SHALL）在应用内页面导航之间保留；GUI 进程退出后不得保留，也绝不（MUST NOT）写入 tng 配置或设置缓存。RA 过程保持占位。

#### Scenario: 可发判定包含运行态、api-key 与清单内选中模型

- **WHEN** 用户处于密态推理请求面板
- **THEN** 面板仅在概览运行态、api-key、模型发现成功、模型清单非空与清单内选中模型同时满足时可发送

#### Scenario: 多轮请求携带完整消息上下文

- **WHEN** 上一轮 user 输入和 assistant 最终回答均已完成，用户发送下一轮输入
- **THEN** 请求 body 的 `messages` 依次包含此前 user 消息、此前 assistant 最终 `content` 与其 `tool_calls`、`role:"tool"` 工具结果消息和本轮 user 输入原文，并携带 `"stream": true` 与当前思考强度对应的 `reasoning_effort`

#### Scenario: 模式切换后上下文无缝衔接

- **WHEN** 用户在完成若干轮对话（含工具调用）后切换运行模式并再次发送
- **THEN** 新的请求 `messages` 仍逐字包含此前完整会话（含 assistant `tool_calls` 与 `role:"tool"` 结果），不因模式切换被清空、裁剪或拍平

#### Scenario: reasoning 不进入后续上下文

- **WHEN** 上一轮 assistant 响应包含 reasoning 与最终 content，并作为已完成消息保留在聊天 UI 中
- **THEN** 下一轮请求 `messages` 中的 assistant 消息只包含最终 `content`，不包含 reasoning

#### Scenario: 失败响应不进入后续上下文

- **WHEN** 上一轮 assistant 响应失败或在 `[DONE]` 前中断
- **THEN** 该 assistant 消息仍可在聊天 UI 中展示失败或部分内容，但不作为已完成上下文进入下一轮请求 `messages`

#### Scenario: thinking 模型增量按类型分流

- **WHEN** SSE 流依次返回包含 `delta.reasoning`、空 `delta`、包含 `delta.content` 与 `data: [DONE]` 的事件
- **THEN** 系统按到达顺序把非空 reasoning 和 content 区分为两种增量交给聊天 UI，跳过空增量，收到 `[DONE]` 后标记当次响应完整完成

#### Scenario: 工具调用增量按顺序交给 UI

- **WHEN** SSE 流返回包含 `choices[0].delta.tool_calls` 的事件
- **THEN** 系统把工具调用增量按到达顺序作为工具调用事件交给聊天 UI，用于渲染工具调用步骤

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
- **THEN** 客户端立即接收并渲染该增量，不再有缓冲等待揭示的阶段；首个增量到达前气泡不显示空文本

#### Scenario: 后续增量逐节追加

- **WHEN** 输出已开始且 SSE 流继续返回 reasoning 或 content 增量
- **THEN** assistant 气泡按到达顺序分别追加到 reasoning 或 content 区域，不丢弃或重排事件

#### Scenario: 收到 DONE 标记完整完成

- **WHEN** SSE 流返回 `data: [DONE]` 事件
- **THEN** 系统停止追加并把当次响应在协议层标记为完整完成，assistant 气泡进入完成态且不显示空文本

#### Scenario: 无内容事件不产生空渲染

- **WHEN** SSE 事件不含非空 `delta.reasoning`、`delta.content` 或 `delta.tool_calls`（如首节仅含 role、终止节仅含 finish_reason）
- **THEN** 该事件被跳过，不向 assistant 气泡追加空文本或空占位内容，也不改变 `▶解密中` 指示

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

### Requirement: 密态推理多轮对话界面

系统须（SHALL）以固定高度的多轮聊天区域承载密态推理请求调试：历史消息按时间顺序渲染，用户消息靠右侧气泡显示，assistant 消息靠左侧气泡显示；模型选择和可发状态保留在聊天区域上方。用户输入框须（SHALL）固定在聊天区域下方，默认呈现 1 行高度，随内容自动增长，最高显示 8 行；超过 8 行后在输入框内部纵向滚动，不得让整个页面因输入内容持续撑大。输入框右侧主操作控件须（SHALL）在空闲或上一轮终态时显示“发送”，在本轮请求未终态时显示“停止”。

用户发送后，输入框须（SHALL）清空，用户输入原文须（SHALL）立即显示为右侧气泡；随后须（SHALL）立即创建左侧 assistant 气泡承载 `▶解密中` 指示或响应输出。`Agent 模式` 下该 assistant 气泡须（SHALL）承载整轮交互（多轮推理与工具调用）直至本轮进入终态，不按推理轮次拆分为多个气泡。聊天消息区域在整个流式过程中须（SHALL）使用固定高度的纵向滚动容器，接收新消息或增量时自动滚动到底部；流式完成或失败不改变消息区域高度。界面不得（MUST NOT）显示“本客户端不是聊天工具”或“不提供会话历史、多轮对话管理”提示。

#### Scenario: 用户输入立即进入右侧气泡

- **WHEN** 用户输入非空内容并触发发送
- **THEN** 输入框清空，用户输入原文立即作为右侧用户气泡显示在聊天区域内

#### Scenario: assistant 气泡立即出现

- **WHEN** 右侧用户气泡加入聊天区域
- **THEN** 左侧 assistant 气泡立即出现并进入当轮 `▶解密中` 指示或响应状态

#### Scenario: Agent 模式单气泡承载整轮交互

- **WHEN** Agent 模式一次发送触发多轮推理与工具调用
- **THEN** 聊天区域内只新增一个 assistant 气泡，整轮推理文本与工具调用时间线都在该气泡内呈现

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

系统须（SHALL）在模型选择控件右上角提供“思考强度”滑块控件，停靠值为“关 / 低 / 中 / 高”，默认值为“中”。控件值须（SHALL）按以下映射进入每轮推理请求：关 → `reasoning_effort: "none"`；低 → `"low"`；中 → `"medium"`；高 → `"high"`；`对话模式` 与 `Agent 模式` 须（SHALL）共用该映射。控件状态仅保留在 GUI 进程内存中，不得（MUST NOT）写入设置缓存或 tng 配置。

滑块调整不得（MUST NOT）改变已经发出的进行中请求，只影响下一次发送。系统不得（MUST NOT）向用户提供 `thinking_token_budget` 输入或 token 数值控制。思考强度在应用内页面导航之间随推理页进程内存状态保留，GUI 进程退出后重置为默认值。

#### Scenario: 默认中强度

- **WHEN** GUI 进程首次打开密态推理视图
- **THEN** 思考强度滑块选中“中”，下一次请求携带 `reasoning_effort: "medium"`

#### Scenario: 滑块映射请求字段

- **WHEN** 用户分别选择“关”“低”“中”“高”后发送请求
- **THEN** 请求 body 依次携带 `reasoning_effort` 为 `none`、`low`、`medium`、`high`

#### Scenario: 两种模式共用同一映射

- **WHEN** 用户在 `Agent 模式` 下选择“高”并发送
- **THEN** 该轮模型请求同样携带 `reasoning_effort: "high"`，与 `对话模式` 使用同一映射

#### Scenario: 调整不影响进行中请求

- **WHEN** 一轮请求仍在解密中、流式接收或终态完成前
- **THEN** 调整思考强度滑块只更新下一次请求使用的值，不修改进行中请求已发送的 body，也不重启 TNG

#### Scenario: 不暴露 token budget

- **WHEN** 渲染密态推理请求调试页面
- **THEN** 界面不提供 `thinking_token_budget` 文本框、滑块或数值显示作为用户可编辑配置

### Requirement: 密态推理调试页身份注入控件与默认状态

系统 SHALL 在密态推理请求调试页的模型选择控件与思考强度控件之间提供“注入身份”开关；开关标签由静态前缀“注入”与可点击后缀“身份”组成，点击“身份”SHALL 展开或收起身份提示词编辑区。开关默认开启，编辑区默认收起。编辑区 SHALL 使用固定 `480px` 宽度，高度随内容在 4 到 12 行之间自动调整，超过 12 行后在编辑区内部滚动，且不得压缩聊天记录的固定高度。

#### Scenario: 控件位置与默认状态

- **WHEN** 用户打开密态推理页的“请求调试”选项卡
- **THEN** “注入身份”开关位于模型选择控件与思考强度控件之间
- **AND** “身份”是“注入”后的可点击文本后缀
- **AND** 开关默认开启，身份提示词编辑区默认收起

#### Scenario: 编辑区展开与尺寸约束

- **WHEN** 用户点击“身份”展开编辑区
- **THEN** 编辑区显示在身份开关下方，宽度为 `480px`，高度随内容在 4 到 12 行之间调整
- **AND** 超过 12 行后编辑区内部滚动，聊天记录高度不因编辑区展开而压缩

### Requirement: 密态推理默认身份提示词

系统 SHALL 内置默认身份提示词，覆盖 Agent 的本地运行边界、TEE 概念、TNG 与基于远程证明的链路加密、TEE 内推理数据的保护范围、本地工具安全提醒，以及不得虚构实现细节的约束。`对话模式` 与 `Agent 模式` SHALL 共用同一段默认文案。

#### Scenario: 默认身份提示词内容

- **WHEN** GUI 进程首次打开密态推理页
- **THEN** 身份提示词恰为以下文本：

```text
你是由蚂蚁密算公司提供的密态推理方案驱动的 AI Agent。
本应用中的 Agent 框架运行在用户终端上，处于用户信任域内，但在可信执行环境（TEE）之外。Agent 的编排和本地工具调用（例如文件读取、目录浏览、内容搜索）都发生在用户本地环境中，工具访问到的本地数据、工具参数与工具结果不受 TEE 保护。
TEE（可信执行环境）是处理器提供的隔离运行区域，区域外的操作系统、平台运维和硬件管理员无法读取其中的明文数据。TNG（Trusted Network Gateway，可信网络网关）位于用户终端与远端推理服务之间，负责转发推理请求。建立加密链路前，它会通过远程证明校验对端确实运行在符合预期的 TEE 中，运行代码的度量（可验证摘要）和服务身份均可信；验证失败即拒绝通信，后续传输保持加密并绑定到该已验证环境。
模型的推理请求与推理计算在该 TEE 中完成。在 TEE 内部，用户提示词、推理中间过程和模型输出都在加密状态下处理和传输，不会以明文泄露给推理宿主机操作系统、平台运维人员或硬件管理员；工具结果进入推理请求后，也只在 TEE 内处理和传输时受到保护。
需要使用本地工具时，你应主动提醒用户确认工具范围和数据的敏感程度，避免读取不必要的敏感文件或目录。
说明身份或运行背景时，可以描述自己运行在由远程证明验证的密态推理环境中，并说明 Agent 的工具执行发生在用户本地环境；但不要虚构具体硬件型号、证明服务实现细节或其他未提供的体系结构信息。
```

#### Scenario: 默认文案明确 Agent 与 TEE 的边界

- **WHEN** 用户查看或发送默认身份提示词
- **THEN** 文案说明 Agent 框架运行在用户终端、处于用户信任域但在 TEE 之外
- **AND** 文案说明本地工具访问的数据、参数与结果不受 TEE 保护
- **AND** 文案说明模型推理发生在 TEE 内，TNG 基于远程证明建立加密链路
- **AND** 文案要求 Agent 在使用本地工具时提醒用户确认工具范围与数据敏感程度

### Requirement: 密态推理身份提示词注入语义

“注入身份”开启时，系统 SHALL 仅对通过密态推理调试页发送的请求生效：`对话模式` SHALL 在 `messages` 首部追加一条 `role: "system"`、内容为当前身份提示词的消息；`Agent 模式` SHALL 使用同一提示词作为本轮 system 提示。关闭注入时，后续请求 MUST NOT 携带该身份提示词。身份提示词与用户输入 MUST NOT 被 trim 或本地格式化，身份提示词 MUST NOT 作为 user / assistant 聊天气泡渲染或写入对话历史状态。

#### Scenario: 对话模式默认注入

- **WHEN** “注入身份”保持默认开启，用户以 `对话模式` 发送一轮请求
- **THEN** 请求 `messages[0]` 为 `{ "role": "system", "content": <当前身份提示词> }`
- **AND** 其后依次为共享会话上下文与本轮用户输入原文

#### Scenario: Agent 模式使用同一提示词

- **WHEN** “注入身份”保持默认开启，用户以 `Agent 模式` 发送一轮请求
- **THEN** 本轮 Agent 运行使用与 `对话模式` 相同的身份提示词作为 system 提示
- **AND** 聊天记录中不出现该身份提示词对应的 user / assistant 气泡

#### Scenario: 关闭注入不携带身份提示词

- **WHEN** 用户关闭“注入身份”后发送下一轮请求
- **THEN** 该轮请求不携带由调试页注入的身份提示词
- **AND** 共享会话上下文按既有规则继续携带

#### Scenario: 提示词内容原样注入

- **WHEN** 身份提示词包含首尾空白、换行或其他原始格式
- **THEN** 发往模型的身份提示词与编辑区内容逐字一致，不做 trim、大小写转换或其他本地格式化

### Requirement: 密态推理身份提示词状态与作用域

身份注入开关、编辑区展开状态与提示词内容 SHALL 只保存在 GUI 进程内存中，并随推理页状态在应用内页面导航间保留。修改开关或提示词 SHALL 只影响下一次发送，已发出的进行中请求 MUST NOT 被重写、取消或重启。GUI 进程退出后，身份注入 SHALL 恢复为默认开启、默认提示词与编辑区收起。该状态 MUST NOT 写入设置缓存、TNG 配置、`tng-runtime.json` 或其他文件；反向代理 MUST NOT 解析、添加或改写消息 role，也不得为直接进入反代的客户端请求注入身份提示词。

#### Scenario: 修改只影响下一次发送

- **WHEN** 一轮推理请求已经发出且尚未进入终态，用户修改“注入身份”开关或提示词文本
- **THEN** 当前进行中请求保持原样继续执行
- **AND** 新开关状态与提示词内容只影响下一次发送

#### Scenario: 页内状态保留且进程退出重置

- **WHEN** 用户切换离开再返回密态推理页
- **THEN** 开关状态、编辑区展开状态与提示词内容保持不变
- **WHEN** GUI 进程退出后重新启动
- **THEN** 身份注入恢复为默认开启、默认提示词与编辑区收起

#### Scenario: 直接反代请求不受身份注入影响

- **WHEN** 外部客户端不经过密态推理调试页，直接向本机反向代理发送推理请求
- **THEN** 反向代理不为该请求添加或改写任何身份提示词消息
- **AND** 请求按既有规则原样透传 body，并仅按 `body.model` 执行路径注入

### Requirement: 密态推理页面进程内状态保留

系统须（SHALL）在 GUI 进程存续期间，跨应用内页面导航完整保留密态推理页的页面状态与进行中推理状态。保留范围至少须（SHALL）包含：当前选项卡、当前运行模式、共享会话消息、未发送输入草稿、聊天消息与滚动位置、每个 assistant turn 的解密中/流式/完成/失败/停止状态与已到达 reasoning/content、Agent 模式工具调用时间线与多轮进度、失败诊断、发送锁、模型发现状态与清单、选中模型和思考强度。

切换离开密态推理页不得（MUST NOT）重置上述状态、取消正在进行的流式请求、中止 Agent 工具循环或丢弃 `▶解密中` 指示；推理请求、Agent 工具循环与模型发现状态须（SHALL）继续在后台推进。返回密态推理页时须（SHALL）直接呈现当前状态；若离开期间有新输出到达，聊天消息区域须（SHALL）滚动到底部显示最新内容。GUI 进程退出后上述状态须（SHALL）全部丢弃；系统不得（MUST NOT）把推理页状态写入设置缓存、tng 配置或任何文件，重新启动进程后须（SHALL）回到默认状态。

#### Scenario: 应用内切页保留完整状态

- **WHEN** 用户在推理页保留未发送草稿、选择模型与思考强度，且存在正在流式输出或正在执行工具的 assistant turn，随后切换到概览或设置页
- **THEN** 推理页实例仍保活，输入草稿、聊天记录、模型状态、思考强度、运行模式、解密中/流式状态、工具时间线、诊断与发送锁不重置；进行中的流式请求与 Agent 工具循环继续推进

#### Scenario: 返回后展示离开期间的新输出

- **WHEN** 推理页处于后台时收到新的 reasoning/content 增量或工具步骤更新，用户随后返回推理页
- **THEN** assistant 气泡展示最新状态，聊天消息区域滚动到底部，不重启请求、不重复追加 delta，也不因页面切换显示默认空态

#### Scenario: 进程退出后不恢复状态

- **WHEN** GUI 进程退出
- **THEN** 推理页选项卡、运行模式、共享会话、输入草稿、聊天记录、模型清单、选中模型、思考强度和进行中状态全部丢弃；重新启动进程后显示默认状态

#### Scenario: 切页不触发落盘

- **WHEN** 用户离开或返回密态推理页
- **THEN** 系统不为保留推理页状态写入设置缓存、tng 配置或其它文件；仅有既有设置缓存语义继续处理 API Key 与 TNG 配置，且不包含推理页状态

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

系统须（SHALL）在设置页 TNG Gateway 区域展示与概览视图第 1、3、4 张状态卡相同的“运行状态”“远端链路”“远端证明”三张卡。三张卡的状态判定、状态文本、副标题和颜色语义须（SHALL）与概览对应卡完全同源；设置页“远端证明”卡 SHALL 具有与概览相同的图标-only 导出报告动作，且可用性、报告来源与导出结果语义与概览完全一致。设置页绝不（MUST NOT）另行使用独立的就绪判定、展示“控制信道已连接/已断开”摘要，或展示 TNG 版本概要。设置页 Gateway 区域不展示概览第 2 张“入口信息”卡，也不因此新增配置编辑控件。三张状态卡与反代诊断快照是 tngui 进程内的本地物理观察：不表示远端网关、远端授权、远端模型健康、TNG key rotation 或跨实例 key 一致性。

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

设置页“密态推理”功能卡标题区须（SHALL）使用比原有标题区高约 50% 的专门布局，且标题区最小高度不小于 66 逻辑像素；功能图标、标题和副标题在该标题行内保持相对位置并整体垂直居中。该卡内容区的应用字号一般的输入行上下留白须（SHALL）比原有布局约缩短 50%：卡片分隔线到首行输入区上缘、各行之间、以及末行输入区下缘到卡片内容底缘的额外间距均不超过 12 逻辑像素。API Key 与缓存盐配置控件使用默认/普通表单行高，不使用大号输入框。这些调整仅作用于“密态推理”功能卡，绝不（MUST NOT）改变其他卡片、入口编辑行或全局卡片基础布局。

#### Scenario: 标题行加高且垂直居中

- **WHEN** 渲染设置页“密态推理”功能卡
- **THEN** 标题区高度不小于 66 逻辑像素，同时图标、标题和副标题整体垂直居中且相对位置保持稳定

#### Scenario: 内容留白收紧

- **WHEN** 渲染设置页“密态推理”功能卡
- **THEN** 卡内首行上缘、行间与末行下缘的功能卡额外间距均不超过 12 逻辑像素；API Key 与缓存盐配置控件使用默认/普通表单行高

#### Scenario: 布局影响范围受限

- **WHEN** 渲染其他设置页卡片、TNG 配置入口编辑器或客户端信息卡
- **THEN** 这些区域不因“密态推理”功能卡布局调整而改变标题高度、内容留白或输入框尺寸

### Requirement: Ingress 初始化与重置默认远端端口

当 GUI 初始化默认模板或用户切换当前唯一 ingress 的远端类型并重置远端字段时，mapping 形态的远端 `out.port` 须（SHALL）默认填充 `80`，http_proxy 形态的远端 `dst_filters.port` 须（SHALL）默认填充 `443`。该默认值只作用于远端目标端口，绝不（MUST NOT）改变 tngui 反代对外绑定默认端口 `9443` 或 TNG 内部注入端口。导入 JSON、用户显式修改后的端口和已有配置中的显式端口不被该默认值覆盖；http_proxy 域名前缀决定 `ohttp.tls` 的语义保持不变。

#### Scenario: 默认模板使用 mapping 80

- **WHEN** GUI 启动并渲染默认 mapping ingress
- **THEN** 远端 `out.port` 显示并序列化为 `80`

#### Scenario: 切换到 mapping 默认 80

- **WHEN** 用户把当前唯一 ingress 的远端类型切换为 mapping 并重置字段
- **THEN** 远端 `out.port` 默认填充为 `80`

#### Scenario: 切换到 http_proxy 默认 443

- **WHEN** 用户把当前唯一 ingress 的远端类型切换为 http_proxy 并重置字段
- **THEN** 远端 `dst_filters.port` 默认填充为 `443`

#### Scenario: 显式端口不被覆盖

- **WHEN** 用户导入或编辑一条远端端口为其他有效值的 ingress
- **THEN** 该显式端口保持不变；反代对外绑定仍默认使用 `9443`，TNG 内部注入端口逻辑不变

### Requirement: 可编辑文本输入禁用自动改写

对应用中用户可编辑、可输入英文文本的文本框和文本域，系统须（SHALL）通过输入控件属性禁用 WebKit/WebView 的自动首字母大写，并禁用自动更正；英文文本输入须（SHALL）按用户实际键入内容保留大小写。相关控件须（SHALL）携带 `autocapitalize=off` 与 `autocorrect=off`；通常还应禁用拼写检查以免平台辅助行为改写结果。该要求须（SHALL）覆盖设置页 API Key、ingress 远端主机名/域名、verify 字段、密态推理 prompt 以及原始 JSON 编辑器；纯数值控件可按数值输入实现。系统绝不（MUST NOT）在应用层自动将英文首字母改为大写。

#### Scenario: 英文首字母保持小写

- **WHEN** 用户在受支持的英文文本输入控件中输入以小写字母开头的内容
- **THEN** 控件值保持用户输入的小写首字母，应用层不自动改为大写

#### Scenario: 输入控件携带禁改写属性

- **WHEN** 渲染 API Key、远端主机名/域名、verify、prompt 或原始 JSON 等可编辑文本控件
- **THEN** 实际输入元素携带 `autocapitalize="off"` 和 `autocorrect="off"`，且不启用拼写检查

#### Scenario: 不改变校验与序列化

- **WHEN** 用户在禁用自动改写的输入框中配置主机名或 JSON
- **THEN** 配置校验、TLS 前缀派生和 JSON 序列化仍按原语义执行，不因禁用平台输入辅助而改变

### Requirement: 密态推理模型与凭据状态不可跨会话持久化

系统须（SHALL）将密态推理的模型清单、选中模型和 UI 会话内模型发现状态作为仅 GUI 会话内的内存态；它们供发送使用，关闭 GUI 后不保留，也绝不（MUST NOT）写入 tng 配置或设置缓存。设置页的 apiKey 须（SHALL）随应用关闭流程写入设置缓存，并在下次 GUI 启动且缓存有效时恢复；apiKey 绝不（MUST NOT）写入 tng 配置或 `tng-runtime.json`。设置页“密态推理”卡 SHALL 保留 API Key 输入框与本规格定义的缓存盐配置项；该输入框 SHALL 默认以密码式遮盖渲染，并提供明确的显隐切换按钮。用户未显式切换前绝不（MUST NOT）明文展示；切换后 SHALL 显示真实值。该卡不得提供复制本地 URL、保存并验证、配置导入/导出、清除本机凭据或其他与凭据无关的额外管理说明；缓存盐配置项按“设置页密态推理卡的盐配置控件”呈现，不属此类说明。

#### Scenario: 不入 tng-runtime.json

- **WHEN** 离开设置页触发 TNG 配置自动保存
- **THEN** 写盘的 `tng-runtime.json` 不含 model、模型清单或 apiKey 字段

#### Scenario: apiKey 跨会话恢复

- **WHEN** 用户填写 apiKey 后通过正常关闭流程退出 GUI AND 重新打开 GUI AND 设置缓存有效
- **THEN** “设置”视图的 apiKey 恢复为关闭前值

#### Scenario: 模型状态不持久化

- **WHEN** 用户选择模型后关闭并重新打开 GUI，或设置缓存中 apiKey 类型非法
- **THEN** “密态推理”视图的模型清单与选中模型不从前次会话恢复；非法 apiKey 恢复为空；有效 apiKey 按设置缓存规则恢复后仍需重新获取并选择模型

#### Scenario: 设置页 API Key 为普通文本框

- **WHEN** 渲染设置页“密态推理”卡
- **THEN** 出现一个默认遮盖的 API Key 输入框和其显隐切换按钮，以及缓存盐配置项；未切换时界面不显示 API Key 明文，切换后显示真实值；界面不出现保存并验证、复制本地 URL、配置导入/导出、清除本机凭据或其他与凭据无关的额外凭据管理说明

#### Scenario: 推理页只可选择服务端模型且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以只读选项下拉菜单呈现于请求面板；apiKey 不在“密态推理”视图 UI 上展示，发送时仅作为 Authorization 头使用

#### Scenario: 模型清单与 apiKey 变动不影响 tng 进程

- **WHEN** 用户在“密态推理”视图选择模型，或修改“设置”视图的 apiKey
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

系统须（SHALL）对当前唯一 ingress 强制启用 seg1 的 OHTTP 加密与 tngui 本地 path-model 反代注入约定：`ohttp.path_rewrites` 固定为
`[{ "match_regex": "^/models/([^/]+)(?:/.*)?$", "substitution": "/models/$1" }]`；`ohttp.header_passthrough.request_headers` 固定为 `["authorization","x-api-key"]`。系统绝不（MUST NOT）将 `x-model` 写入透传白名单，也绝不（MUST NOT）向用户提供关闭 `ohttp`、编辑 `path_rewrites` 或编辑请求头白名单的控件。导入/回填中出现的 ingress `ohttp` 字段一律被丢弃，并由锁定值取代。

#### Scenario: ohttp 常开且 header_passthrough 写死
- **WHEN** 用户编辑或默认加载当前唯一 ingress 并触发序列化
- **THEN** 序列化结果中该 ingress 的 `ohttp.header_passthrough.request_headers` 恰为 `["authorization","x-api-key"]`

#### Scenario: ohttp path_rewrites 写死
- **WHEN** 用户编辑或默认加载当前唯一 ingress 并触发序列化
- **THEN** 序列化结果中该 ingress 的 `ohttp.path_rewrites` 恰为上述一条规则

#### Scenario: 用户无法关闭或改写 ohttp
- **WHEN** 渲染 ingress 的结构化控件
- **THEN** 不出现关闭 `ohttp`、编辑 `path_rewrites` 或编辑 `header_passthrough.request_headers` 的控件；导入/回填中自定义的 ingress `ohttp` 被丢弃并替换为锁定值

#### Scenario: 远端构建的 outer path 具备模型语义
- **WHEN** pre-TNG proxy 已改写内部请求为 `/models/{model-segment}{original-path}`
- **THEN** TNG ingress 生成的 OHTTP outer path 为 `/models/{model-segment}`，credential 请求头进入 outer 请求；未匹配 path rewrite 的请求不得自动获得模型语义

### Requirement: ingress 本地监听强制走回环

系统须（SHALL）将当前唯一 ingress 的本地监听 `host` 强制为 `127.0.0.1`、`port` 由 tngui 自动选取并注入——处理 `mapping` 的 `in`、`http_proxy` 的 `proxy_listen`：tngui 在拉起 tng 前以批探测选取空闲回环端口并先验避让对外端口（见"注入端口批探测并避让对外端口"；与"控制面 host 强制走回环地址""管控端口自动选取"同向）注入为该 ingress 本地监听 `port`、host 强制 `127.0.0.1`，覆盖用户任何 host/port 输入。ingress 本地监听 `host`/`port` 不出现在用户配置、结构化控件与原始 JSON 视图（与 `control_interface.restful` 同向向用户隐藏）；外部客户端不直连该 ingress 本地监听端口，而经 tngui 反向代理对外入口（见"tngui 反向代理作为 pre-TNG path 注入代理"）。用户在 ingress 编辑器行 1 所配的"本机端口 + 对外绑定 host"是 tngui 反代对外绑定，非 tng ingress 本地监听。

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

- **WHEN** 渲染密态推理安全说明页中"建立加密通道"步骤的说明文案
- **THEN** 文案表述为以 OHTTP 加密并绑定网关证明后再发送，不出现"RATS-TLS 会话绑定"

### Requirement: 密态推理响应气泡状态颜色

系统须（SHALL）用轻量、低饱和且协调的气泡颜色呈现对话状态：用户输入气泡，以及处于 `▶解密中`、Agent 工具循环、流式输出和完整完成状态的 assistant 气泡，均须（SHALL）使用同一淡绿色；用户主动停止的 assistant 气泡须（SHALL）为淡金色；异常中断或失败的 assistant 气泡须（SHALL）为淡红色。进行中的 assistant 气泡不得（MUST NOT）提前呈现淡金或淡红色；状态标签仍须（SHALL）区分解密中、生成中和完整完成。气泡文字须（SHALL）保持高对比深色。

#### Scenario: 正常对话使用淡绿色气泡

- **WHEN** 用户发送输入，assistant 后续处于 `▶解密中`、Agent 工具循环、流式输出或收到 `data: [DONE]` 后的完整完成状态
- **THEN** 右侧用户气泡与该左侧 assistant 气泡始终呈现同一淡绿色风格；状态标签区分“解密中”“生成中”与完成，但气泡底色不切换

#### Scenario: 主动停止使用淡金色气泡

- **WHEN** 用户点击停止且 assistant 气泡进入 stopped 终态
- **THEN** 该 assistant 气泡呈现淡金色风格，状态标识使用警示/停止语义，并显示“已停止⚪响应不完整”

#### Scenario: 异常中断使用淡红色气泡

- **WHEN** assistant 响应因连接失败、非 2xx、SSE 解析失败或 `[DONE]` 前断流进入 failed 终态
- **THEN** 该 assistant 气泡呈现淡红色风格，状态标识使用错误/失败语义，已到达内容按失败契约保留显示

#### Scenario: 进行中气泡使用正常淡绿色

- **WHEN** assistant 处于 `▶解密中`、Agent 工具循环或仍在流式输出
- **THEN** 气泡使用与用户输入和完整响应相同的淡绿色，不提前变为淡金色或淡红色

### Requirement: 映射远端出口须合法 IPv4 否则拒绝启动

系统须（SHALL）在拉起 tng 前校验当前唯一 `mapping` ingress 的远端 `out.host`：经首尾空格 trim 后须为合法 IPv4 地址（恰好 4 段、每段 0-255、拒绝前导零——与该字段在 tng 侧 `Option<Ipv4Addr>` 的解析一致）。当前唯一 `mapping` ingress 的 `out.host` 缺失、为空串/全空白、或非合法 IPv4 时，系统绝不（MUST NOT）写盘 `tng-runtime.json`、绝不（MUST NOT）拉起 tng，并须（SHALL）以明确错误拒绝该次启动。`http_proxy` 形态不因 `dst_filters.domain` 为空被拒（tng 仍加载该形态，空 domain 仅匹配不到远端）；`mapping` 的 `rules` 为空数组时不被拒（不携带生效规则不构成远端缺失）。

#### Scenario: 默认占位与空串/空白被拒

- **WHEN** 用户以默认模板、或以 `out.host` 为空/全空白的 `mapping` ingress 触发启动
- **THEN** 系统不写盘、不拉起 tng，并以明确错误拒绝（提示须填写远端网关 IPv4 地址）

#### Scenario: 非合法 IPv4 被拒

- **WHEN** 当前唯一 `mapping` ingress 的 `out.host` 为域名、非 4 段、含超界段、或含前导零（如 `010.0.0.1`）
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

系统须（SHALL）在 tng 运行期间由 tngui 自身运行常驻 HTTP 反向代理作为推理对外入口。反代随 tng 启动/停止而启/停，并把推理请求转发到 tng 内部 ingress 本地监听，按本规格记录的 client-side pre-TNG path 注入行为执行模型 path 注入；tngui 不另设模型注册或授权语义，tngui 不定义、不判定、不重写远端授权或路由，实际行为由 TNG / 下游服务侧决定；响应回传给客户端。系统绝不（MUST NOT）把 tng ingress 本地监听端口直接暴露给外部客户端，也绝不（MUST NOT）链接任何 tng crate。

tngui 反代当前支持的模型 path 注入端点为 `POST /v1/chat/completions`、`POST /v1/messages` 与 `POST /v1/responses` 三类。对这三类端点，反代须（SHALL）将 body 按 UTF-8 JSON object 解析，读取顶层字符串 `model`，把该确切字符串做单一路径 segment percent-encoding，并把 path 改写为 `/models/{encoded-model-segment}{original-path}`。反代不得对 `body.model` 执行 trim、大小写转换或其他本地格式化。除“反代向推理端点注入 cache_salt”定义的顶层 `cache_salt` 注入外，请求 body 字节、query、method 以及 `Authorization`、`x-api-key`、`Content-Type` 须保留；加盐只新增该字段，不改动 body 其余字节、字段顺序、空白与转义。三者在 tngui 边界内都按无状态、自包含请求处理——反代不引入本地会话或后台任务，多轮上下文由调用方在请求体中完整携带。反代须（SHALL）在 `model` 缺失、不是字符串、为空字符串、或 body 不是合法 UTF-8 JSON object 时返回 400；超过 10 MiB 返回 413；以上失败均不得转发 TNG。

对精确的 `GET /v1/models`，反代须（SHALL）作为模型发现例外直接发往按当前 ingress 结构派生的 capi origin——`mapping` 形态从首条规则远端 host:port 派生 HTTP origin，`http_proxy` 形态按 `ohttp.tls` 与 `dst_filters[0].domain[:port]` 派生 HTTP/HTTPS origin——不建立到 tng 内部 ingress 本地监听的连接，也不走 OHTTP/path-model 链路。该直连分支是 tngui 的本地模型发现例外，不是模型授权链路：反代须（SHALL）保留原始 `/v1/models` path 与 query，不做模型 path 注入，不生成、读取或使用 `x-model`，并把 capi 响应返回给客户端。该直连分支的本地请求头规则是确定的：本地剔除 hop-by-hop 头、`host`、`content-length` 与 `x-model`；若请求中已有 `Authorization` 或 `x-api-key`，按原样透传到 capi origin。tngui 不新增业务凭证，不校验业务凭证语义，也不剥离业务凭证；透传凭证头不表示 tngui 参与授权，剥离或校验授权凭证由服务端授权边界处理，不属 tngui 职责。tngui 不把凭证头用于模型授权。发现请求不属于模型授权链路；tngui 不得据此声明远端模型健康、可用性或授权能力。若无法从当前 ingress 得出有效 capi origin，或 capi 连接失败，反代须（SHALL）返回明确的模型发现失败响应，绝不（MUST NOT）静默改经 tng 转发。

反代绝不（MUST NOT）将 `x-model` 用作模型身份；客户端携带的 `x-model` 不得影响 path 注入结果。非模型推理端点的请求不产生模型语义，可按通用反代规则转发。

#### Scenario: 反代随 tng 生命周期启停

- **WHEN** 用户启动或停止 tng
- **THEN** tngui 反向代理随 tng 生命周期启停；未启动时不监听

#### Scenario: OpenAI 请求注入模型路径

- **WHEN** 客户端 `POST /v1/chat/completions` 携带 JSON body `{"model":" model-a "}` 和 `Authorization`
- **THEN** 反代保留 body 中完整原样模型字符串，并把内部请求路径改写为 `/models/%20model-a%20/v1/chat/completions`；path 身份与原 `body.model` 字符串保持一致

#### Scenario: Anthropic 请求注入模型路径

- **WHEN** 客户端 `POST /v1/messages` 携带 JSON body `{"model":"provider/model"}` 和 `x-api-key`
- **THEN** 反代把内部请求路径改写为 `/models/provider%2Fmodel/v1/messages`，并保留 `x-api-key`；body 在原字节基础上仅按缓存盐配置新增顶层 `cache_salt`，未加盐时保持原字节

#### Scenario: 请求 path 与 query 保持可恢复

- **WHEN** 客户端请求 `/v1/chat/completions?trace=1` 且 `body.model` 有效
- **THEN** 反代转发 `/models/{encoded-model-segment}/v1/chat/completions?trace=1`

#### Scenario: 客户端伪造 x-model 不影响身份

- **WHEN** 客户端请求 body.model 解析为 `model-a` 且请求头携带 `x-model: model-b`
- **THEN** 反代不使用或覆盖 `x-model`，最终 pre-TNG path 表示 `model-a`

#### Scenario: responses 请求注入模型路径

- **WHEN** 客户端 `POST /v1/responses?trace=1` 携带 JSON body `{"model":"model-a","input":"…"}`
- **THEN** 反代把内部请求路径改写为 `/models/model-a/v1/responses?trace=1`，并保留 `Authorization` / `x-api-key`、`Content-Type`；body 在原字节基础上仅按缓存盐配置新增顶层 `cache_salt`，未加盐时保持原字节

#### Scenario: responses 寻址接口不改写

- **WHEN** 客户端 `GET /v1/responses/resp-123`、`POST /v1/responses/resp-123/cancel` 或其他 path 前缀不精确匹配 `POST /v1/responses` 的请求
- **THEN** pre-TNG path 注入逻辑不产生模型前缀，请求按通用反代规则透传给 tng 内部 ingress

#### Scenario: 非法 model 阻断在 pre-TNG proxy

- **WHEN** 支持端点的 body 缺失 `model`、`model` 不是字符串、`model` 为空字符串，或不是 JSON object
- **THEN** 反代返回 HTTP 400，不建立 TNG 请求

#### Scenario: 超大请求返回 413

- **WHEN** 支持端点的请求体超过 10 MiB 声明上限
- **THEN** 反代返回 HTTP 413，不建立 TNG 请求

#### Scenario: 模型发现直接发往 capi

- **WHEN** 客户端向 tngui 反代请求 `GET /v1/models`
- **THEN** 反代使用当前生效 ingress 的 capi origin 发起模型发现请求，不连接 tng 内部 ingress 本地监听，并把 capi 响应返回给客户端

#### Scenario: 模型发现直连分支按原样透传业务凭证头

- **WHEN** 客户端向 tngui 反代请求 `GET /v1/models?trace=1` 并携带 `Authorization` 或 `x-api-key`
- **THEN** 反代保留 `/v1/models?trace=1` path 与 query；本地剔除 hop-by-hop 头、`host`、`content-length` 与 `x-model`，已有的 `Authorization`、`x-api-key` 按原样透传到 capi origin。tngui 不新增业务凭证，不校验业务凭证语义，也不剥离业务凭证

#### Scenario: 模型发现不构成授权判定

- **WHEN** 精确 `GET /v1/models` 直连请求成功
- **THEN** tngui 把该结果仅用作本地模型清单展示边界，不据此判定远端授权、远端模型健康、TNG key rotation 或跨实例 key 一致性

#### Scenario: 模型发现失败不伪装成空列表

- **WHEN** 当前 ingress 无法得出有效 capi origin，或 direct capi 模型发现请求连接失败
- **THEN** pre-TNG proxy 返回明确的失败响应，不建立 TNG 推理请求，也不构造空模型清单响应

#### Scenario: 非模型 path 不改写

- **WHEN** 客户端请求的 path 不是 `POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/responses` 或精确 `GET /v1/models`
- **THEN** pre-TNG path 注入逻辑不产生模型前缀，direct 模型发现分支不启用

#### Scenario: 对外绑定 host 可切换

- **WHEN** 用户在 ingress 编辑器行 1 以 toggle 切换反代对外绑定 host 并启动 tng
- **THEN** 反代绑定在所选 host + 配置的对外 port；默认为 `127.0.0.1`

#### Scenario: 不直连 tng ingress 端口

- **WHEN** 外部客户端请求推理入口
- **THEN** 客户端连接的是 tngui 反代对外端点，而非 tng 的内部 ingress 本地监听端口

### Requirement: 反代本地诊断快照与 UI 状态

系统须（SHALL）在 tngui 进程内存中为当前 per-TNG 反代维护只读诊断快照，并在“密态推理”视图展示互斥的反代状态：反代未启动时显示“未运行”；反代监听器存在时显示“运行”；上游或本地处理出现失败计数大于零时同时显示“有失败”。快照须（SHALL）至少包含固定类别计数：身份通过、身份拒绝、请求过大、模型发现成功、模型发现失败和上游失败。反代随 tng 会话重启时，诊断快照须（SHALL）重置；系统不得（MUST NOT）把该快照持久化，不得（MUST NOT）把快照发送给外部 collector。

快照的类别与 UI 标签须（SHALL）为固定诊断类别，不得（MUST NOT）携带 prompt、模型输出、raw API key、raw attestation token、模型名或其他业务载荷作为诊断标签。现有模型发现状态不得因诊断快照缺失而变成“空模型清单”；这些计数是本地物理观察，不得（MUST NOT）被 UI 或文档表达为模型授权结果、远端模型健康、TNG key rotation 或跨实例 key 一致性。

#### Scenario: 未启动显示保守状态

- **WHEN** 反代尚未启动
- **THEN** 反代诊断状态显示“未运行”，所有固定类别计数为零或空值，且该状态不声明模型授权或远端健康

#### Scenario: 身份通过累计计数

- **WHEN** `POST /v1/chat/completions`、`POST /v1/messages` 或 `POST /v1/responses` 成功解析出顶层 `body.model` 并注入 path
- **THEN** 反代增加“身份通过”计数，但不把模型字符串加入诊断标签或 UI 文案

#### Scenario: 身份失败闭合计数

- **WHEN** 支持端点因 `model` 缺失、不是字符串、为空字符串或非 UTF-8 JSON object 返回 400
- **THEN** 反代增加“身份拒绝”计数，不建立 TNG 请求，也不泄露具体模型内容

#### Scenario: 超大请求不进入身份用途

- **WHEN** 支持的模型推理端点请求体超过 10 MiB 并返回 413
- **THEN** 系统增加“请求过大”计数，不增加“身份拒绝”，不转发 TNG，也不使用 body 内容作为诊断标签

#### Scenario: 模型发现分类计数

- **WHEN** 精确 `GET /v1/models` 直达 capi origin 成功或失败
- **THEN** 反代分别固定增加“模型发现成功”或“模型发现失败”计数；失败状态保持明确的模型发现失败语义，不伪装成空模型清单；发现成功也不代表远端模型健康或授权能力

#### Scenario: 展示只读本地诊断

- **WHEN** 用户查看密态推理视图
- **THEN** UI 展示当前反代状态和只读固定类别计数，且不提供把快照导入外部 collector 的操作

#### Scenario: 重启反代重置快照

- **WHEN** tng 与 tngui 反代一起重启
- **THEN** 新反代会话的本地诊断计数从零开始，旧计数不出现在新 UI 快照中

### Requirement: 注入端口批探测并避让对外端口

tngui 须（SHALL）以批探测为拉起 tng 注入的全部回环端口——`control_interface.restful` 的管控端口与当前唯一 ingress 的内部本地监听端口——一次性取齐：在同一回环面上**顺序 `bind` `127.0.0.1:0` 共 n 个 listener 并同时持住**（n = 2：1 个管控端口 + 1 个唯一 ingress 内部端口），收集各自分配的端口后**整批统一释放**。因 n 个 listener 同时持在，系统绝不（MUST NOT）出现两个注入端口取到同一端口号。系统须（SHALL）将当前唯一 ingress 的反代对外端口（用户"本机端口"，见"tngui 反向代理作为 pre-TNG path 注入代理"）列为禁止集合：注入的管控端口与唯一 ingress 内部端口绝不（MUST NOT）等于该对外端口。若某次批探测结果命中禁止集合，系统须（SHALL）整批丢弃并重试批探测（有界重试，避免死循环），直到全部不命中为止；重试耗尽则启动失败并明示。

#### Scenario: 批取端口互不相同

- **WHEN** 一次启动取齐 1 个管控端口 + 唯一 ingress 的内部端口
- **THEN** 这些注入端口互不相同（取号时 n 个 listener 同时持住，无可重复）

#### Scenario: 注入端口避让对外端口

- **WHEN** 批探测取到的某端口等于当前唯一 ingress 的反代对外端口（如默认 `9443`）
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

系统须（SHALL）在正常应用关闭流程中，于关闭完成前将设置页的已提交状态 flush 到本机应用数据目录内独立的设置缓存文件。缓存内容限定为当前结构化配置模型序列化出的用户侧 TNG 配置、设置页 apiKey 与本规格定义的缓存盐配置（盐模式、定时刷新参数、定量刷新参数）；系统绝不（MUST NOT）缓存未点"应用回填表单"的原始 JSON 草稿、`model`、`control_interface.restful` 注入端口、tng 内部监听端口或其他推理 prompt。系统不得（MUST NOT）把该独立缓存文件用作 `tng-runtime.json`，也不得将 tng 内部注入值写入该缓存。

GUI 启动时系统须（SHALL）在渲染设置状态前读取该缓存，并仅恢复通过设置缓存校验的字段：TNG 配置须能按用户侧配置语义回填，且用户可编辑端口保持有效；apiKey 须为字符串；缓存盐配置须为受支持模式且刷新参数为有效正整数，缺失或非法时回落默认值。若校验失败、缓存缺失、schema 不支持、文件损坏或字段不合法，对应字段使用默认模板或空值，GUI 不得（MUST NOT）因此无法启动。恢复缓存只初始化设置状态，绝不（MUST NOT）自动启动 tng、自动重启 tng 或改写控制端口。

#### Scenario: 关闭前 flush 已提交设置

- **WHEN** 用户编辑结构化设置或 API Key 后通过正常关闭流程退出应用
- **THEN** 系统在应用关闭完成前把当前 TNG 配置模型序列化结果、apiKey 与缓存盐配置写入独立设置缓存文件

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

系统须（SHALL）在“设置”视图的 TNG 配置区域中，为远程证明提供标题为“远程证明服务配置”的配置块；当唯一 ingress 开启远程证明时，该配置块展示在 TNG 配置内容下方，并承载一个可编辑的地址输入。该输入的用户可见名称须（SHALL）为“参考值服务地址”，且系统不得（MUST NOT）在其下方显示关于 `RATS_TEE_VERIFIER_URL` 环境变量、设置缓存或 TNG 配置 JSON 的说明文案。首次启动、设置缓存缺失/损坏、schema 不支持或校验失败时，该地址必须预填为 `https://rvs.cloud.misuan.com`；存在有效设置时，系统必须直接恢复用户填写值，不得覆盖为默认地址。该值必须被视为 TNG 配置状态的一部分，并随设置缓存跨会话保存。
当远程证明开启并启动或重启 tng 进程时，系统必须把界面中当前提交的 RVS 地址放入 tng 子进程环境变量 `RATS_TEE_VERIFIER_URL`，且该值必须与界面中当前显示/提交的值完全一致；若用户在 tng 运行期间修改该地址，保存/离开设置时须按现有 TNG 配置修改语义触发重启，使新值生效。
为了保持 TNG 严格 JSON 解析兼容，该值不得作为未知字段写入 `tng-runtime.json`；GUI 须（SHALL）在生成 TNG 对外配置时忽略/剥离该字段，只把该字段作为 GUI 侧配置状态并在进程启动时注入为环境变量。

#### Scenario: 参考值服务地址标签与说明

- **WHEN** 当前唯一 ingress 开启远程证明，且用户进入“设置”视图
- **THEN** 地址输入的用户可见标签为“参考值服务地址”
- **AND** 界面不展示关于 `RATS_TEE_VERIFIER_URL`、设置缓存或 TNG 配置 JSON 的说明文案

#### Scenario: RA 开启时显示远程证明服务配置

- **WHEN** 当前唯一 ingress 开启远程证明，且用户进入“设置”视图
- **THEN** TNG 配置内容下方展示标题“远程证明服务配置”
- **AND** 地址输入的用户可见标签为“参考值服务地址”
- **AND** 界面不展示关于 `RATS_TEE_VERIFIER_URL`、设置缓存或 TNG 配置 JSON 的说明文案

#### Scenario: 首次启动预填默认 RVS 地址

- **WHEN** 应用首次启动或设置缓存缺失/无效，且有任何 ingress 开启远程证明
- **THEN** “远程证明服务配置”中的参考值服务地址预填为 `https://rvs.cloud.misuan.com`

#### Scenario: 有效缓存优先恢复用户填写值

- **WHEN** 设置缓存有效且其中保存了用户修改后的参考值服务地址
- **THEN** 应用启动后“远程证明服务配置”恢复该缓存值，不会被 `https://rvs.cloud.misuan.com` 覆盖

#### Scenario: RVS 地址变化触发重启

- **WHEN** 用户修改参考值服务地址并保存/离开设置视图，且 tng 正在运行
- **THEN** 系统按现有 TNG 配置修改语义保存配置并重启 tng，使新地址生效

#### Scenario: 启动进程使用的地址与界面一致

- **WHEN** 用户在“远程证明服务配置”中填写或恢复某个参考值服务地址，并触发 tng 启动或重启
- **THEN** tng 子进程环境变量 `RATS_TEE_VERIFIER_URL` 的值与界面当前提交的值完全一致

#### Scenario: 不破坏 TNG runtime JSON

- **WHEN** 系统创建传给 tng 的配置文件
- **THEN** 该配置文件不包含 GUI 侧 RVS 地址字段，TNG JSON 结构与现有 `deny_unknown_fields` schema 保持兼容

#### Scenario: 关闭远程证明时不展示配置块

- **WHEN** 当前唯一 ingress 关闭远程证明
- **THEN** “设置”视图不展示“远程证明服务配置”作为当前生效的配置块，同时已保存的参考值服务地址值仍可留在设置缓存中供后续 RA 开启时恢复

### Requirement: 单一 ingress 与默认远端配置

系统须（SHALL）只允许配置一条 ingress。设置页不得（MUST NOT）展示 `add_ingress` 层级或多 ingress 列表，也不得（MUST NOT）提供新增 ingress 操作。导入 JSON、应用原始 JSON 回填或恢复设置缓存时，系统须（SHALL）仅保留第一条 ingress；若不存在可识别的 `mapping` / `http_proxy` 条目，系统须（SHALL）回退到默认单 ingress 配置。序列化结果仍须（SHALL）使用 TNG 兼容的 `add_ingress` 数组，且仅含一个元素。默认远端类型须（SHALL）为“域名代理”，默认域名为 `https://inference.cloud.misuan.com`，默认远端端口为 `443`。参考值服务地址默认值须（SHALL）为 `https://rvs.cloud.misuan.com`，且仅在缺少导入值、回填值或有效缓存值时使用，不得（MUST NOT）覆盖用户显式配置。

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
- **THEN** RVS 地址使用该显式值，不使用默认 `https://rvs.cloud.misuan.com`

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

### Requirement: 域名与模型身份文本语义

系统须（SHALL）对 ingress `http_proxy` 形态的域名 / 主机名输入框的字符串值执行首尾 trim。trim 须（SHALL）在值进入对应前端状态、配置序列化或接入示例前完成，且仅删除前导与尾部空白字符；系统不得（MUST NOT）删除字符串内部字符、改变大小写或做其它格式化。系统不得（MUST NOT）把该 trim 行为扩展到 prompt textarea、API Key、RVS 地址或端口输入控件。

导入 JSON、原始 JSON 回填或设置缓存恢复得到的 `dst_filters.domain` 值也须（SHALL）按同一规则扣除首尾空白，避免隐藏空白状态。

`/v1/models` 返回的模型 ID 须（SHALL）原样作为显示、请求、cURL 示例与 Model ID 预览中的模型身份。系统不得（MUST NOT）对服务端模型 ID 应用 trim、大小写转换或其他本地格式化；模型清单中的空白/纯空白 ID 不得成为可选项。

#### Scenario: 域名输入去除首尾空白

- **WHEN** 用户在 `http_proxy` ingress 的域名输入框输入或粘贴包含首尾空白的值
- **THEN** 文本框提交到配置模型与序列化结果的域名不含首尾空白；字符串内部字符保持原样，`https://` 前缀仍按现有规则剥离并派生 `ohttp.tls: true`

#### Scenario: 导入或恢复的域名规范化

- **WHEN** 导入 JSON、应用原始 JSON 回填或恢复设置缓存时，某条 `http_proxy` ingress 的 `dst_filters.domain` 带有首尾空白
- **THEN** 结构化域名输入框和下一次用户侧序列化结果不保留这些空白

#### Scenario: 服务端模型 ID 原样保留

- **WHEN** `/v1/models` 返回模型 ID 后
- **THEN** 界面显示、推理请求、cURL 示例与 Model ID 预览使用与服务端返回一致的模型 ID；系统不对其执行首尾 trim、大小写改变或其它格式化

#### Scenario: Prompt 不被该规则处理

- **WHEN** 用户在 prompt textarea 中输入首尾空白
- **THEN** prompt 内容保持原样，不套用域名输入框的 trim 行为

### Requirement: 密态推理页提供 Hermes Agent 客户端接入导引

系统须（SHALL）在“密态推理”视图的“AI 客户端接入”选项卡中提供 Hermes Agent 接入导引。该导引须（SHALL）包含：

- Hermes Agent 标题与简要介绍，说明其为 Nous Research 开发的开源自主 AI Agent，并概括其持久记忆、技能自学习、工具调用和多种对话平台能力。
- 指向 Hermes Agent 官方主页 `https://hermes-agent.nousresearch.com/` 的可访问链接。
- 配置 Hermes Agent custom endpoint 的操作步骤：执行 `hermes model`、选择 `Custom endpoint`、填写 tngui 反代 API Base URL、填写 API Key 和服务端返回的 Model ID。
- 与当前 tngui 反代端点一致的 Hermes 配置示例。
- Hermes Agent 配置截图。
- 继续强调客户端必须使用本地 TNG 地址，不得填写云端服务地址。

系统不得（MUST NOT）在该选项卡中展示 DeepSeek Client 标题、DeepSeek Client 接入步骤或 DeepSeek Client 配置示例。

#### Scenario: 打开 AI 客户端接入选项卡

- **WHEN** 用户进入“密态推理”视图并打开“AI 客户端接入”选项卡
- **THEN** 界面显示 Hermes Agent 介绍、指向 `https://hermes-agent.nousresearch.com/` 的官方主页链接、Hermes custom endpoint 接入步骤、动态配置示例和配置截图

#### Scenario: 使用本地端点和已发现模型生成配置示例

- **WHEN** tngui 反代端点已可用且当前模型清单包含用户选中的模型
- **THEN** Hermes 配置示例使用该反代端点作为 `base_url`、使用 `provider: custom`、使用 API Key 占位说明，并把服务端返回的模型 ID 原样用作模型值
- **WHEN** 反代端点不可用或模型未成功发现
- **THEN** 配置示例在对应字段显示明确的未配置或未发现状态，不伪造可用端点或模型 ID

#### Scenario: 移除 DeepSeek Client 导引

- **WHEN** 渲染“AI 客户端接入”选项卡
- **THEN** 页面不出现 DeepSeek Client 标题、DeepSeek 接入步骤或 DeepSeek 配置示例

#### Scenario: 保持本地接入安全提示

- **WHEN** 用户查看 Hermes Agent 接入导引
- **THEN** 页面保留使用本地 TNG 地址的提示，并明确不得填写云端服务地址

### Requirement: 新对话分隔提示

系统须（SHALL）在每次成功会话重置后在当前消息流末尾显示一条低对比度分隔线，并在分隔线上居中显示“新对话”提示。历史消息须（SHALL）保留在分隔线上方，新的 user / assistant 消息须（SHALL）在该分隔线下方继续按时间顺序渲染。分隔提示是 UI 专用标记，系统不得（MUST NOT）把它渲染为普通聊天消息、发送给模型或计入后续请求上下文。触发重置的控件是顶部工具条的 `新会话` 按钮（见"密态推理新会话与模式切换控件"）；`对话模式` 与 `Agent 模式` 共用同一分隔线语义。

#### Scenario: 重置后立即显示分隔提示

- **WHEN** 用户点击可交互的 `新会话` 按钮
- **THEN** 既有聊天消息继续显示，消息流末尾展示低对比度分隔线，分隔线上居中显示“新对话”提示

#### Scenario: 新消息渲染在分隔线下方

- **WHEN** 用户点击 `新会话` 后发送新消息
- **THEN** 新 user / assistant 消息按正常聊天气泡渲染在最新分隔线提示下方；模型请求上下文（共享会话）只包含该分隔线之后的有效轮次

#### Scenario: 间隔新对话后可多次插入

- **WHEN** 用户先点击 `新会话`、在分隔线后完成或停止新一轮对话，然后再次点击可交互的 `新会话`
- **THEN** 每次 `新会话` 都在当时消息流末尾新增一条分隔线；早期分隔线和历史消息继续保留

### Requirement: 反代向推理端点注入 cache_salt

tngui 反代须（SHALL）对 `POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/responses` 三类端点，在按 `body.model` 解析出有效模型身份之后、把请求转发给 tng 内部 ingress 之前，按盐模式处理请求体顶层的 `cache_salt`：添加模式只在该字段缺失时写入当前盐，覆盖模式无论是否已有该字段都写入当前盐，忽略模式不读也不写。盐处理只作用于请求体，不改动 `body.model` 的 path 注入结果，也不改动非法/缺失 `model` 的 fail-closed 判定、10 MiB 上限与非推理端点的透传。

#### Scenario: 三类端点默认注入顶层 cache_salt

- **WHEN** 客户端向 `POST /v1/chat/completions`、`POST /v1/messages` 或 `POST /v1/responses` 发送带有效 `model` 的 JSON object，且盐模式为添加或覆盖
- **THEN** 反代转发到内部 ingress 的请求体顶层含当前盐，且 `body.model` 的 path 注入结果与既有行为一致

#### Scenario: 注入发生在转发与加密之前

- **WHEN** 反代把请求转发给 tng 内部 ingress
- **THEN** 内部请求体在离开反代前已含 `cache_salt`，该值随 tng 链路加密后传输

#### Scenario: 非推理端点与模型发现不注入

- **WHEN** 客户端请求三类推理端点之外的其他 path，或精确 `GET /v1/models`
- **THEN** 反代不向请求体写入 `cache_salt`

### Requirement: 盐不进入请求头、日志与诊断快照

`cache_salt` 须（SHALL）只存在于请求体顶层。反代绝不（MUST NOT）把盐写入请求头、outer metadata、进程日志、错误详情或反代诊断快照 `ProxyDiagnosticsSnapshot`；快照继续只含固定类别计数，不因加盐新增承载盐值或动态标签的字段。

#### Scenario: 请求头集合不因加盐改变

- **WHEN** 反代对同一请求加盐并转发
- **THEN** 转发请求的头集合与未加盐时一致，不含 `cache_salt`

#### Scenario: 诊断快照不含盐

- **WHEN** 反代已注入盐并处理请求
- **THEN** `ProxyDiagnosticsSnapshot` 仍只有固定类别计数，不含盐值或与盐相关的动态标签

### Requirement: 请求体改写最小侵入

加盐改写须（SHALL）只做最小侵入：添加模式或请求体缺少顶层 `cache_salt` 时，在顶层 JSON object 首个 `{` 之后插入一个成员；覆盖模式且请求体已有该字段时，就地替换该成员的字符串值。反代绝不（MUST NOT）对 body 做全量重序列化，也不得改动 `model`、`messages` 等既有内容的字节表示。

#### Scenario: 其余字节与字段顺序保留

- **WHEN** 反代对带有效 `model` 的请求体注入 `cache_salt`
- **THEN** 除顶层 `cache_salt` 成员的新增或就地替换外，请求体其余字节与字段顺序与原始体一致

#### Scenario: 既有失败路径与 path 注入不受影响

- **WHEN** 请求体非法、`model` 缺失/非字符串/为空，或请求超过 10 MiB
- **THEN** 反代保持既有 400 / 413 判定与 path 注入结果，加盐逻辑不改变这些结果

### Requirement: 盐配置持久化且即时生效

盐配置须（SHALL）随设置缓存持久化在设置缓存 `tng` 段下的独立字段中，字段缺失或非法时回落默认值，缓存 `schemaVersion` 保持不变。持久化内容只含盐模式、定时刷新参数与定量刷新参数；当前实际使用的盐值绝不（MUST NOT）落盘，也不随会话恢复。改动须（SHALL）即时作用于当前运行的反代，不触发 TNG 配置 dirty、不写 `tng-runtime.json`、不重启 tng。

#### Scenario: 盐配置随设置缓存恢复

- **WHEN** 用户设置盐模式与定时/定量刷新参数后正常关闭并重开 GUI，且设置缓存有效
- **THEN** 盐模式与刷新参数恢复为关闭前值；缺失或非法时使用默认值，且不影响 API Key 与 TNG 配置的恢复

#### Scenario: 改动即时生效且不重启 tng

- **WHEN** 用户在设置页修改盐配置
- **THEN** 之后经反代转发的请求立即使用新配置，且不触发 TNG 配置 dirty 或 tng 进程重启

#### Scenario: 自动盐不落盘

- **WHEN** 反代已在使用某个随机盐
- **THEN** 当前盐值不写入设置缓存或任何文件，GUI 重启后重新生成

### Requirement: 盐模式三态

设置页盐配置须（SHALL）提供忽略、添加、覆盖三种互斥模式，默认“添加”。忽略模式既不读取也不写入请求体 `cache_salt`；添加模式仅在请求体缺少顶层 `cache_salt` 时写入当前盐，已有值原样保留；覆盖模式无论请求体是否已有 `cache_salt`，都移除原值再写入当前盐。

#### Scenario: 默认添加模式

- **WHEN** 设置缓存缺失盐配置，或首次打开 GUI 且无缓存
- **THEN** 盐模式为“添加”

#### Scenario: 忽略模式不介入请求体

- **WHEN** 盐模式为忽略，客户端请求体含或不含顶层 `cache_salt`
- **THEN** 反代不读取也不写入该字段，请求体原样转发

#### Scenario: 添加模式补齐缺失的盐

- **WHEN** 盐模式为添加，客户端请求体缺少顶层 `cache_salt`
- **THEN** 反代按最小侵入写入当前盐，body 其余字节不变

#### Scenario: 添加模式保留已有的盐

- **WHEN** 盐模式为添加，客户端请求体已含顶层 `cache_salt`
- **THEN** 反代不注入也不改写该字段，请求体保持原样

#### Scenario: 覆盖模式替换已有的盐

- **WHEN** 盐模式为覆盖，客户端请求体已含顶层 `cache_salt`
- **THEN** 反代把该字段替换为当前盐，body 其余字节不变

### Requirement: 盐值刷新三通道与记录重置

定时刷新、定量刷新与用户直接改盐值构成三条刷新渠道，须（SHALL）同时生效。任一渠道触发时，系统须（SHALL）生成一个新的随机盐，并同时把定时基线时间与定量计数一起重置。定量计数按已经反代转发的受支持推理请求累计，计数达到阈值后的下一个请求在发出前先完成刷新。只改刷新参数不算刷新，只重置基线记录。

#### Scenario: 定时到点换新盐

- **WHEN** 定时刷新已开启且自上次刷新起到达配置的周期
- **THEN** 系统生成新的随机盐，后续请求使用新盐，并把定时基线与定量计数一起重置

#### Scenario: 定量到数换新盐

- **WHEN** 定量刷新已开启，已转发请求数达到配置阈值
- **THEN** 下一个推理请求在发出前先换用新的随机盐，并把定时基线与定量计数一起重置

#### Scenario: 先到的渠道重置另一条记录

- **WHEN** 同时配置 30 分钟定时与 50 个请求定量，30 分钟未到而请求数已达 50
- **THEN** 第 51 个请求在发出前先换用新的随机盐，并把定时基线与定量计数一起归零

#### Scenario: 直接改盐值同样重置记录

- **WHEN** 用户直接在盐值输入框提交一个新盐值
- **THEN** 系统立即换用该盐值，并把定时基线与定量计数一起重置

#### Scenario: 只改刷新参数不换盐

- **WHEN** 用户修改定时刷新的周期或开关，或修改定量刷新的阈值或开关
- **THEN** 当前使用的盐值不变，只把定时基线与定量计数重置

### Requirement: 设置页密态推理卡的盐配置控件

设置页“密态推理”功能卡须（SHALL）在 API Key 之外提供盐配置控件：盐模式三选一（忽略 / 添加 / 覆盖）。添加与覆盖模式下须（SHALL）显示同一组控件：盐值输入框配“生成随机值”按钮，以及定时刷新、定量刷新两行设置；忽略模式须（SHALL）隐藏下方全部盐配置控件。这些文本控件须（SHALL）禁用 WebKit 自动首字母大写与自动更正。

#### Scenario: 忽略模式隐藏盐配置控件

- **WHEN** 盐模式为忽略
- **THEN** 盐值输入框、生成随机值按钮、定时刷新与定量刷新设置全部不显示

#### Scenario: 添加与覆盖模式显示同一组控件

- **WHEN** 盐模式从添加切到覆盖，或从覆盖切到添加
- **THEN** 下方控件集不变，均为盐值输入框、生成随机值按钮、定时刷新与定量刷新设置

#### Scenario: 盐配置文本控件禁用输入辅助

- **WHEN** 设置页渲染盐模式、盐值与刷新参数控件
- **THEN** 这些文本控件禁用 WebKit 自动首字母大写与自动更正

### Requirement: 盐值输入框失焦提交与回填

盐值输入框的焦点须（SHALL）只抑制文本回填，不影响后台换盐：输入框正在编辑时，后台仍按三条渠道换盐并用新盐发请求，只是新盐不回填进输入框。失焦时系统须（SHALL）比对输入框内容与当前盐值：内容已变且非空就采用该值当作一次直接刷新并重置定时与定量记录；内容为空或与当前盐一致就立即把输入框回填为当前盐，且不改盐、不重置记录。“生成随机值”按钮须（SHALL）等同于直接改盐值。

#### Scenario: 编辑期间后台照常换盐

- **WHEN** 用户正在编辑盐值输入框，且定时或定量刷新触发
- **THEN** 系统仍换用新的随机盐并发请求，输入框因处于编辑状态而不回填新值

#### Scenario: 失焦时内容有变化则提交为新盐

- **WHEN** 输入框失焦时其内容与当前盐值不同且非空
- **THEN** 系统采用该内容作为当前盐，并重置定时基线与定量计数

#### Scenario: 失焦时内容为空则回填当前盐

- **WHEN** 输入框失焦时其内容为空
- **THEN** 系统立即把输入框回填为当前盐，盐值与定时、定量记录都不变

#### Scenario: 失焦时内容未变则回填当前盐

- **WHEN** 输入框失焦时其内容与当前盐值一致
- **THEN** 系统保持当前盐不变，输入框继续显示当前盐，定时基线与定量计数不重置

#### Scenario: 生成随机值等同直接改盐值

- **WHEN** 用户点击“生成随机值”按钮
- **THEN** 系统立即换用新的随机盐、回填输入框，并重置定时基线与定量计数

### Requirement: 设置页回填当前盐值

设置页盐值输入框须（SHALL）反映当前实际使用的盐值：后台刷新盐值后，只要输入框未处于编辑状态，界面须（SHALL）显示刷新后的新值。

#### Scenario: 后台刷新后回填新盐

- **WHEN** 后台因定时或定量刷新换用新盐，且盐值输入框未处于编辑状态
- **THEN** 输入框显示刷新后的新盐

#### Scenario: 忽略模式没有盐值可回填

- **WHEN** 盐模式为忽略
- **THEN** 设置页不显示盐值输入框，也不请求当前盐值

### Requirement: 盐不构成请求准入条件

tngui 须（SHALL）在不检查、不要求盐的前提下照常处理请求，绝不（MUST NOT）因缺少 `cache_salt` 而拒绝或降级。盐模式为忽略时请求照常转发；添加或覆盖模式下反代补盐后同样照常转发。盐的有无与取值由调用侧和本地配置决定，不构成 tngui 的准入条件。

#### Scenario: 忽略盐模式照常转发

- **WHEN** 盐模式为忽略，客户端发送带有效 `model` 的推理请求
- **THEN** 反代不新增 `cache_salt`，按既有规则转发并回传响应，不因缺盐返回 4xx/5xx

#### Scenario: 缺少盐不构成拒绝理由

- **WHEN** 到达 tngui 的推理请求最终不含 `cache_salt`
- **THEN** 反代不拒绝该请求，行为与未启用加盐时一致

### Requirement: 密态推理运行模式切换

系统须（SHALL）在密态推理页提供运行模式切换控件，取值仅 `对话模式` 与 `Agent 模式`，默认 `对话模式`。模式**按请求生效**：切换只影响下一次发送，绝不（MUST NOT）改变已经发出的进行中请求，也绝不（MUST NOT）重置共享会话上下文。`对话模式` 下一次发送恰好触发一次推理请求且不执行工具；`Agent 模式` 下一次发送触发模型↔工具多轮循环，直到模型不再请求工具或到达轮数上限。模式选择只存在于 GUI 进程内存。

#### Scenario: 默认对话模式

- **WHEN** GUI 进程首次打开密态推理视图
- **THEN** 运行模式为 `对话模式`，一次发送只触发一次推理请求

#### Scenario: 对话模式一次发送一次请求

- **WHEN** 运行模式为 `对话模式`，用户发送一轮输入
- **THEN** 系统只发出一次推理请求，不注册工具、不执行工具、不发起后续轮次

#### Scenario: Agent 模式单次发送多轮循环

- **WHEN** 运行模式为 `Agent 模式`，用户发送一轮输入
- **THEN** 系统在这一次发送内持续驱动模型请求与工具执行，直到模型不再请求工具或到达轮数上限，期间不再需要用户输入

#### Scenario: 切换按请求生效不打断进行中请求

- **WHEN** 一轮 Agent 模式请求仍在进行中，用户把运行模式切换为 `对话模式`
- **THEN** 进行中的请求继续按原模式运行至终态，下一次发送才使用新选择的模式

#### Scenario: 模式切换不清空上下文

- **WHEN** 用户在已有对话历史的页面上切换运行模式
- **THEN** 聊天 transcript 与共享会话消息保持不变，下一次请求仍携带此前完整上下文

#### Scenario: 进程退出后模式重置

- **WHEN** GUI 进程退出后重新启动
- **THEN** 运行模式回到默认 `对话模式`

### Requirement: 密态推理共享会话上下文

`对话模式` 与 `Agent 模式` 须（SHALL）共用同一个 GUI 进程内存会话，并把它作为每一轮请求的上下文来源。会话消息须（SHALL）逐字携带此前已完整完成的 user 消息、assistant 最终 `content` 与其 `tool_calls`、以及 `role:"tool"` 的工具结果消息；系统绝不（MUST NOT）因模式切换而清空、裁剪或重写既有会话消息，也绝不（MUST NOT）把工具往来拍平成纯文本。assistant 的 `reasoning` 绝不（MUST NOT）进入后续请求上下文。共享会话只存在于进程内存，绝不（MUST NOT）写入设置缓存、tng 配置或任何文件。

#### Scenario: 两种模式共享同一上下文

- **WHEN** 用户在 `对话模式` 完成一轮对话后切换为 `Agent 模式` 并发送新输入
- **THEN** Agent 模式这一轮的请求 `messages` 逐字包含前一轮的 user 消息与 assistant 最终 `content`，再追加本轮用户输入原文

#### Scenario: 工具往来进入后续上下文

- **WHEN** Agent 模式一轮响应包含 `tool_calls` 与对应 `role:"tool"` 结果
- **THEN** 后续任意模式请求的 `messages` 按原顺序包含该 assistant `tool_calls` 消息与该工具结果消息

#### Scenario: reasoning 不进入上下文

- **WHEN** assistant 响应含 reasoning 与最终 content 并保留在聊天 UI 中
- **THEN** 后续请求 `messages` 中的 assistant 消息只含最终 `content` 与 `tool_calls`，不含 reasoning

#### Scenario: 失败或停止的消息不进入上下文

- **WHEN** 上一轮 assistant 以失败、中断或用户停止进入终态
- **THEN** 该消息仍可显示在聊天 transcript 中，但不作为已完成上下文进入后续请求 `messages`

#### Scenario: 共享会话不落盘

- **WHEN** 用户离开密态推理页、切换运行模式，或退出 GUI 进程
- **THEN** 系统不把共享会话消息写入设置缓存、tng 配置或其他文件；进程退出后会话内容全部丢弃

### Requirement: 密态推理 Agent 模式多轮工具调用

`Agent 模式` 下系统须（SHALL）注册且只注册**只读**内置工具 `read` / `ls` / `grep` / `find`，并在宿主文件系统上以进程工作目录为基准执行，**不限制可访问路径**（允许读取宿主任意路径文件）。系统须（SHALL）在单次用户发送内驱动模型↔工具循环直至模型不再请求工具或到达单次运行轮数上限；轮数上限默认 `30`，可由环境变量 `RPI_MAX_TURNS_PER_RUN` 覆盖。Agent 模式不做会话持久化。工具执行失败、轮数达到上限或推理链路出错时，系统须（SHALL）保留已到达的 reasoning 与 content，并给出可读的错误或终止摘要，绝不（MUST NOT）清空已到达文本。

#### Scenario: 只读工具集且不包含写操作

- **WHEN** Agent 模式一次运行向模型暴露可用工具
- **THEN** 可用工具为 `read`、`ls`、`grep`、`find` 四个只读工具，不包含任何写入、删除、修改或执行命令的工具

#### Scenario: 不限制访问路径

- **WHEN** Agent 模式一次运行请求读取当前工作目录之外的宿主路径
- **THEN** 该只读工具正常在宿主文件系统上执行，系统不因路径不在工作目录内而拒绝

#### Scenario: 单次发送内多轮工具调用

- **WHEN** 模型连续请求工具调用，且每次工具结果返回后仍继续请求
- **THEN** 系统在同一 assistant 气泡内依次执行工具并把结果回填给模型，继续下一轮推理，直到模型不再请求工具

#### Scenario: 到达轮数上限终止

- **WHEN** 工具调用轮次达到单次运行上限（默认 30）
- **THEN** 系统停止继续循环，保留已到达输出，并在该气泡内显示已达轮数上限的终止摘要

#### Scenario: 工具失败不中止整轮

- **WHEN** 某次只读工具执行返回错误
- **THEN** 系统把该错误作为工具结果回填给模型并可继续后续推理，且在该工具步骤上标记失败状态

#### Scenario: Agent 模式不落盘

- **WHEN** Agent 模式完成或终止一次运行
- **THEN** 系统不把会话、工具记录或运行状态写入设置缓存、tng 配置或其他文件

### Requirement: 密态推理 Agent 模式工具调用呈现

`Agent 模式` 下一次用户发送须（SHALL）只在聊天区域新增**一个** assistant 气泡；该气泡须（SHALL）内嵌呈现整轮交互时间线，按到达顺序展示推理文本片段、工具调用步骤与最终回答，绝不（MUST NOT）按推理轮次拆分为多个 assistant 气泡。每个工具调用步骤须（SHALL）至少展示工具名、关键参数、执行状态（进行中 / 成功 / 失败 / 已取消）与结果摘要。工具调用时间线与推理文本须（SHALL）在同一气泡内滚动展示，聊天消息区域须（SHALL）在增量到达时自动滚动到底部。

#### Scenario: 单气泡承载整轮交互

- **WHEN** Agent 模式一次发送触发多轮推理与多次工具调用
- **THEN** 聊天区域只新增一个 assistant 气泡，全部轮次的推理文本与工具步骤都呈现在该气泡内

#### Scenario: 工具步骤展示名称参数状态与结果摘要

- **WHEN** Agent 模式执行一次工具调用
- **THEN** 对应工具步骤显示工具名、关键参数、执行状态与结果摘要

#### Scenario: 工具状态随执行变化

- **WHEN** 工具调用从开始执行到返回结果
- **THEN** 该步骤状态从进行中变为成功或失败；被用户停止时变为已取消

#### Scenario: 时间线自动跟随最新进展

- **WHEN** Agent 模式持续追加推理文本或工具步骤
- **THEN** 聊天消息区域自动滚动到底部，始终显示最新进展

### Requirement: 密态推理新会话与模式切换控件

系统须（SHALL）把密态推理页顶部的模型下拉列表左侧的 `新会话` 按钮作为唯一的会话重置入口，替换原先位于聊天输入框左侧的红色 `重置` 按钮；原 `重置` 按钮位置须（SHALL）改为运行模式切换控件，其控件风格须（SHALL）对齐设置页入口配置中本机端口在 `127.0.0.1` / `0.0.0.0` 间切换所用的分段切换控件。点击 `新会话` 须（SHALL）在没有进行中请求时在聊天 transcript 末尾插入一条 `新对话` 分隔线并清空当前共享会话（即下一轮请求的上下文），使下一轮请求不携带任何此前上下文，同时分隔线之前的既有聊天记录须（SHALL）保留显示；系统不得（MUST NOT）为 `新会话` 弹出确认对话框，不得（MUST NOT）因 `新会话` 清除模型清单、选中模型、思考强度、身份注入设置或页面选项卡，也绝不（MUST NOT）把会话状态写入文件。`新会话` 在存在进行中请求时须（SHALL）不可交互，且界面绝不（MUST NOT）再渲染红色 `重置` 按钮；`新对话` 分隔线须（SHALL）继续作为 `新会话` 的生效标记渲染在消息流中。

#### Scenario: 新会话按钮位于模型下拉左侧

- **WHEN** 渲染密态推理页顶部工具条
- **THEN** `新会话` 按钮出现在模型下拉列表左侧，聊天输入框左侧不再出现 `重置` 按钮

#### Scenario: 原重置位置改为模式切换控件

- **WHEN** 渲染聊天输入框左侧原先 `重置` 按钮所在位置
- **THEN** 该位置显示 `对话模式` / `Agent 模式` 分段切换控件，其样式与设置页入口配置的本机端口切换控件一致

#### Scenario: 新会话插入分隔线并清空请求上下文

- **WHEN** 用户在存在已完成对话且无进行中请求时点击 `新会话`
- **THEN** 聊天 transcript 末尾插入一条 `新对话` 分隔线、共享会话被清空，下一次请求 `messages` 只包含本轮用户输入，不弹出确认对话框

#### Scenario: 新会话保留既有聊天记录

- **WHEN** 用户点击 `新会话` 后查看聊天区域
- **THEN** 分隔线之前的既有用户气泡与 assistant 气泡仍按原样显示，只有请求上下文被切断

#### Scenario: 分隔线切段请求上下文

- **WHEN** 用户在点击 `新会话` 后发送新输入
- **THEN** 该轮请求 `messages` 不包含分隔线之前的任何消息，聊天区域仍同时显示分隔线前后的记录

#### Scenario: 末尾已是分隔线时不可重复插入

- **WHEN** 最近一次 `新对话` 分隔线之后没有新的用户或 assistant 消息
- **THEN** `新会话` 按钮不可交互，不会连续插入新的分隔线

#### Scenario: 新会话保留调试参数

- **WHEN** 用户点击 `新会话`
- **THEN** 模型清单、选中模型、思考强度、身份注入状态与页面选项卡保持点击前状态，且不为该动作写入任何文件

#### Scenario: 进行中请求禁用新会话

- **WHEN** 当前 assistant 轮次处于解密中、流式输出、Agent 工具循环或其他未终态
- **THEN** `新会话` 按钮不可交互；用户须先通过 `停止` 使本轮进入终态，才能开始新会话

#### Scenario: 不再渲染重置按钮但保留新对话分隔线

- **WHEN** 渲染密态推理页
- **THEN** 界面不出现红色 `重置` 按钮；`新对话` 分隔线仍作为 `新会话` 的生效标记渲染在消息流中

### Requirement: 密态推理停止与取消控制

系统须（SHALL）允许用户在本轮推理尚未进入终态时主动停止推理。点击停止后，系统须（SHALL）立即把当轮 assistant 消息标记为 `stopped` 终态、向后端发出取消指令并释放发送锁；取消须（SHALL）终止当前推理流——`对话模式` 下终止 SSE 读取与传输连接，`Agent 模式` 下终止 harness 运行循环与正在执行的工具——并忽略取消后迟到的 reasoning/content 增量。主动停止不得（MUST NOT）被视为网络或协议错误，也不得（MUST NOT）显示失败诊断。应用内切换到其他页面不得（MUST NOT）自动停止请求。

#### Scenario: Agent 模式停止中止工具循环

- **WHEN** Agent 模式正在执行工具或多轮推理，用户点击“停止”
- **THEN** harness 运行循环与正在执行的工具停止，当前 assistant 气泡进入 stopped 终态，正在执行的工具步骤标记为已取消

#### Scenario: 停止后忽略迟到增量

- **WHEN** 用户点击停止后，Tauri 通道随后仍收到 reasoning 或 content 增量
- **THEN** 迟到增量被忽略，不追加到 stopped 气泡，也不把状态改回生成中或完成

#### Scenario: 停止后可发送下一轮

- **WHEN** 一轮 inference 进入 stopped 终态
- **THEN** 发送锁释放，输入区主按钮恢复为“发送”，用户可发起新一轮请求

#### Scenario: 切页不自动停止但返回后可停止

- **WHEN** 本轮推理尚未终态，用户切换到概览或设置页再返回推理页
- **THEN** 系统不自动取消请求，推理状态继续后台推进；返回后主按钮仍为“停止”并可执行取消

### Requirement: 密态推理停止后的显示与保留

停止后的显示语义须（SHALL）按 assistant 气泡是否已产生输出文本区分：已显示 reasoning/content 时须（SHALL）按原样保留并停止追加后续增量；尚无输出文本、仍停留在 `▶解密中` 指示时，指示须（SHALL）消失，气泡正文保持空白，仅显示“已停止⚪响应不完整”。进入 `stopped` 终态后该 assistant 消息须（SHALL）继续保留在聊天 transcript 中，但不得（MUST NOT）作为已完成上下文进入后续请求 `messages`。

#### Scenario: 流式输出中停止保留已显示内容

- **WHEN** assistant 气泡已显示部分 reasoning/content，用户点击“停止”
- **THEN** 系统取消推理流并停止追加新内容，已显示的 reasoning/content 保持原样，气泡标记“已停止⚪响应不完整”

#### Scenario: 解密中停止保持空白

- **WHEN** assistant 气泡仍停留在 `▶解密中` 指示、尚无输出文本，用户点击“停止”
- **THEN** `▶解密中` 指示消失，assistant 气泡正文保持空白并标记“已停止⚪响应不完整”，不显示任何文本

#### Scenario: 停止消息不进入后续上下文

- **WHEN** 上一轮 assistant 因用户点击停止进入 stopped 终态，随后用户发送新输入
- **THEN** 新请求不携带被停止 assistant 消息的 reasoning 或 content；该消息仍可见于聊天 transcript

### Requirement: 密态推理解密中指示

系统须（SHALL）在每轮推理进行中、assistant 气泡尚无任何输出文本时，在流式输出的光标位置固定显示 `▶解密中` 字样；`对话模式` 与 `Agent 模式` 须（SHALL）一致显示该指示。系统绝不（MUST NOT）再播放五步安全流程阶段动画，也绝不（MUST NOT）横向或纵向铺开阶段节点或阶段卡。首个非空 reasoning 或 content 增量到达后，`▶解密中` 须（SHALL）被该增量文本取代并在其末尾显示流式光标，后续增量实时追加。assistant 轮次进入任一终态后须（SHALL）不再显示 `▶解密中`。该指示的出现与消失不得（MUST NOT）引发 assistant 气泡或聊天区域高度跳变。

#### Scenario: 发送后显示解密中

- **WHEN** 用户发送一轮推理请求且 assistant 气泡尚无输出文本
- **THEN** 气泡内在流式输出光标位置固定显示 `▶解密中`

#### Scenario: 两种模式一致显示

- **WHEN** `对话模式` 与 `Agent 模式` 各自发起一轮推理且尚无输出文本
- **THEN** 两种模式都在流式输出光标位置显示相同的 `▶解密中` 字样

#### Scenario: 首个增量取代解密中指示

- **WHEN** 首个非空 reasoning 或 content 增量到达
- **THEN** `▶解密中` 被该增量文本取代，并在增量文本末尾显示流式光标，后续增量实时追加

#### Scenario: 终态移除解密中指示

- **WHEN** assistant 轮次进入完成、失败或停止任一终态
- **THEN** 气泡内不再显示 `▶解密中`

#### Scenario: 不再出现五步阶段动画

- **WHEN** 用户发送推理请求
- **THEN** 界面不出现五步安全流程的阶段卡、阶段图标、阶段进度点、线性进度条或垂直转场动画，只显示 `▶解密中` 指示

#### Scenario: 指示切换不抖动布局

- **WHEN** `▶解密中` 指示出现或被首个增量取代
- **THEN** assistant 气泡与聊天 transcript 的高度保持稳定，不发生上下抖动
