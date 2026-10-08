# Spec Delta

## MODIFIED Requirements

### Requirement: tngui 反向代理作为 pre-TNG path 注入代理

系统须（SHALL）在 tng 运行期间由 tngui 自身运行常驻 HTTP 反向代理作为推理对外入口。反代随 tng 启动/停止而启/停，并把推理请求转发到 tng 内部 ingress 本地监听，按本仓库记录的 client-side pre-TNG path 注入行为执行模型 path 注入；跨组件模型语义以中心契约为准，tngui 不另设模型注册或授权语义；响应回传给客户端。系统绝不（MUST NOT）把 tng ingress 本地监听端口直接暴露给外部客户端，也绝不（MUST NOT）链接任何 tng crate。

对 `POST /v1/chat/completions` 与 `POST /v1/messages`，反代须（SHALL）将 body 按 UTF-8 JSON object 解析，读取顶层字符串 `model`，把该确切字符串做单一路径 segment percent-encoding，并把 path 改写为 `/models/{encoded-model-segment}{original-path}`。反代不得对 `body.model` 执行 trim、大小写转换或其他本地格式化。请求 body 字节、query、method 以及 `Authorization`、`x-api-key`、`Content-Type` 须保留。反代须在 `model` 缺失、不是字符串、为空字符串、或 body 不是合法 UTF-8 JSON object 时返回 400；超过 10 MiB 返回 413；以上失败均不得转发 TNG。

对精确的 `GET /v1/models`，反代须（SHALL）作为模型发现例外直接发往当前生效 ingress 指向的 capi origin，不建立到 tng 内部 ingress 本地监听的连接，也不走 OHTTP/path-model 链路。该直连分支是 tngui 的本地模型发现例外：它须（SHALL）保留请求 query 与业务认证头，使用原始 `/v1/models` path，不做模型 path 注入，不生成、读取或使用 `x-model`，并把响应返回给客户端；tngui 不得据此声明全局注册或授权能力。若无法从当前 ingress 得出有效 capi origin，或 capi 连接失败，反代须（SHALL）返回明确的模型发现失败响应，绝不（MUST NOT）静默改经 tng 转发。

反代绝不（MUST NOT）将 `x-model` 用作模型身份；客户端携带的 `x-model` 不得影响 path 注入结果。非模型推理端点的请求不产生模型语义，可按通用反代规则转发。

#### Scenario: 反代随 tng 生命周期启停

- **WHEN** 用户启动或停止 tng
- **THEN** tngui 反向代理随 tng 生命周期启停；未启动时不监听

#### Scenario: OpenAI 请求注入模型路径

- **WHEN** 客户端 `POST /v1/chat/completions` 携带 JSON body `{"model":" model-a "}` 和 `Authorization`
- **THEN** 反代保留 body 中完整原样模型字符串，并把内部请求路径改写为 `/models/%20model-a%20/v1/chat/completions`；path 身份与原 `body.model` 字符串保持一致

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

- **WHEN** 支持端点的 body 缺失 `model`、`model` 不是字符串、`model` 为空字符串，或不是 JSON object
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


## ADDED Requirements

### Requirement: 反代本地诊断快照与 UI 状态

系统须（SHALL）在 tngui 进程内存中为当前 per-TNG 反代维护只读诊断快照，并在“密态推理”视图展示互斥的反代状态：反代未启动时显示“未运行”；反代监听器存在时显示“运行”；上游或本地处理出现失败计数大于零时同时显示“有失败”。快照须（SHALL）至少包含固定类别计数：身份通过、身份拒绝、请求过大、模型发现成功、模型发现失败和上游失败。反代随 tng 会话重启时，诊断快照须（SHALL）重置；系统不得（MUST NOT）把该快照持久化，不得（MUST NOT）把快照发送给外部 collector。

快照的类别与 UI 标签须（SHALL）为固定诊断类别，不得（MUST NOT）携带 prompt、模型输出、raw API key、raw attestation token、模型名或其他业务载荷作为诊断标签。现有模型发现状态不得因诊断快照缺失而变成“空模型清单”，也不得把反代状态或计数误表达为模型授权结果。

#### Scenario: 未启动显示保守状态

- **WHEN** 反代尚未启动
- **THEN** 反代诊断状态显示“未运行”，所有固定类别计数为零或空值，且该状态不声明模型授权或远端健康

#### Scenario: 身份通过累计计数

- **WHEN** 支持的模型推理端点成功解析出顶层 `body.model` 并注入 path
- **THEN** 反代增加“身份通过”计数，但不把模型字符串加入诊断标签或 UI 文案

#### Scenario: 身份失败失败闭合计数

- **WHEN** 支持的模型推理端点因 `model` 缺失、不是字符串、为空字符串或非 UTF-8 JSON object 返回 400
- **THEN** 反代增加“身份拒绝”计数，不建立 TNG 请求，也不泄露具体模型内容

#### Scenario: 超大请求不进入身份用途

- **WHEN** 支持的模型推理端点请求体超过 10 MiB 并返回 413
- **THEN** 系统增加“请求过大”计数，不增加“身份拒绝”，不转发 TNG，也不使用 body 内容作为诊断标签

#### Scenario: 模型发现分类计数

- **WHEN** 精确 `GET /v1/models` 直达 capi origin 成功或失败
- **THEN** 反代分别固定增加“模型发现成功”或“模型发现失败”计数；失败状态保持明确的模型发现失败语义，不伪装成空模型清单

#### Scenario: 展示只读本地诊断

- **WHEN** 用户查看密态推理视图
- **THEN** UI 展示当前反代状态和只读固定类别计数，且不提供把快照导入外部 collector 的操作

#### Scenario: 重启反代重置快照

- **WHEN** tng 与 tngui 反代一起重启
- **THEN** 新反代会话的本地诊断计数从零开始，旧计数不出现在新 UI 快照中
