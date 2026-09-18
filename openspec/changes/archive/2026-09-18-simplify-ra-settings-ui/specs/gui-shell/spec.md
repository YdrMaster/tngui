# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
