# Spec Delta

## ADDED Requirements

### Requirement: 反代向推理端点注入 cache_salt

tngui 反代须（SHALL）对 `POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/responses` 三类端点，在按 `body.model` 解析出有效模型身份之后、把请求转发给 tng 内部 ingress 之前，向请求体顶层写入字符串字段 `cache_salt`。注入只作用于请求体，不改动 `body.model` 的 path 注入结果，也不改动非法/缺失 `model` 的 fail-closed 判定、10 MiB 上限与非推理端点的透传。

#### Scenario: 三类端点默认注入顶层 cache_salt

- **WHEN** 客户端向 `POST /v1/chat/completions`、`POST /v1/messages` 或 `POST /v1/responses` 发送带有效 `model` 的 JSON object，且盐模式非关闭
- **THEN** 反代转发到内部 ingress 的请求体顶层含字符串 `cache_salt`，且 `body.model` 的 path 注入结果与既有行为一致

#### Scenario: 注入发生在转发与加密之前

- **WHEN** 反代把请求转发给 tng 内部 ingress
- **THEN** 内部请求体在离开反代前已含 `cache_salt`，该值随 tng 链路加密后传输

#### Scenario: 非推理端点与模型发现不注入

- **WHEN** 客户端请求三类推理端点之外的其他 path，或精确 `GET /v1/models`
- **THEN** 反代不向请求体写入 `cache_salt`

### Requirement: 无盐请求不被拒绝或降级

tngui 须（SHALL）在不检查、不要求盐的前提下照常处理请求，绝不（MUST NOT）因缺少 `cache_salt` 而拒绝或降级。盐模式为关闭时请求照常转发；反代未注入盐时同样照常转发。盐的有无与取值由调用侧和本地配置决定，不构成 tngui 的准入条件。

#### Scenario: 关闭盐模式照常转发

- **WHEN** 盐模式为关闭，客户端发送带有效 `model` 的推理请求
- **THEN** 反代不新增 `cache_salt`，按既有规则转发并回传响应，不因缺盐返回 4xx/5xx

#### Scenario: 缺少盐不构成拒绝理由

- **WHEN** 到达 tngui 的推理请求最终不含 `cache_salt`
- **THEN** 反代不拒绝该请求，行为与未启用加盐时一致

### Requirement: 盐不进入请求头、日志与诊断快照

`cache_salt` 须（SHALL）只存在于请求体顶层。反代绝不（MUST NOT）把盐写入请求头、outer metadata、进程日志、错误详情或反代诊断快照 `ProxyDiagnosticsSnapshot`；快照继续只含固定类别计数，不因加盐新增承载盐值或动态标签的字段。

#### Scenario: 请求头集合不因加盐改变

- **WHEN** 反代对同一请求加盐并转发
- **THEN** 转发请求的头集合与未加盐时一致，不含 `cache_salt`

#### Scenario: 诊断快照不含盐

- **WHEN** 反代已注入盐并处理请求
- **THEN** `ProxyDiagnosticsSnapshot` 仍只有固定类别计数，不含盐值或与盐相关的动态标签

### Requirement: 请求体改写只新增前置字段

加盐改写须（SHALL）只做最小侵入：在顶层 JSON object 首个 `{` 之后插入一个成员，保留其余字节、字段顺序、空白与转义。反代绝不（MUST NOT）对 body 做全量重序列化，也不得改动 `model`、`messages` 等既有内容的字节表示。

#### Scenario: 其余字节与字段顺序保留

- **WHEN** 反代对带有效 `model` 的请求体注入 `cache_salt`
- **THEN** 除顶层新增的 `cache_salt` 成员外，请求体其余字节与字段顺序与原始体一致

#### Scenario: 既有失败路径与 path 注入不受影响

- **WHEN** 请求体非法、`model` 缺失/非字符串/为空，或请求超过 10 MiB
- **THEN** 反代保持既有 400 / 413 判定与 path 注入结果，加盐逻辑不改变这些结果

### Requirement: 盐模式三态与覆盖开关

设置页盐配置须（SHALL）提供三种模式：关闭、固定值、自动刷新随机值。默认模式为自动刷新随机值，默认刷新周期 30 分钟。配置另含“覆盖已有 cache_salt”开关，默认不覆盖：关闭覆盖时只在请求体缺少顶层 `cache_salt` 时注入；开启覆盖时用配置盐替换已有值。

#### Scenario: 默认自动刷新 30 分钟

- **WHEN** 设置缓存缺失盐配置，或首次打开 GUI 且无缓存
- **THEN** 盐模式为自动刷新随机值，刷新周期为 30 分钟，覆盖开关为关

#### Scenario: 不覆盖时保留已有盐

- **WHEN** 覆盖开关关闭，且客户端请求体顶层已含 `cache_salt`
- **THEN** 反代不注入也不改写该字段，请求体保持原样

#### Scenario: 覆盖时替换为配置盐

- **WHEN** 覆盖开关开启，且客户端请求体顶层已含 `cache_salt`
- **THEN** 反代把该字段替换为当前配置盐，body 其余字节不变

#### Scenario: 自动模式按周期更换随机盐

- **WHEN** 盐模式为自动刷新随机值，且已跨过配置的刷新周期
- **THEN** 反代对新请求使用新生成的随机盐，不再使用上一周期的盐

### Requirement: 设置页密态推理卡提供盐配置项

设置页“密态推理”功能卡须（SHALL）在 API Key 之外提供缓存盐配置项：模式选择（关闭/固定值/自动刷新随机值）、刷新周期输入（自动模式）、固定值输入（固定模式）与“覆盖已有 cache_salt”开关。周期取有效正整数，固定值按字符串处理；这些文本控件须（SHALL）禁用 WebKit 自动首字母大写与自动更正。

#### Scenario: 三态控件与默认值

- **WHEN** 渲染设置页密态推理功能卡
- **THEN** 出现缓存盐配置项，默认选中自动刷新随机值并显示 30 分钟；固定值输入仅在固定模式可编辑

#### Scenario: 覆盖开关默认关闭

- **WHEN** 首次渲染缓存盐配置项
- **THEN** “覆盖已有 cache_salt”开关为关，且不随模式切换被自动打开

### Requirement: 盐配置持久化且即时生效

盐配置须（SHALL）随设置缓存持久化在设置缓存 `tng` 段下的独立字段中，字段缺失或非法时回落默认值，缓存 `schemaVersion` 保持不变。改动须（SHALL）即时作用于当前运行的反代，不触发 TNG 配置 dirty、不写 `tng-runtime.json`、不重启 tng。自动模式的当前随机盐须（SHALL）只存在于进程内存，不落盘、不回显前端。

#### Scenario: 盐配置随设置缓存恢复

- **WHEN** 用户设置盐模式/周期/固定值/覆盖开关后正常关闭并重开 GUI，且设置缓存有效
- **THEN** 盐配置恢复为关闭前值；缺失或非法时使用默认值，且不影响 API Key 与 TNG 配置的恢复

#### Scenario: 改动即时生效且不重启 tng

- **WHEN** 用户在设置页修改盐配置
- **THEN** 之后经反代转发的请求立即使用新配置，且不触发 TNG 配置 dirty 或 tng 进程重启

#### Scenario: 自动盐不落盘

- **WHEN** 盐模式为自动刷新随机值
- **THEN** 当前随机盐不写入设置缓存或任何文件，GUI 重启后重新生成

## MODIFIED Requirements

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

### Requirement: 密态推理模型与凭据状态不可跨会话持久化

系统须（SHALL）将密态推理的模型清单、选中模型和 UI 会话内模型发现状态作为仅 GUI 会话内的内存态；它们供发送使用，关闭 GUI 后不保留，也绝不（MUST NOT）写入 tng 配置或设置缓存。设置页的 apiKey 须（SHALL）随应用关闭流程写入设置缓存，并在下次 GUI 启动且缓存有效时恢复；apiKey 绝不（MUST NOT）写入 tng 配置或 `tng-runtime.json`。设置页“密态推理”卡 SHALL 保留 API Key 输入框与本规格定义的缓存盐配置项；该输入框 SHALL 默认以密码式遮盖渲染，并提供明确的显隐切换按钮。用户未显式切换前绝不（MUST NOT）明文展示；切换后 SHALL 显示真实值。该卡不得提供复制本地 URL、保存并验证、配置导入/导出、清除本机凭据或其他与凭据无关的额外管理说明；缓存盐配置项按“设置页密态推理卡提供盐配置项”呈现，不属此类说明。

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

### Requirement: 设置页跨会话缓存

系统须（SHALL）在正常应用关闭流程中，于关闭完成前将设置页的已提交状态 flush 到本机应用数据目录内独立的设置缓存文件。缓存内容限定为当前结构化配置模型序列化出的用户侧 TNG 配置、设置页 apiKey 与本规格定义的缓存盐配置（模式、刷新周期、固定值、覆盖开关）；系统绝不（MUST NOT）缓存未点"应用回填表单"的原始 JSON 草稿、`model`、`control_interface.restful` 注入端口、tng 内部监听端口或其他推理 prompt。系统不得（MUST NOT）把该独立缓存文件用作 `tng-runtime.json`，也不得将 tng 内部注入值写入该缓存。

GUI 启动时系统须（SHALL）在渲染设置状态前读取该缓存，并仅恢复通过设置缓存校验的字段：TNG 配置须能按用户侧配置语义回填，且用户可编辑端口保持有效；apiKey 须为字符串；缓存盐配置须为受支持模式且周期为有效正整数，缺失或非法时回落默认值。若校验失败、缓存缺失、schema 不支持、文件损坏或字段不合法，对应字段使用默认模板或空值，GUI 不得（MUST NOT）因此无法启动。恢复缓存只初始化设置状态，绝不（MUST NOT）自动启动 tng、自动重启 tng 或改写控制端口。

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
