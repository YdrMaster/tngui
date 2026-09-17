# Spec Delta

## ADDED Requirements

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
