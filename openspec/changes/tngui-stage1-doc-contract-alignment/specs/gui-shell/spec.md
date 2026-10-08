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
- **THEN** 反代不改写 body 尾部空白，并把内部请求路径改写为 `/models/model%20a/v1/chat/completions`； path 身份与原 `body.model` 字符串保持一致

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

### Requirement: ingress 本地监听强制走回环

系统须（SHALL）将每条 ingress 的本地监听 `host` 强制为 `127.0.0.1`、`port` 由 tngui 自动选取并注入——处理 `mapping` 的 `in`、`http_proxy` 的 `proxy_listen`：tngui 在拉起 tng 前以批探测选取空闲回环端口并先验避让对外端口（见"注入端口批探测并避让对外端口"；与"控制面 host 强制走回环地址""管控端口自动选取"同向）注入为该 ingress 本地监听 `port`、host 强制 `127.0.0.1`，覆盖用户任何 host/port 输入。ingress 本地监听 `host`/`port` 不出现在用户配置、结构化控件与原始 JSON 视图（与 `control_interface.restful` 同向向用户隐藏）；外部客户端不直连该 ingress 本地监听端口，而经 tngui 反向代理对外入口（见"tngui 反向代理作为 pre-TNG path 注入代理"）。用户在 ingress 编辑器行 1 所配的"本机端口 + 对外绑定 host"是 tngui 反代对外绑定，非 tng ingress 本地监听。

#### Scenario: 用户缺省或写非回环 listen host

- **WHEN** 用户编写的 ingress 本地监听 `host` 缺省或被设为 `127.0.0.1` 以外的值
- **THEN** 传给 tng 的配置将 ingress 本地监听绑定到 `127.0.0.1`

#### Scenario: 结构化控件中 host 只读

- **WHEN** 渲染 ingress 的结构化控件
- **THEN** tng ingress 本地监听 `host`/`port` 不在结构化控件出现、不可编辑（由 tngui 启动时注入），不再以"host 只读、port 可编辑"形式呈现；行 1 呈现的是 tngui 反代对外绑定（`host` `127.0.0.1`/`0.0.0.0` toggle + 对外 `port`）

#### Scenario: 用户提供的 listen port 被覆盖

- **WHEN** 用户配置中 ingress 本地监听 `port` 存在为某值
- **THEN** 传给 tng 的配置使用 tngui 自动选取的空闲回环端口，而非用户提供的值

#### Scenario: ingress 本地监听对用户不可见

- **WHEN** 渲染"设置"视图的结构化控件或原始 JSON 视图
- **THEN** 界面不展示 tng ingress 本地监听的 `host` 或 `port`（对用户隐藏，由 tngui 启动时注入）；用户可见的"本机端口"是 tngui 反代对外绑定

### Requirement: 注入端口批探测并避让对外端口

tngui 须（SHALL）以批探测为拉起 tng 注入的全部回环端口——`control_interface.restful` 的管控端口与各 ingress 内部本地监听端口——一次性取齐：在同一回环面上**顺序 `bind` `127.0.0.1:0` 共 n 个 listener 并同时持住**（n = 1(管控) + ingress 条数），收集各自分配的端口后**整批统一释放**。因 n 个 listener 同时持在，系统绝不（MUST NOT）出现两个注入端口取到同一端口号。系统须（SHALL）将每条 ingress 的反代对外端口（用户"本机端口"，见"tngui 反向代理作为 pre-TNG path 注入代理"）列为禁止集合：注入的管控端口与各内部端口绝不（MUST NOT）等于任一对外端口。若某次批探测结果命中禁止集合，系统须（SHALL）整批丢弃并重试批探测（有界重试，避免死循环），直到全部不命中为止；重试耗尽则启动失败并明示。

#### Scenario: 批取端口互不相同

- **WHEN** 一次启动取齐 1 个管控端口 + 多条 ingress 的内部端口
- **THEN** 这些注入端口两两互不相同（取号时 n 个 listener 同时持住，无可重复）

#### Scenario: 注入端口避让对外端口

- **WHEN** 批探测取到的某端口等于某条 ingress 的反代对外端口（如默认 `9443`）
- **THEN** 系统整批丢弃并重试批探测，最终注入的管控/内部端口无一等于任一对外端口

#### Scenario: 占住再放避免取号重复

- **WHEN** 批探测执行时
- **THEN** n 个 listener 先全部 `bind` 并同时持住、收齐端口后再统一释放，而非"取号即放、逐个单点探测"

