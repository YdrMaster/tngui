## ADDED Requirements

### Requirement: 管控端口自动选取

系统须（SHALL）在拉起 tng 前由 tngui 自行选取一个空闲的回环端口（绑定 `127.0.0.1` 探测得到），将其作为 `control_interface.restful.port` 注入传给 tng 的配置；`control_interface` 的其余同级字段（如 `ttrpc` 等）保留不变。若 tngui 无法分配空闲回环端口，系统须（SHALL）拒绝启动 tng 并在界面展示说明性错误。

#### Scenario: 选取空闲端口并注入

- **WHEN** 用户触发启动/重启
- **THEN** 系统在拉起 tng 前选取一个空闲回环端口，传给 tng 的配置中 `control_interface.restful` 为 `{ "host": "127.0.0.1", "port": <空闲端口> }`，且该端口用于后续控制面轮询

#### Scenario: 无法分配端口则拒绝启动

- **WHEN** tngui 未能分配到空闲回环端口（绑定探测失败）
- **THEN** 系统不拉起 tng，并在界面中展示说明性错误

## MODIFIED Requirements

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

### Requirement: 结构化配置控件

系统须（SHALL）在"设置"视图提供结构化控件，覆盖 `add_ingress` 列表与 `add_egress` 列表（每条含模式选择器与该模式对应字段），以及每条 ingress/egress 的 `no_ra` 开关。系统绝不（MUST NOT）提供 `control_interface.restful`（host 或 port）的任何结构化控件——管控面由 tngui 在启动时自行注入（见"控制面 host 强制走回环地址"与"管控端口自动选取"）。模式须按 TNG 的外挂 tag 判别（如 `mapping`、`http_proxy`、`socks5`、`netfilter`、`hook`）。

#### Scenario: 新增条目并选模式

- **WHEN** 用户在"设置"视图新增一条 ingress 或 egress 并选择模式
- **THEN** 系统展示该模式对应的字段集

#### Scenario: 切换模式重置字段

- **WHEN** 用户切换某条 ingress/egress 的模式
- **THEN** 系统以新模式的字段集替换该条原有字段

#### Scenario: 启动时序列化为 TNG JSON

- **WHEN** 用户触发启动/重启
- **THEN** 系统将结构化控件状态序列化为符合 TNG 配置（外挂 tag 形式）的 JSON，其中不含 `control_interface.restful`；`control_interface.restful`（`host=127.0.0.1` + tngui 自动选取的端口）由启动流程在拉起 tng 前注入

### Requirement: 原始 JSON 高级视图

系统须（SHALL）在"设置"视图提供与结构化表单双向同步的原始 JSON 视图，供高级编辑与兜底（含未结构化的 RA `attest`/`verify` 等字段）。该视图不含 `control_interface.restful`——管控面由 tngui 在启动时注入（见"控制面 host 强制走回环地址"与"管控端口自动选取"）；当导入或回填的 JSON 含 `control_interface.restful` 时，丢弃其 `host`/`port`，其余未结构化字段仍往返不丢。

#### Scenario: 表单到 JSON 同步

- **WHEN** 用户在结构化控件中编辑
- **THEN** 原始 JSON 视图反映其序列化结果，且该结果不含 `control_interface.restful`

#### Scenario: JSON 到表单回填

- **WHEN** 用户在原始 JSON 视图编辑为合法 JSON 并确认
- **THEN** 结构化控件按该 JSON 回填，其中 `control_interface.restful` 的 `host`/`port` 被丢弃；若 JSON 非法则提示错误且不破坏表单状态

### Requirement: JSON 配置导入导出

系统须（SHALL）通过原生文件对话框支持导入（读取文件填充配置）与导出（把当前配置写入文件）JSON 配置。导入/导出的内容为用户侧配置，不含 `control_interface.restful`（该块由 tngui 在拉起 tng 时注入）；导入时丢弃文件中 `control_interface.restful` 的 `host`/`port`。

#### Scenario: 导入填充

- **WHEN** 用户经原生打开文件对话框选择 JSON 文件并导入
- **THEN** 系统解析该文件并填充结构化控件与原始 JSON 视图，其中 `control_interface.restful` 的 `host`/`port` 被丢弃；解析失败时显示错误且不改变当前配置

#### Scenario: 导出写入

- **WHEN** 用户经原生另存为对话框选择路径并导出
- **THEN** 系统将当前配置的 pretty JSON（不含 `control_interface.restful`）写入该路径；写入失败时显示错误

### Requirement: 默认开局模板

系统须（SHALL）在每次启动 GUI 时以内置默认配置模板（含一条 `no_ra` 的 `mapping` ingress 示例；不含 `control_interface.restful`——管控面由 tngui 在拉起 tng 时注入）初始化"设置"视图，且不在本地持久化用户编辑。

#### Scenario: 全新开局

- **WHEN** GUI 启动
- **THEN** "设置"视图加载内置默认模板，而非任何上次编辑；默认模板不含 `control_interface.restful`

#### Scenario: 不持久化

- **WHEN** 用户编辑配置后关闭并重新打开 GUI
- **THEN** "设置"视图仍为默认模板（用户须显式导入或重新编辑）

## REMOVED Requirements

### Requirement: 缺失控制端口时拒绝启动

**Reason**: `control_interface.restful.port` 不再由用户提供；改由 tngui 在拉起 tng 时自动选取空闲回环端口注入（见新增要求"管控端口自动选取"），"用户缺端口"的情形不复存在。

**Migration**: 配置中不再需要 `control_interface.restful.port`；旧配置里若存在该字段会在启动/导入时被 tngui 覆盖或丢弃。若 tngui 无法分配空闲回环端口，则由"管控端口自动选取"要求拒绝启动并给出说明性错误。
