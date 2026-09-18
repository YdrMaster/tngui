# Design
## Context

现有 pre-TNG proxy 只维护一条内部 upstream (`127.0.0.1:<internal_port>`)，请求要么对两个推理端点做 `/models/{model}/...` path 注入后进入 tng，要么作为普通 path 进入 tng。密态推理页当前用全局可编辑 `model` ref，用户可任意填写模型名，且发送门锁不依赖该值。capi 的模型发现接口是 `GET /v1/models`，默认远端当前确实是 HTTPS endpoint，并返回 OpenAI 兼容 `{"object":"list","data":[{"id":...}]}`。

## Goals / Non-Goals
**Goals:**

- 在 pre-TNG proxy 中把精确 `GET /v1/models` 分流为 direct capi 请求，同时完全保留现有推理 path 注入和安全链路。
- 从当前 ingress 配置确定 direct capi origin，并尊重 `http_proxy` 已有 TLS 语义与 `mapping` 已有 host/port 语义。
- 把推理页模型控件改成服务端驱动的互斥状态机：loading / loaded-nonempty / loaded-empty / failed。
- 保持模型清单和选中模型为 GUI 会话内状态，不进入设置缓存、TNG JSON 或 runtime JSON。
- 保持 UI 与外部 OpenAI-compatible 客户端共用同一个本地 `/v1/models` 语义。

**Non-Goals:**

- 不为模型发现增加远程证明或 OHTTP。
- 不提供模型清单的搜索后端、权限管理、分页或手工编辑。
- 不改变 `POST /v1/chat/completions` / `POST /v1/messages` 的模型身份契约。
- 不把 API Key 写入 TNG JSON，或把它用于 tngui 自己的模型发现请求。

## Decisions

### D1. 在 pre-TNG proxy 处为 `/v1/models` 做第一优先级分流
`GET /v1/models` 不携带模型身份，也不需要 capi path-model 鉴权；走 tng ingress 会引入 OHTTP/path rewrite 以及不必要的链路依赖。因此 proxy 在读取请求行并完成 body 读取后，先识别 `GET /v1/models`，再进行模型 path 注入判断。

该分流必须是精确匹配：`/v1/models` 直连，`/v1/models/foo` 不走 direct 分支，继续按通用路径处理。若 query 存在，则作为 `/v1/models` 请求的一部分保留。`x-model` 在 direct 分支中一概忽略。

### D2. 从 ingress 计算 direct capi origin，并扩展 route 元数据
现有 `ProxyRoute` 只包含外部 endpoint、内部 port 和 remote Host。需要为每个 route 增加 direct capi origin 元数据，例如 `models_origin`。推荐把 origin 表达为完整的 `Option<String>` 或轻量 `{scheme, host, port}` 结构，而不是把 `remote_host` 复用到底层 HTTP 客户端：

1. `http_proxy`:
   - `ohttp.tls=true` -> `https://<domain>[:<explicit port>]`
   - 无 `ohttp.tls` / `http://` 语义 -> `http://<domain>[:<explicit port>]`
2. `mapping`:
   - `out.host:out.port` -> `http://<out.host>:<out.port>`

`remote_host` 仍继续用于发给 tng 内部 ingress 的 `Host` 头，避免改动既有 recursion 判定语义。若当前配置无法得出 direct origin，models origin 为空，direct 分支返回明确失败而不是改经 tng。

### D3. Direct HTTP client 采用 `reqwest` + rustls
默认 capi 是 HTTPS，当前 proxy 的 raw TCP 实现不会 TLS。实现 direct 分支适合使用一个只作用于模型发现的 HTTP/tls client：

- `reqwest` 提供 URL/DNS/TLS/HTTP 响应解析和 hostname 校验。
- `rustls-tls` 避免绑定系统 TLS 后端，跨平台产物一致。
- 现有 raw TCP proxy 结构继续用于推理端点，避免为 tng ingress 环节引入不必要的变更。

备选方案：

- 手写 raw socket + rustls connector：可以与当前代码风格一致，但需要重新处理 URL 形态、DNS、证书校验、重定向/压缩等 HTTP 客户端细节，不值得。
- 直接在 Tauri 前端 web fetch 远端 capi：会绕开 pre-TNG proxy、受 CORS 与 WebView origin 影响，并且无法为外部客户端提供统一的本地 `/v1/models` endpoint。

### D4. Front-end 状态机由 `/v1/models` 完全驱动
把 `useInferenceConfig` 扩展为模型发现 store，而不仅是 apiKey 加一个可编辑 model ref。推荐保留 `model` ref 作为当前选中的服务端模型 ID，并新增数据请求状态：

```text
LOADING
   | model request
   v
LOADED_EMPTY -> dropdown disabled, selected = "", text "未检测到密态模型"
LOADED_NONEMPTY -> selected = first or current, if current exists
FAILED -> distinct message from loaded-empty
```

一个状态机可以处理 1/0/N 模型和刷新回落：

```text
REQUEST SUCCEEDED
  if ids empty:
      models = []
      selected = ""
      state = loaded-empty
  else:
      models = ids
      selected = current if models.contains(current) else models[0]
      state = loaded-nonempty
```

由于 1 个模型本质上也是“first or current”，单模型和多模型可以走同一条默认选择逻辑。

Only option IDs that are valid strings should be accepted. The UI uses a plain `a-select` options list rather than a combobox, so the search input can at most filter options and cannot become a value.

### D5. UI 请求经 Tauri 后端再走本地 proxy
tngui 下拉应请求本地 pre-TNG proxy，而不是让 WebView 直接访问远端 capi：

1. `InferenceView` observes `proxyEndpoint()` and calls a new `list_models(port)` command.
2. The Tauri command sends a local `GET http://127.0.0.1:<port>/v1/models` request.
3. The proxy direct-branches to capi.
4. The command returns a simple list of model IDs or a clear error string.

The model discovery request from the tngui UI does not attach `Authorization`. This is a deliberate safety decision: the default discovery endpoint is unauthenticated, so keeping the API key away from this bypass avoids an unnecessary credential leak. External clients supplying their own headers are still forwarded through proxy semantics.

### D6. Model discovery is session-only short-lived state
The front-end composable keeps `model`, `status`, and the model list in memory. It does not include them in the settings-cache snapshot. Since `proxyEndpoint` already transiently appears when the tng backend starts, view mount should fetch once per instance and update on transition to a live endpoint. If the endpoint later disappears, switch to failed/not-ready rather than presenting unloaded options. Re-entering the view can refetch the list. No periodic request is necessary.

This keeps current selection stable enough for a test page and avoids complexity in updates from the inference provider. If the model list changes between requests, the state machine will preserve or fall back to the first option as specified.

### D7. Direct response is used as a metadata response, not as a trusted channel
Because `/v1/models` bypasses tng and attestation, UI copy must not present the model list as a trusted inference response. The trust boundary is:

- Model discovery: tngui -> capi direct origin.
- Inference: user request -> tngui pre-TNG proxy -> tng ingress -> OHTTP/RATS-TLS -> capi model path.

This boundary is surfaced in docs and in any state message that mentions discovery.

## Risks / Trade-offs

- [Risk] Adding a TLS client increases dependency surface and release size.
  → Mitigate by using it only in the direct model discovery path; lock the exact regression commands and keep other proxy paths unchanged.
- [Risk] The direct path creates an unauthenticated/unattested metadata exception.
  → Limit the bypass to exact `GET /v1/models`; do not attach the UI API key; preserve all normal protection and model path rules for inference messages.
- [Risk] model list could be empty or transiently fail.
  → Use a strict state machine and treat empty and error differently; empty shows `未检测到密态模型`, failure shows a labeled error; both disable send.
- [Risk] For external clients, direct branch receives user-supplied headers and body.
  → Reuse generic header forwarding only if it does not introduce hop-by-hop headers or connection reuse. Set outbound `Host` from capi origin; preserve query/method; do not read or derive `x-model`.
- [Risk] A model ID could be blank or contain spaces.
  → Ignore blank/whitespace-only IDs; preserve remaining valid IDs byte-for-byte as part of model state. UI displays them as returned and uses them exactly in requests.
- [Risk] Current UI tests are based on free text input.
  → Replace those tests with state-machine tests and keep prompt behavior tests to avoid unrelated regressions.
- [Risk] `GET /v1/models` and `POST /v1/models` or `/v1/models/other` could be mistakenly confused.
  → Keep a highly specific route test: direct path is only GET and an exact path; all other requests follow current generic proxy behavior.

## Migration Plan

1. capi direct branch:
   - Extend route metadata from ingress config.
   - Add direct HTTP client and a small response-settler for proxy.
   - Cover direct/fail cases with proxy tests.
2. plumbing and state:
   - Add Tauri `list_models(port)` command.
   - Add model list parser tests.
   - Replace `InferenceView` free-text field with a command-driven select.
   - Update view tests.
3. docs:
   - README and UI guide mention the model discovery exception and the fact that test-page model selection is not freely editable.
   - Explain the trust boundary: model list is direct discovery; inference remains encrypted.
4. rollback:
   - If the direct branch breaks, commit early-checkout at `GET /v1/models` and the route metadata addition; revert the control branch to generic forwarding and leave other inference and UI code untouched. Since this change is concentrated in `proxy.rs`, `config.rs`, and the InferenceView state machine, rollback scope is clear.
