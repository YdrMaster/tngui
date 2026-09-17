## MODIFIED Requirements

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

## ADDED Requirements

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
