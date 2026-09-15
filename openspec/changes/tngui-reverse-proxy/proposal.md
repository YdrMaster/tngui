## Why

密态推理经 api-key 鉴权时，网关要求推理请求携带 `x-model` 头（与客户端 ingress 锁定 OHTTP `header_passthrough` 中已有的 `x-model` 一致）；但当前 tngui 的内置发送（`send_inference`）只把 `model` 放在 body、带 `Authorization: Bearer`，从不注入 `x-model`，外部 AI 客户端直连 tng ingress 时更无人注入——api-key 路由链路缺这一头。同时 tng 的推理服务端口（ingress 本地监听，即 OHTTP 隧道入口）当前对用户可见可配、并直接暴露给客户端，与“tng 全包在内部”（tng 自身端口仅内部可达、对用户隐藏、复用控制端口的空闲探测）的形态不符。需要把 tng 的 ingress 本地监听彻底内部化，改由 tngui 起一个“完整反向代理”对外，并在反代上解析请求体 `model` 注入 `x-model` 头，使任意 OpenAI 兼容客户端经反代即可走 api-key 鉴权的密态推理。

## What Changes

- **tngui 起常驻 HTTP 反向代理**：随 tng 启动而启动、随 tng 停止而停止；对外绑定地址由用户配置（host 经 D1 toggle 在 `127.0.0.1` / `0.0.0.0` 间切换，默认 `127.0.0.1`；port 为用户可配的“本机端口”，沿用现内置默认监听口为默认值）。反代为完整反代：透传 method / path / 头（`Authorization`/`x-api-key`/`Content-Type` 等）与 body，响应原样回传；先支持非流式（OpenAI 兼容默认），流式延后。
- **反代注入 `x-model` 头（以 body.model 为准、覆盖既有）**：对收到请求，读取并解析 JSON body 取 `model` 字段，在转发前设置 `x-model: <body.model>` 头；若请求自身已带 `x-model` 则以 `body.model` 覆盖之（不沿用客户端发来的值），body 不改写。无 `model` 字段的请求不设置/覆盖 `x-model`、原样转发。
- **tng ingress 本地监听彻底内部化**：拉起 tng 前，tngui 用批探测 `pick_free_ports`（见 D4）选取空闲回环端口并先验避让对外端口注入为每条 ingress 的本地监听 `port`、host 强制 `127.0.0.1`（承接既有“ingress 本地监听强制走回环”），覆盖用户任何输入；`prepare_config` 由仅强制 host 扩展为 host+port 双注入。ingress 本地监听 `host`/`port` 不出现在用户配置、结构化控件与原始 JSON 视图（与 `control_interface.restful` 同向向用户隐藏）；外部客户端不直连 tng ingress，而经 tngui 反代。
- **ingress 编辑器行 1 语义切换**：原“本地监听（host 只读 `127.0.0.1` + port）”改为“本机端口 / 反代对外绑定（host 在 `127.0.0.1`/`0.0.0.0` 间 toggle + 对外 port）”——该值是 tngui 反代对外绑定，不进 tng 配置（`prepare_config` 剥离后再注入 tng 内部 ingress 端口）；tng 的真实 ingress 本地监听对用户不可见、不可配。
- **推理对外入口统一经反代**：`send_inference` 与密态推理视图展示的 `API Base URL` 改为指向 tngui 反代对外端点（`http://<反代 bind host>:<对外 port>/v1`）而非 tng 内部 ingress 端口；`x-model` 由反代注入，`send_inference` 退化为不注入头、直接以 `Authorization` + body 发往反代的普通 OpenAI 客户端。
- **D2 框架（设计决策，实现期由 axum 调整为原生 tokio TCP）**：反代以原生 `tokio::net` TCP 实现（无新增依赖、与 `inference.rs` 同向、沙箱离线可编译/可测），随 Tauri 现有 tokio 运行态以 spawned task 托管；评估 `pingora` 后弃用——其面向高并发多上游生产代理、自带连接池/缓存/LB，对本机单跳桌面代理过重；评估 `axum`/`hyper` 后未取——非流式单跳收益不足以抵消新增依赖树。
- **D3 设计（设计决策）**：反代以 tngui-app/tngui-core 内一个 proxy 模块承载，随 tng 生命周期启停，持有对内（`127.0.0.1:<空闲端口>`）与对外（bind host + port）两端点；通过一条 Tauri 命令把对外端点暴露给前端以渲染 `API Base URL`。
- **D4 端口探测（设计决策）**：把内端口取号由单点 `pick_free_port`（取号即放）升级为批取 `pick_free_ports(n)`——顺序 bind n 个 `127.0.0.1:0` listener、同时持住收号、整批释放（保证 n 个互不相同），并对每条 ingress 的反代对外 `out_port` 先验避让、命中即整批重试（有界）。规避单点探测把对外端口（如默认 `18443`）当内部端口注入、tng 先占住导致反代绑对外 `10048` 的实测问题。
- **密态推理调试门锁放宽 + model 迁页（扩展）**：密态推理视图的“可发”门锁由原“`tngReady`（readyz 全绿）+ model + apiKey + 反代端口”放宽为与概览“运行状态”卡相同口径（`deriveIngressStates().runtime === "running"`）AND api-key；`model` 从“设置”视图移除、改为密态推理视图请求面板内可编辑输入（会话内内存、不持久化、退出门锁）。前端新增共享 composable 复用概览同一 `deriveIngressStates` 判定，避免两处漂移。
- **http_proxy 远端拆分主机名+端口并以数组序列化（扩展）**：`域名`（`http_proxy`）远端由单文本 `domain` 改为主机名 + 端口两个控件，`dst_filters` 序列化为 tng 实际接受的数组 `[{domain, port}]`（端口走独立 `port` 字段、不拼进 `domain`）；`proxy_listen` 仍固定 `127.0.0.1` + tngui 批探测注入的空闲端口，不动。反代对外默认端口由 `18443` 改为 `9443`。
- **不在范围内**：不引入流式（SSE/chunked）转发（先非流式）；不改 `ohttp` 锁定协议与 `header_passthrough` 写死的 3 头集合；不改 `no_ra`/`verify` 与远端 `out` 配置语义；不改与 tng 的松耦合——反代是 tngui 自有进程内的 HTTP 服务，仍仅以“拉 tng CLI + 只读控制面 HTTP + 捕获 stdout”与 tng 互动，不链接任何 tng crate。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `gui-shell`：新增“tngui 反向代理对外暴露推理入口并注入 x-model 头”要求；新增“注入端口批探测并避让对外端口”要求；并修改若干既有要求以承接“tng ingress 本地监听内部化（端口经批探测 `pick_free_ports` 空闲探测注入、先验避让对外端口、不外配）”“本机端口语义转为反代对外绑定”“推理发送经反代”——涉及“ingress 本地监听强制走回环”“结构化配置控件”“ingress 控件按行分组呈现”“默认开局模板”“密态推理页面发送并显示推理请求”。；并额外新增 MODIFY——“带配置编辑器与启动控制的 GUI 窗口”“设置页离开时自动保存并自动重启 tng”“密态推理凭据只在 GUI 会话内”，以承接 model 迁出“设置”视图、并在“密态推理页面发送并显示推理请求”中放宽门锁口径为“概览运行态 + api-key”（同步新增“可发判定仅认概览运行态与 api-key”“model 在推理页可编辑且不持久化”等 scenario）。

## Impact

- 后端：`tngui-core/src/config.rs`（`prepare_config` 扩展为对每条 ingress 注入 host `127.0.0.1` + 批探测 `pick_free_ports` 空闲端口、先验避让对外端口、覆盖用户 host/port；剥离用户“本机端口”反代绑定字段不进 tng 配置）；新增反代模块（如 `tngui-core/src/proxy.rs` 或 tngui-app 内模块），以原生 `tokio::net` TCP 实现完整反代 + x-model 注入 + 对内转发 + 对外绑定启动；`tngui-core/src/inference.rs`（`send_inference` 改为发往反代对外端点、不再自注 `x-model`）；新增 Tauri 命令暴露反代对外端点。
- `src/lib.rs`（`launch_tng`：批探测一次取齐 control + 各 ingress 内部端口、注入、启动反代并把对外端点写入 `AppState`；`stop_tng` 停反代；新增 `proxy_endpoint` 命令）；`generate_handler![...]` 注册新命令；`AppState` 增反代句柄/对外端点。
- 端口探测：`tngui-core/src/config.rs` 把 `pick_free_port` 升级/新增为 `pick_free_ports(n)`（占住再放、互不相同、先验避让对外端口、命中重试）；`src/lib.rs::launch_tng` 改为批探测一次取齐 control + 各 ingress 内部端口，`prepare_launch` 接受批端口注入。
- 依赖：**无新增**——反代以现有 `tokio`/`serde_json` 实现原生 TCP HTTP 转发；不新增任何 tng 相关链接依赖。
- 前端：`frontend/src/formspec.ts`/`configmodel.ts`（`EntryModel` 行 1 由“本地监听 host+port”改为“本机端口 host-toggle + 对外 port”；`serialize` 剥离 tng ingress 本地监听、保留反代绑定作为 tngui 侧字段；`parse` 回填相应调整）；`frontend/src/components/EntryEditor.vue`（行 1 控件为 host toggle `127.0.0.1`/`0.0.0.0` + 对外 port）；`frontend/src/views/InferenceView.vue`（`inferencePort`/`localEndpoint` 取自反代对外端点而非 tng 内部 ingress；`onSend`/`send_inference` 经反代）；`frontend/src/tauri.ts`（新增 `proxyEndpoint()` 包装）。
- 文档：`docs/tngui-ui-guide.md`（本机端口现为 tngui 反代对外绑定、tng ingress 本地监听隐藏、推理对外入口经反代、D1 绑定 toggle）。
- 归档序后置依赖：本变更承接 `auto-manage-control-port`（复用回环端口探测、升级为 `pick_free_ports` 批取）与 `lock-ingress-ohttp-drop-egress`/`block-launch-unconfigured-remote`（ingress 锁定形态与按行分组），归档时 spec sync 须在其之后。

- **门锁放宽 + model 迁页（扩展）影响**：`frontend/src/composables/useIngressState.ts`（新增，共享 `deriveIngressStates` 轮询，`Overview.vue` 与 `InferenceView.vue` 同源消费）；`frontend/src/views/Overview.vue`（改用共享 composable，行为不变）；`frontend/src/views/InferenceView.vue`（`usable=tngRunning&&!!apiKey`、model 可编辑、badge 用 `tngRunning`、`fetchProxy` 不再以 ready 为前提）；`frontend/src/views/SettingsView.vue`（删 Model 输入、`clearFeature` 只清 apiKey）。
