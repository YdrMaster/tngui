# Spec Delta

## REMOVED Requirements

### Requirement: 密态推理页面发送并显示推理请求

**Reason**: 需要把自由填写模型名改为由 capi `/v1/models` 模型清单驱动的强制选择，并让发送门锁依赖清单内选中模型。旧 requirement 及其“可发判定仅认概览运行态与 api-key”“model 在推理页可编辑”场景无法表达新的下拉模型控件、空列表状态和模型发现失败状态。
**Migration**: 用“密态推理模型清单驱动测试请求”承接所有未被删除的 prompt、响应显示、调试与 RA 展示行为，并新增模型下拉 1/0/N、刷新回落与失败状态。

### Requirement: 密态推理凭据只在 GUI 会话内

**Reason**: 旧 requirement 的核心还是把 `model` 描述为推理页可编辑会话态，且场景名绑定自由输入。在新行为中，模型清单和选中模型都来自服务端发现的选项，不能使用“可编辑输入”场景名以免误导。
**Migration**: 用“密态推理模型与凭据状态不可跨会话持久化”承接模型清单、选中模型、设置页 API Key 输入框和 tng runtime JSON 的持久化语义。

### Requirement: 文本输入首尾空白规范化

**Reason**: 旧 requirement 要求对推理页自由输入的 model 执行 trim，与新的下拉模型 ID 必须原样使用语义冲突。
**Migration**: 用“域名与模型身份文本语义”保留 http_proxy 域名 trim 语义，同时新增 `/v1/models` 返回 ID 原样保留语义。

## ADDED Requirements

### Requirement: 密态推理模型清单驱动测试请求

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板。面板的“可发”门锁须（SHALL）同时满足：概览“运行状态”为“运行”、本机已配置 api-key、模型发现请求成功返回至少一个模型，且当前选中模型属于最新模型清单。发送时按 OpenAI 兼容格式 POST 到 tngui 反代对外端点，携带 `Authorization: Bearer <apiKey>` 和 `{model,messages}` body。系统绝不（MUST NOT）在前端或反代中另发 `x-model` 头；模型身份由反代按 body.model 改写请求 path。输出区只显示当次响应；RA 过程保持占位。

密态推理请求面板的模型控件须（SHALL）是基于 `/v1/models` 响应创建的选项下拉菜单。系统须（SHALL）解析 OpenAI 兼容响应中的 `data[].id` 作为模型 ID，只允许用户在下拉选项之间切换，不得提供自由文本输入、创建新值、空选项或清除选择。

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: prompt 按内容自动伸缩

- **WHEN** 用户在 prompt textarea 中增删内容
- **THEN** textarea 高度自动增高或收缩，最小 4 行、最大 16 行；达到最大高度后内容滚动，且拖拽角不能改变其高度

#### Scenario: 发送按钮图标垂直居中且无遗留提示框

- **WHEN** 渲染可交互的“发送测试请求”按钮
- **THEN** 按钮内图标与文字垂直居中；按钮下方不出现单独的蓝色锁形提示框

#### Scenario: 可发判定包含运行态、api-key 与清单内选中模型

- **WHEN** 渲染密态推理视图的请求面板
- **THEN** 面板仅在概览运行态、api-key、模型发现成功、模型清单非空与清单内选中模型同时满足时可发送

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND 概览显示“运行” AND api-key 已配置 AND 模型在下拉清单中被选中
- **THEN** 系统向 tngui 反代对外端点发 POST，不直连 tng 内部 ingress 端口；请求经 pre-TNG path 注入代理进入 TNG

#### Scenario: 模型发现返回空列表

- **WHEN** `/v1/models` 成功返回空模型清单
- **THEN** 模型下拉菜单不可交互并显示文本 `未检测到密态模型`；发送测试请求按钮不可交互；系统不以空模型发送请求

#### Scenario: 单模型自动选中

- **WHEN** `/v1/models` 成功返回一个模型 ID
- **THEN** 模型下拉菜单显示并选中该模型 ID；用户无需先手动选择即满足模型侧发送条件

#### Scenario: 多模型默认选中且可切换

- **WHEN** `/v1/models` 成功返回多个模型 ID
- **THEN** 模型下拉菜单默认选中返回清单中的第一个 ID，用户可切换为清单内其他 ID；下拉菜单不提供空选项，也不允许清除选择

#### Scenario: 模型清单刷新保留或回落选择

- **WHEN** `/v1/models` 成功返回新模型清单
- **THEN** 若当前选中 ID 仍在新清单中则保持选中；若当前选中 ID 不在新清单中则选中新清单第一个 ID；若新清单为空则清空选中并按空列表规则禁用

#### Scenario: 模型发现失败区别于空列表

- **WHEN** `/v1/models` 请求失败或返回不能解析的响应
- **THEN** 请求面板显示明确的模型发现失败状态；发送测试请求按钮不可交互，且界面不得把失败状态显示为 `未检测到密态模型`

#### Scenario: 模型选项不允许自由输入

- **WHEN** 用户查看或操作模型下拉控件
- **THEN** 界面只允许选择 `/v1/models` 返回的模型 ID；搜索或输入行为只能用于过滤既有选项，不能创建、提交或把文本当作模型 ID

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应

#### Scenario: 失败响应框展示脱敏请求与响应调试内容

- **WHEN** 密态推理发送失败
- **THEN** 响应框显示失败摘要、脱敏请求与响应原文；请求中的 `Authorization` 值必须脱敏

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据

---

### Requirement: 密态推理模型与凭据状态不可跨会话持久化

系统须（SHALL）将密态推理的模型清单、选中模型和 UI 会话内模型发现状态作为仅 GUI 会话内的内存态；它们供发送使用，关闭 GUI 后不保留，也绝不（MUST NOT）写入 tng 配置或设置缓存。设置页的 apiKey 须（SHALL）随应用关闭流程写入设置缓存，并在下次 GUI 启动且缓存有效时恢复；apiKey 绝不（MUST NOT）写入 tng 配置或 `tng-runtime.json`。设置页“密态推理”卡 SHALL 只保留一个 API Key 输入框；该输入框 SHALL 默认以密码式遮盖渲染，并提供明确的显隐切换按钮。用户未显式切换前绝不（MUST NOT）明文展示；切换后 SHALL 显示真实值。该卡不得提供复制本地 URL、保存并验证、配置导入/导出、清除本机凭据或中心侧管理说明等额外控件与说明。

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
- **THEN** 仅出现一个默认遮盖的 API Key 输入框和其显隐切换按钮；未切换时界面不显示 API Key 明文，切换后显示真实值；界面不出现保存并验证、复制本地 URL、配置导入/导出、清除本机凭据或中心侧凭据说明

#### Scenario: 推理页只可选择服务端模型且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以只读选项下拉菜单呈现于请求面板；apiKey 不在“密态推理”视图 UI 上展示，发送时仅作为 Authorization 头使用

#### Scenario: 模型清单与 apiKey 变动不影响 tng 进程

- **WHEN** 用户在“密态推理”视图选择模型，或修改“设置”视图的 apiKey
- **THEN** 不触发 TNG 配置 dirty / tng 进程重启；apiKey 边界仅在应用关闭 flush 时写入设置缓存

---

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

## MODIFIED Requirements

### Requirement: tngui 反向代理作为 pre-TNG path 注入代理

系统须（SHALL）在 tng 运行期间由 tngui 自身运行常驻 HTTP 反向代理作为推理对外入口。反代随 tng 启动/停止而启/停，并把推理请求转发到 tng 内部 ingress 本地监听，按 TNG OHTTP path 模型契约执行 pre-TNG path 注入；响应回传给客户端。系统绝不（MUST NOT）把 tng ingress 本地监听端口直接暴露给外部客户端，也绝不（MUST NOT）链接任何 tng crate。

对 `POST /v1/chat/completions` 与 `POST /v1/messages`，反代须（SHALL）将 body 按 UTF-8 JSON object 解析，读取顶层字符串 `model`，trim 后做单一路径 segment percent-encoding，并把 path 改写为 `/models/{encoded-model-segment}{original-path}`。请求 body 字节、query、method 以及 `Authorization`、`x-api-key`、`Content-Type` 须保留。反代须在 model 缺失、不是字符串、trim 后为空、body 不是合法 UTF-8 JSON object 时返回 400；超过 10 MiB 返回 413；以上失败均不得转发 TNG。

对精确的 `GET /v1/models`，反代须（SHALL）作为模型发现例外直接发往当前生效 ingress 指向的 capi origin，不建立到 tng 内部 ingress 本地监听的连接，也不走 OHTTP/path-model 链路。该直连分支须（SHALL）保留请求 query 与业务认证头，使用原始 `/v1/models` path，不做模型 path 注入，不生成、读取或使用 `x-model`，并把 capi 的响应返回给客户端。若无法从当前 ingress 得出有效 capi origin，或 capi 连接失败，反代须（SHALL）返回明确的模型发现失败响应，绝不（MUST NOT）静默改经 tng 转发。

反代绝不（MUST NOT）用 `x-model` 作为模型身份；客户端携带的 `x-model` 不得影响 path 模型或鉴权结果。非模型推理端点的请求不产生模型语义，可按通用反代规则转发。

#### Scenario: 反代随 tng 生命周期启停

- **WHEN** 用户启动或停止 tng
- **THEN** tngui 反向代理随 tng 生命周期启停；未启动时不监听

#### Scenario: OpenAI 请求注入模型路径

- **WHEN** 客户端 `POST /v1/chat/completions` 携带 JSON body `{"model":" model-a "}` 和 `Authorization`
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

#### Scenario: 模型发现直接发往 capi

- **WHEN** 客户端向 tngui 反代请求 `GET /v1/models`
- **THEN** 反代使用当前生效 ingress 的 capi origin 发起模型发现请求，不连接 tng 内部 ingress 本地监听，并把 capi 响应返回给客户端

#### Scenario: 模型发现保留 query 与认证头

- **WHEN** 客户端向 tngui 反代请求 `GET /v1/models?trace=1` 并携带业务认证头
- **THEN** direct capi 请求保留 `/v1/models?trace=1` path 与相应认证头语义

#### Scenario: 模型发现失败不伪装成空列表

- **WHEN** 当前 ingress 无法得出有效 capi origin，或 direct capi 模型发现请求连接失败
- **THEN** pre-TNG proxy 返回明确的失败响应，不建立 TNG 推理请求，也不构造空模型清单响应

#### Scenario: 非模型 path 不改写

- **WHEN** 客户端请求的 path 不是 `POST /v1/chat/completions`、`POST /v1/messages` 或精确 `GET /v1/models`
- **THEN** pre-TNG path 注入逻辑不产生模型前缀，direct 模型发现分支不启用

#### Scenario: 对外绑定 host 可切换

- **WHEN** 用户在 ingress 编辑器行 1 以 toggle 切换反代对外绑定 host 并启动 tng
- **THEN** 反代绑定在所选 host + 配置的对外 port；默认为 `127.0.0.1`

#### Scenario: 不直连 tng ingress 端口

- **WHEN** 外部客户端请求推理入口
- **THEN** 客户端连接的是 tngui 反代对外端点，而非 tng 的内部 ingress 本地监听端口

---

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
