## Purpose

渲染一个最小化 GUI，依据用户编写的 JSON 配置启动并重启 tng 进程，展示 tng 只读控制面的状态，且不链接任何 tng 代码。

## Requirements

### Requirement: 带配置编辑器与启动控制的 GUI 窗口

系统须（SHALL）渲染一个带左侧导航栏的桌面 GUI 窗口，提供"首页"与"配置"两个视图；配置编辑控件与启动/重启控件位于"配置"视图，"首页"视图不含配置编辑与启停控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在"配置"视图编辑配置（结构化控件或原始 JSON）并触发启动/重启控件
- **THEN** 系统将该配置写入文件并以该配置文件拉起 `tng launch`

#### Scenario: 重启时先终止既有进程

- **WHEN** GUI 启动的 tng 进程已在运行，且用户触发启动/重启控件
- **THEN** 系统在以当前配置拉起新进程之前先终止既有 tng 子进程

### Requirement: 控制面 host 强制走回环地址

系统须（SHALL）将传给 tng 的配置中的 `control_interface.restful.host` 设为 `127.0.0.1`，无论用户如何编写，因为 tng 控制面无鉴权，缺省时会绑定 `0.0.0.0`。

#### Scenario: 用户缺省或写非回环 host

- **WHEN** 用户编写的配置中 `control_interface.restful.host` 缺省或被设为 `127.0.0.1` 以外的值
- **THEN** 传给 tng 的配置将控制面绑定到 `127.0.0.1`

### Requirement: 缺失控制端口时拒绝启动

若用户编写的配置缺少 `control_interface.restful.port`，系统须（SHALL）拒绝启动 tng 并显示明确提示，因为状态客户端无端口则无法轮询控制面。

#### Scenario: 配置缺少 control_interface.restful.port

- **WHEN** 用户以不含 `control_interface.restful.port` 的配置触发启动/重启
- **THEN** 系统不拉起 tng，并在界面中展示说明性错误

### Requirement: 从控制面只读 tng 状态

系统须（SHALL）周期性轮询 `127.0.0.1:<端口>` 上的 `GET /livez`、`GET /readyz`、`GET /status/`，并展示三态状态指示：不可达、启动中、就绪。

#### Scenario: tng 不可达

- **WHEN** 对控制端口的轮询连接失败
- **THEN** 状态指示显示"不可达"态

#### Scenario: tng 启动中

- **WHEN** `/livez` 返回成功且 `/readyz` 返回 503
- **THEN** 状态指示显示"启动中"态

#### Scenario: tng 就绪

- **WHEN** `/readyz` 返回 200
- **THEN** 状态指示显示"就绪"态

#### Scenario: 展示状态树

- **WHEN** `/status/` 返回 JSON body
- **THEN** 系统在状态面板中渲染该 JSON body

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

### Requirement: 首页为纯监视视图

系统须（SHALL）在"首页"视图仅展示 tng 状态（三态状态灯与 `/status/` 内容）与 tng 进程输出（stdout/stderr），且首页不包含任何配置输入控件与启动/重启控件。

#### Scenario: 首页无配置输入与启停控件

- **WHEN** 用户处于"首页"视图
- **THEN** 界面不出现配置文本框/结构化配置控件，也不出现启动/重启按钮

#### Scenario: 首页显示状态与日志

- **WHEN** tng 运行中且用户处于"首页"视图
- **THEN** 首页展示三态状态灯、`/status/` 返回的 JSON 与 tng 进程输出

### Requirement: 结构化配置控件

系统须（SHALL）在"配置"视图提供结构化控件，覆盖 `control_interface.restful.port`、`add_ingress` 列表与 `add_egress` 列表（每条含模式选择器与该模式对应字段），以及每条 ingress/egress 的 `no_ra` 开关。模式须按 TNG 的外挂 tag 判别（如 `mapping`、`http_proxy`、`socks5`、`netfilter`、`hook`）。

#### Scenario: 新增条目并选模式

- **WHEN** 用户在"配置"视图新增一条 ingress 或 egress 并选择模式
- **THEN** 系统展示该模式对应的字段集

#### Scenario: 切换模式重置字段

- **WHEN** 用户切换某条 ingress/egress 的模式
- **THEN** 系统以新模式的字段集替换该条原有字段

#### Scenario: 启动时序列化为 TNG JSON

- **WHEN** 用户触发启动/重启
- **THEN** 系统将结构化控件状态序列化为符合 TNG 配置（外挂 tag 形式）的 JSON，并交给启动流程；`control_interface.restful.host` 仍按既有契约强制为 `127.0.0.1`

### Requirement: 原始 JSON 高级视图

系统须（SHALL）在"配置"视图提供与结构化表单双向同步的原始 JSON 视图，供高级编辑与兜底（含未结构化的 RA `attest`/`verify` 等字段）。

#### Scenario: 表单到 JSON 同步

- **WHEN** 用户在结构化控件中编辑
- **THEN** 原始 JSON 视图反映其序列化结果

#### Scenario: JSON 到表单回填

- **WHEN** 用户在原始 JSON 视图编辑为合法 JSON 并确认
- **THEN** 结构化控件按该 JSON 回填；若 JSON 非法则提示错误且不破坏表单状态

### Requirement: JSON 配置导入导出

系统须（SHALL）通过原生文件对话框支持导入（读取文件填充配置）与导出（把当前配置写入文件）JSON 配置。

#### Scenario: 导入填充

- **WHEN** 用户经原生打开文件对话框选择 JSON 文件并导入
- **THEN** 系统解析该文件并填充结构化控件与原始 JSON 视图；解析失败时显示错误且不改变当前配置

#### Scenario: 导出写入

- **WHEN** 用户经原生另存为对话框选择路径并导出
- **THEN** 系统将当前配置的 pretty JSON 写入该路径；写入失败时显示错误

### Requirement: 默认开局模板

系统须（SHALL）在每次启动 GUI 时以内置默认配置模板（含 `control_interface.restful` 与一条 `no_ra` 的 `mapping` ingress 示例）初始化"配置"视图，且不在本地持久化用户编辑。

#### Scenario: 全新开局

- **WHEN** GUI 启动
- **THEN** "配置"视图加载内置默认模板，而非任何上次编辑

#### Scenario: 不持久化

- **WHEN** 用户编辑配置后关闭并重新打开 GUI
- **THEN** "配置"视图仍为默认模板（用户须显式导入或重新编辑）

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