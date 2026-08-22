## MODIFIED Requirements

### Requirement: 带配置编辑器与启动控制的 GUI 窗口

系统须（SHALL）渲染一个带左侧导航栏的桌面 GUI 窗口，提供"首页"与"配置"两个视图；配置编辑控件与启动/重启控件位于"配置"视图，"首页"视图不含配置编辑与启停控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在"配置"视图编辑配置（结构化控件或原始 JSON）并触发启动/重启控件
- **THEN** 系统将该配置写入文件并以该配置文件拉起 `tng launch`

#### Scenario: 重启时先终止既有进程

- **WHEN** GUI 启动的 tng 进程已在运行，且用户触发启动/重启控件
- **THEN** 系统在以当前配置拉起新进程之前先终止既有 tng 子进程

## ADDED Requirements

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