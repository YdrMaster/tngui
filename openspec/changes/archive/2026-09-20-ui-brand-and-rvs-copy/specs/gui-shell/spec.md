# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 远程证明服务配置与 RVS 地址一致性

系统须（SHALL）在“设置”视图的 TNG 配置区域中，为远程证明提供标题为“远程证明服务配置”的配置块；当任意一条 ingress 开启远程证明时，该配置块展示在 TNG 配置内容下方，并承载一个可编辑的地址输入。该输入的用户可见名称须（SHALL）为“参考值服务地址”，且系统不得（MUST NOT）在其下方显示关于 `RATS_TEE_VERIFIER_URL` 环境变量、设置缓存或 TNG 配置 JSON 的说明文案。首次启动、设置缓存缺失/损坏、schema 不支持或校验失败时，该地址必须预填为 `https://rvs.cloud.misuan.com`；存在有效设置时，系统必须直接恢复用户填写值，不得覆盖为默认地址。该值必须被视为 TNG 配置状态的一部分，并随设置缓存跨会话保存。
当远程证明开启并启动或重启 tng 进程时，系统必须把界面中当前提交的 RVS 地址放入 tng 子进程环境变量 `RATS_TEE_VERIFIER_URL`，且该值必须与界面中当前显示/提交的值完全一致；若用户在 tng 运行期间修改该地址，保存/离开设置时须按现有 TNG 配置修改语义触发重启，使新值生效。
为了保持 TNG 严格 JSON 解析兼容，该值不得作为未知字段写入 `tng-runtime.json`；GUI 须（SHALL）在生成 TNG 对外配置时忽略/剥离该字段，只把该字段作为 GUI 侧配置状态并在进程启动时注入为环境变量。

#### Scenario: 参考值服务地址标签与说明

- **WHEN** 任意一条 ingress 开启远程证明，且用户进入“设置”视图
- **THEN** 地址输入的用户可见标签为“参考值服务地址”
- **AND** 界面不展示关于 `RATS_TEE_VERIFIER_URL`、设置缓存或 TNG 配置 JSON 的说明文案

#### Scenario: RA 开启时显示远程证明服务配置

- **WHEN** 任意一条 ingress 开启远程证明，且用户进入“设置”视图
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

#### Scenario: 全部 ingress 关闭远程证明时不展示配置块

- **WHEN** 所有 ingress 均关闭远程证明
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
