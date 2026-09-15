## Context

见 `proposal.md - Why`。当前 tng 的推理服务端口（ingress 本地监听 = OHTTP 隧道入口）对用户可见可配、并直接暴露给客户端；`send_inference` 只发 `model` 于 body、带 `Authorization`、从不注入 `x-model`，外部 AI 客户端直连时更无人注入——api-key 路由缺这一头。`control_interface.restful` 已在 `auto-manage-control-port` 中内部化（`pick_free_port` + host 127.0.0.1 注入、对用户隐藏），本变更把同一手法的覆盖面扩到 ingress 本地监听，并由 tngui 起一个常驻完整反代接管对外推理入口。

## Goals / Non-Goals

- Goals：tngui 反代作为推理**唯一**对外入口；`x-model` 由反代从 `body.model` 驱动、且覆盖请求自带的 `x-model`；tng ingress 本地监听彻底内部化（空闲端口注入、对用户隐藏，与 `control_interface.restful` 同向）；D1 对外绑定 host 在 `127.0.0.1`/`0.0.0.0` 间可切（默认本机）；反代随 tng 生命周期启停；与 tng 保持松耦合（反代是 tngui 进程内 HTTP 服务，不链接 tng crate）。
- Non-Goals：流式（SSE/chunked）转发——先非流式；反代不做多上游/负载均衡/缓存/TLS 终止（网关跳仍由既有 OHTTP 负责）；不暴露 tng 的任何端口；不改 `ohttp` 锁定协议与写死的 3 头集合；不改 `no_ra`/`verify` 与远端 `out`；假设单一/首个 ingress 被反代承接（多 ingress 反代多端口不在本次范围）。

## Decisions

### D2 反代框架：原生 tokio TCP

理由：反代只需"读全 body 再注头、转发、回传响应"，单跳、非流式即足够；用 `tokio::net::TcpListener` 直接起对外监听、`tokio::net::TcpStream` 连内部 ingress 端口，手工读请求头与全 body、注入 `x-model` 后以 `tokio::io` 双向管道回传——无任何新增依赖（不引入 axum/hyper/pingora），与 `inference.rs` 同向、沙箱离线可编译可测。tngui 进程已运行于 Tokio 运行态，反代以 `tokio::spawn` 托管的 task 随 `launch_tng`/`stop_tng` 生命周期启停。
实现期由原设计的 axum 调整为原生 tokio TCP：非流式单跳收益不足以抵消 axum/hyper 的新增依赖树，且本沙箱网络受限、新增依赖不可即时编译/测试。
- 备选 pingora：面向高并发多上游生产级反向代理，自带连接池/缓存/LB 与较重原生构建，对本机单跳桌面代理过重——弃用。
- 备选 axum/hyper：可行且体量尚轻，但需新增 crate 依赖——未取（见上）。
- 备选 reqwest：是客户端库、不适配"起一个对外 server"——不适用。

### D3 架构：进程内反代随 tng 生命周期

反代以 `tngui-core` 的一个 `proxy` 模块（或 tngui-app 内模块）承载，启动/停止与 tng 绑定：
- `launch_tng`：以批探测（见 D4）一次取齐 control + 各 ingress 内部端口，经 `prepare_config` 注入并覆盖用户任何 host/port；读用户"本机端口 + 对外绑定 host"作为反代对外绑定；spawn 反代 server 在 `(out_host, out_port)`，upstream 指向 `127.0.0.1:<内部 ingress 端口>`；把对外端点写入 `AppState`。反代绑定失败则整次启动失败（不留下无对外入口而 tng 在跑的状态）。
- `stop_tng`：abort 反代 task。
- 新增 Tauri 命令 `proxy_endpoint()` 把 `(host, port)` 暴露给前端以渲染 `API Base URL` 与 `send_inference` 目标。

### D4 端口探测：批取 n 个回环端口（占住再放）并先验避让对外端口

背景：既有 `pick_free_port()` 是「`bind 127.0.0.1:0` → 取号 → 立即 `drop`」的单点 TOCTOU 探测。本变更要同时注入「1 个管控端口 + 每条 ingress 内部端口」，若仍各自单点取号：多次取号之间无互斥保证、且不避让反代对外端口——实测在 Windows 上单点探测曾把对外端口（如默认 `9443`）当内部端口注入给 tng，tng 先占住该端口、反代再去绑对外 `9443` 即 `10048`/`ADDRINUSE`。

- 批取：新增 `pick_free_ports(n) -> io::Result<Vec<u16>>`——**顺序 `bind` n 个 `127.0.0.1:0` listener 并同时持住**（持住期间 OS 不会把同一端口分配给两个在用 listener，故 n 个必然互不相同），收集各自 `local_addr().port()` 后**统一 `drop` 整批释放**。即"顺序申请 n 个端口再一起释放"，从根上消除取号重复。
- 先验避让对外端口：拉起前算出每条 ingress 的反代对外 `out_port`（用户"本机端口"，默认 `9443`）作为 forbidden 集合；对批取的 `1(管控)+N(内部)` 端口先验，任一 ∈ forbidden 即**整批丢弃重取**（有上限重试，避免死循环）；重试耗尽则启动失败并明示。
- 接线：`launch_tng` 用批探测一次取齐 control + 各 ingress internal；`prepare_launch`接受这组端口注入（控制段 + 各 ingress 的 `in`/`proxy_listen`），不再在 `prepare_ingress_entry` 内各自 `pick_free_port`。最终管控端口与各内部端口两两不同、且无一个等于任一对外端口。
- 取向：仍是回环、对用户隐藏、松耦合——与"控制面 host 强制走回环""管控端口自动选取""ingress 本地监听强制走回环"同向；只是取号方式由"单点取号即放"升级为"批取占住再放 + 先验避让对外 + 命中重试"。

### x-model 处理（以 body.model 为准、覆盖既有）

反代 handler 读取并缓存完整 body（非流式，设上限），解析为 JSON：
- body 含 `model` 字段 → 在转发前设置 `x-model: <body.model>`；若请求**已带** `x-model` 则**覆盖**之（不沿用客户端发来值），body 不改写。
- body 无 `model` 或非 JSON → 不设置/覆盖 `x-model`、原样转发请求与响应（既有的客户端 `x-model` 头原样透传——不构成绕过：`/v1/chat/completions` 缺 `model` 时下游按 OpenAI 规范拒绝）。
- 决策：无 model 的客带 `x-model` 透传而不剥离，与用户给出的"带就覆盖"边界一致（覆盖仅在由 `body.model` 驱动时发生）。备选"无 model 时剥离客带 x-model"为更强隔离，记为可选加固。

### 配置模型：行 1 = 反代对外绑定，tng 本地监听隐藏

- `EntryModel` 行 1 字段由"ingress 本地监听 host+port"改为"反代对外绑定"（`bind_host ∈ {127.0.0.1, 0.0.0.0}` + `out_port`）。`bind_host` 用 toggle（D1），默认 `127.0.0.1`。
- `serialize`：反代对外绑定作为 **tngui 侧字段**保留在用户配置/原始 JSON/导入导出（与 `add_ingress` 平级或单独键，实现所定），**不**进 tng `add_ingress[].mapping.rules[].in`（tng ingress 本地监听由 tngui 注入）。
- `prepare_config`：剥离反代对外绑定（tngui 侧），并对每条 ingress 注入 `in.host=127.0.0.1` + 批探测端口（见 D4，避让对外端口；覆盖用户）。
- `defaultModel`/默认模板：行 1 = 反代对外绑定默认（`127.0.0.1` + 内置默认 port），不含 tng ingress 本地监听端口。

### `send_inference` 退化

`send_inference` 与 InferenceView 改为发往 `proxy_endpoint()` 对外端点，不再自注 `x-model`（反代注入）；退化为普通 OpenAI 客户端。其签名由 `port` 改为取自 `proxy_endpoint`（或统一以端点 host:port）。

### D5 密态推理调试门锁口径与 model 迁页（扩展）

驱动：原 InferenceView 的 `usable = tngReady(s.ready，即 readyz 全绿) && !!model && !!apiKey && proxyPort!==null`，只要 readyz 未绿（远端链路/RA 未就绪）即永久锁死“当前无法发送测试请求”，api-key 怎么填都没用；且把 `model` 拆在设置页又作发送门锁，徒增摩擦。

- 门锁口径改为“与概览左上角‘运行状态’卡同口径”：`usable = tngRunning.value && !!apiKey.value`，其中 `tngRunning = deriveIngressStates(observation).runtime === "running"`（控制面 reachable + `/livez` 与 `/readyz` 均 2xx + 无 attestation/hpke 结构性失败日志 + 无进程错误）。`readyz` 不再单独门控、`proxyPort` 不再独立判定、`model` 完全退出门锁。
- 共享来源：新增 `composables/useIngressState.ts`（轮询 `getStatus` + `getOutput`、内部调纯函数 `deriveIngressStates`），`Overview.vue` 与 `InferenceView.vue` 均消费之，保证“密态推理可发判定”与“概览运行状态卡”为同一函数同一输入、不漂移。`ingressState.ts` / `ingressState.test.ts` 不动。
- model 迁页：`model` 从“设置”视图移除、改为“密态推理”视图请求面板内可编辑输入（`v-model`，会话内内存、不持久化）。`apiKey` 仍在设置视图。`clearFeature` 改为只清 `apiKey` 并更新文案。空 `model` 发送不拦、由下游报真实错误（符合“不再检查其他条件”）。
- 集成 tab“网关状态”badge 由 `tngReady` 改用 `tngRunning`，与表单门锁同源，消除“能发却显示未运行”的矛盾。
- spec 尾随效应：model 迁页牵连多条只存于主 spec 的要求，在 delta 内新增 MODIFY——“带配置编辑器与启动控制的 GUI 窗口”（“设置视图不含启停控件” scenario 的 THEN 由“model/API Key”改为“API Key”；该要求正文末尾残留的旧两视图重复段落及同名重复 scenario 按 openspec “MODIFIED 须保留既有 scenario 名/块”的要求原样保留，不做清理）、“设置页离开时自动保存并自动重启 tng”（`model/apiKey`→`apiKey`）、“密态推理凭据只在 GUI 会话内”（model 由设置页填写/只读→推理页可编辑；按 openspec 须保留既有 scenario 名，故保留“推理页只读 model 且不展示明文 apiKey”这一 scenario 名、仅更新其正文以反映 model 现在推理页可编辑，名称中的“只读”为遗留标签）。

### 反代转发 Host 修正（修 `recursion is detected`）

实测经反代发送推理请求时 tng 回 `400 recursion is detected`：原 `proxy.rs::handle_conn` 把转发给 tng 内部 ingress 的 `Host` 改写为 `127.0.0.1:{internal_port}`——正是 tng 内部 ingress 自身监听地址，tng 据此判“请求发回自己”即递归。原注释假设“tng 按 Host 路由时须为内部端口”，且单测仅用 mock upstream（不触真 tng）掩盖了该问题，真实 tng 才暴露。

修正：`ProxyRoute` 增 `remote_host`（`config.rs::read_remote_host` 取 `mapping` 首条规则 `out.host`、`http_proxy` 取 `dst_filters` 数组首元素 `dst_filters[0].domain`——`dst_filters` 现序列化为数组 `[{domain, port}]`；`mapping` 的 `out.host` 已由 `validate_required_remote` 保证非空 IPv4）；`handle_conn` 转发时 `Host` 设为该远端非本机地址（空串仅见于 http_proxy 未配 domain 的退化情形，退回原内部地址）。x-model 注入与原样转发不变。

### 反代转发 Host 须含 dst 端口（修 tng 按 Host 头定上游端口）

实测（tng 2.9.2）：`http_proxy` ingress 的**转发上游目标完全由请求 `Host` 头（含端口）决定**——`dst_filters.port` 仅参与 ingress 匹配，不决定实际转发端口：

- `Host: domain`（不带端口）→ tng 转发到 `domain:80`（encrypted=false，打到 443 上游时被其前方 WAF / 非 TLS 层拦截）
- `Host: domain:443` + `ohttp.tls=true` → tng 转发到 `domain:443`、`encrypted=true`、推理请求成功返回

因此 `read_remote_host` 行为升级：`http_proxy` 读取 `dst_filters[0]` 的 `domain` **与同一元素的 `port`**，`port` 为有效 1–65535 时返回 `domain:port`、否则返回裸 `domain`（与 serialize 省略非法端口的口径一致）。`ProxyRoute.remote_host` 的语义随之从"远端 host"扩为"远端 host[:port]"（`handle_conn` 把它直接用作 Host 头、无需改动）。`mapping` 分支不改（mapping 转发目标是 `out.host:out.port`，不依赖 Host 头，维持现状以缩小影响面）。

### `ohttp.tls` 派生自域名 scheme 前缀（域名框接受 `http://` / `https://`）

`ohttp.tls` 决定 tng 是否以 TLS 连接上游（对 https 上游必须 `true`，明文上游须缺省）。为让 https 链路从 UI 可用，`http_proxy` 远端域名框接受可选 `http://` / `https://` 前缀，由前缀派生 `ohttp.tls`、并剥离前缀供 `dst_filters.domain`：

| 域名框输入 | 前端内部 `tls` | serialize 的 `ohttp` | `dst_filters.domain` |
|---|---|---|---|
| `https://a.com` | `true` | 带 `tls: true` | `a.com` |
| `http://a.com` | `false` | 不带 `tls`（保持 `ohttp:{}`） | `a.com` |
| `a.com` | `false` | 不带 `tls` | `a.com` |

- `tls` 是前端内部字段（`EntryModel.tls`），不是用户可切换控件，完全由前缀驱动（单一事实来源，避免"前缀"与"开关"两处不一致）；无前缀/= http:// 都不派生 `tls`，与既有明文内部端口（如 30090）部署向后兼容。
- 与"客户端 ingress 锁定 OHTTP 协议"协调：**写死** 的是 `header_passthrough` 三头，`tls` 按上述规则派生；两者同一 `ohttp` 对象内共存（`{ header_passthrough: [...], tls: true }`）。
- `parse` 导入同样读 `ohttp.tls` 回填 `tls`，并在域名框展示时带 `https://` 前缀（`tls=true` 时）——往返一致。

### http_proxy dst_filters 拆分主机名+端口并以数组序列化（扩展）

`域名`（`http_proxy`）远端原为单文本 `domain`（`dst_filters` 序列化为对象 `{domain}`，与 tng 实际 `dst_filters` 数组 schema 不符、且端口无处放）。现改为：主机名 `domain` + 端口 `port` 两个控件；内部模型 `fields.dst_filters` 仍为单一对象 `{domain, port}`（一条 dst），`serialize` 输出为数组 `[{domain, port}]`（端口为空时省略 `port`，`port_match` 即匹配任意端口，tng 接受）；`parse` 同时兼容新数组 `[{domain, port}]` 与遗留对象 `{domain}` 两种输入、统一回填为内部对象。`proxy_listen`（tng 本地监听）仍固定 `127.0.0.1` + tngui 批探测注入的空闲端口，不动（不进用户可见控件、不序列化 host/port）。反代对外默认端口 `DEFAULT_LISTEN_PORT`/`DEFAULT_OUTWARD_PORT` 由 `18443` 改为 `9443`。

## Risks / Trade-offs

- [反代绑定失败导致 tng 在跑却无对外入口] → 反代绑定失败时 `launch_tng` 返回明确错误、不写 tng 在跑状态。
- [缓存全 body 读 `model` 的内存上限] → 设 body 大小上限（如 10 MiB，对齐 `inference.rs` 既有上限），超出拒绝；非流式限定。
- [单点取号与对外端口撞号] → 经 D4 批取占住再放（取号必互不相同）+ 先验避让对外端口 + 命中重试；内部/控制端口绝不等于任一对外端口。
- [0.0.0.0 绑定把推理入口暴露到所有网卡] → 默认 127.0.0.1；0.0.0.0 为用户显式 opt-in；反代自身无鉴权，须在受信网络下使用（网关跳仍由 OHTTP/api-key 保护）。
- [客带 `x-model` 与 `body.model` 不一致] → 由 `body.model` 覆盖兜住；无 `model` 时透传为下游拒绝，不构成 api-key 绕过。
- [MODIFIED 要求须保留既有 scenario 名] → 已在 spec 中逐一保留（结构化配置控件/ingress 控件按行分组/密态推理发送/本地监听回环各保留原 scenario 名并仅更正文），归档 sync 时不可丢。

## Migration Plan

无持久化迁移：本项目"默认开局模板不持久化用户编辑"，无跨会话 schema。落地步骤即任务序：先反代模块 + `prepare_config` 注入，再 launch/stop 接线 + `proxy_endpoint`，再前端模型/控件/视图，再文档与回归。回滚 = revert 本变更 commit（不残留迁移态）。

## Open Questions

- 多 ingress：当前假设单一/首个 ingress 被反代承接，对外只有一个反代端点。若需一条一反代/多端口，再加。可在实现前确认。
- 对外 port 默认值已定为 `9443`（不再沿用旧值 `18443`）。
