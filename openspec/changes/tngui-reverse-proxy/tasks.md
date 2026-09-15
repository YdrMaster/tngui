## 1. 后端：反代模块与 tng 本地监听端口注入

- [x] 1.1 新增 tngui 反代模块（`tngui-core/src/proxy.rs` 或 tngui-app 内模块），以 `axum`（hyper/tokio）起 HTTP server 绑 `(out_host, out_port)`：handler 读取并缓存完整 body（设上限，如 10 MiB）、解析 JSON 取 `model`；body 含 `model` 时在转发前设 `x-model: <body.model>`（若请求已带 `x-model` 则覆盖该既有头、不沿用客户端发来的值）且不改写 body；无 `model` 或非 JSON 时不设/覆盖 `x-model`、原样转发；透传 method/path/其余 header 与 body 到 upstream `127.0.0.1:<内部 ingress 端口>`，响应原样回传（先非流式）。— verify：单测覆盖 含 model 注入 x-model、请求自带 x-model 被覆盖为 body.model、无 model 原样转发、转发到 upstream 与响应回传
- [x] 1.2 扩展 `tngui-core/src/config.rs::prepare_config`：对每条 ingress 注入 `in.host=127.0.0.1` + `pick_free_port` 选取空闲回环端口（覆盖用户任何 host/port，与 `auto-manage-control-port` 同法）；剥离用户侧"反代对外绑定"字段不进 tng 配置。— verify：`cargo test -p tngui-core` 覆盖 host/port 注入、用户值被覆盖、反代绑定字段被剥离、默认模板不含 tng ingress 本地监听端口
- [x] 1.3 `src/lib.rs::launch_tng`：除既有 pick control port 外，对每条 ingress pick 内部端口经 `prepare_config` 注入；读用户"反代对外绑定"(host + port) 启动反代绑 `(out_host, out_port)`、upstream 指向内部 ingress 端口，把对外端点写入 `AppState`；反代绑定失败则整次启动失败、不写 tng 在跑状态。`stop_tng` 停止反代 task。— verify：`cargo check -p tngui-core` 绿（tngui-app GUI 编译在 Windows 验证）；既有状态轮询不变
- [x] 1.4 新增 Tauri 命令 `proxy_endpoint()` 返回反代对外端点 `(host, port)`，并注册进 `generate_handler![...]`。— verify：命令可调用、返回端点（Windows 冒烟确认）
- [x] 1.5 `tngui-core/src/inference.rs::send_inference` 改为发往反代对外端点、不再自注 `x-model`（退化为普通 OpenAI 客户端，仅 `Authorization` + body）。— verify：单测改为向反代端点发请求、断言未自注 `x-model`
- [x] 1.6 端口探测升级为批取（D4）：把 `tngui-core/src/config.rs::pick_free_port` 升级/新增为 `pick_free_ports(n) -> io::Result<Vec<u16>>`——顺序 `bind` n 个 `127.0.0.1:0` listener 并同时持住、收齐端口后统一 `drop` 整批释放，保证 n 个互不相同；`launch_tng` 先算出每条 ingress 的反代对外 `out_port` 作为 forbidden 集合，用 `pick_free_ports(1 + ingress 条数)` 一次取齐（1 个管控 + 各 ingress 内部端口），任一批取结果命中 forbidden 即整批丢弃重取（有界重试）；把取齐的管控端口 + 各内部端口经 `prepare_launch` 一并注入，`prepare_ingress_entry` 改为接受注入的内部端口、不再各自 `pick_free_port`。— verify：`cargo test -p tngui-core` 覆盖 `pick_free_ports(n)` 返回 n 个互不相同、批取结果避让给定 forbidden 集合（命中则重试）、`launch_tng` 注入的管控/内部端口两两不同且无一等于任一对外端口

## 2. 前端：模型 / 控件 / 视图

- [x] 2.1 `formspec.ts`/`configmodel`：`EntryModel` 行 1 改为"反代对外绑定"（`bind_host` toggle 127.0.0.1/0.0.0.0 + `out_port`，默认 `127.0.0.1`）；serialize 时反代对外绑定作为 tngui 侧字段保留（不进 tng `add_ingress[].mapping.rules[].in`）、tng 本地监听 host/port 不进用户序列化；parse 回填相应；`defaultModel`/默认模板行 1 = 反代对外绑定默认（`127.0.0.1` + 内置默认 port），不含 tng ingress 本地监听端口。— verify：`npx vitest run` configmodel/formspec 全绿、含向后兼容解析
- [x] 2.2 `components/EntryEditor.vue` 行 1：host toggle（127.0.0.1/0.0.0.0）+ 对外 port；不展示 tng 本地监听 host/port。— verify：`npx vue-tsc --noEmit` 0 错误 + Windows 手测渲染
- [x] 2.3 `views/InferenceView.vue`：`inferencePort`/`localEndpoint` 取自 `proxyEndpoint()`；`onSend`/`send_inference` 经反代对外端点；curl/deepSeek 示例文案改用反代端点。— verify：`npx vue-tsc --noEmit` 0 错误、渲染无误
- [x] 2.4 `frontend/src/tauri.ts` 新增 `proxyEndpoint()` 包装调用 `proxy_endpoint` 命令。— verify：`npx vue-tsc --noEmit` 0 错误

## 3. 文档与回归

- [x] 3.1 更新 `docs/tngui-ui-guide.md`：本机端口 = 反代对外绑定（host toggle + port）、tng 本地监听对用户隐藏、推理统一经反代、D1 toggle 语义、x-model 由反代按 body.model 注入且对已带 x-model 覆盖。— verify：描述与 spec 一致
- [x] 3.2 前端 `npx vue-tsc --noEmit` / `npx vitest run` 绿；后端 `cargo fmt --check -p tngui-app` + `cargo test -p tngui-core` 绿（tngui-app GUI 编译在 Windows 验证）。— verify：退出码 0
- [x] 3.3 `openspec validate tngui-reverse-proxy` 通过。— verify：退出码 0
- [ ] 3.4 人工冒烟（Windows）：启动 tng → 反代对外端点可达；curl 反代 `/v1/chat/completions`（含 model + Authorization）→ 200、网关收到 `x-model`；客户端自带 `x-model`（与 body.model 不一致）被覆盖为 body.model；0.0.0.0 toggle 可对外、默认 127.0.0.1；外部客户端连接的是反代而非 tng 内部 ingress 端口；tng-runtime.json 中 `control_interface.restful.port` 与各 ingress 内部端口两两不同、且无一等于对外端口（不再复现单点探测占走对外 9443 的 10048）。— verify：观察到如述


## 4. 密态推理调试门锁放宽 + model 迁页（扩展）

- [x] 4.1 新增共享 composable `frontend/src/composables/useIngressState.ts`：轮询 `getStatus()` + `getOutput()`，内部调 `deriveIngressStates`（复用 `frontend/src/ingressState.ts` 纯函数），暴露 `tngRunning`（`runtime === "running"`）、`states`、`statusReport`、`outputLines`；即与概览左上角“运行状态”卡同一判定。— verify：`npx vue-tsc --noEmit` 0 错误
- [x] 4.2 `frontend/src/views/Overview.vue` 改用 `useIngressState()`，替换内联 `poll`/`states`/`tngRunning`/`statusReport`/`outputLines` 相关逻辑（行为不变，仅收敛为单一来源）。— verify：概览四卡与运行状态卡表现与改前一致；`npx vue-tsc --noEmit` 0 错误
- [x] 4.3 `frontend/src/views/InferenceView.vue`：`usable` 改为 `tngRunning.value && !!apiKey.value`（去掉 `tngReady`/`model`/`proxyPort!==null` 门控）；状态轮询改用 `useIngressState()` 的 `tngRunning`、并始终拉 `proxyEndpoint()`（不再以 `s.ready` 为 `fetchProxy()` 前提）；Model 输入由 `disabled` 只读改为可编辑 `v-model="inferenceModel"`；集成 tab“网关状态”badge 改用 `tngRunning`。— verify：概览显示“运行”+填 api-key → 表单可见可发；未运行或未填 api-key → 占位；`npx vue-tsc --noEmit` 0 错误
- [x] 4.4 `frontend/src/views/SettingsView.vue`：删除 Model（`inferenceModel`）输入控件；`clearFeature` 只清 `apiKey` 并改文案“已清除本机 API Key（中心侧 Key 不受影响）”。— verify：设置页密态推理卡无 Model 字段；`npx vue-tsc --noEmit` 0 错误
- [x] 4.5 更新 spec delta `openspec/changes/tngui-reverse-proxy/specs/gui-shell/spec.md`（门锁放宽 + model 迁页的 MODIFY/新增要求，见 design D5）。— verify：`openspec validate tngui-reverse-proxy` 退出码 0
- [x] 4.6 更新 `docs/tngui-ui-guide.md`：密态推理卡只含 API Key、Model 已移至推理调试页可编辑；可用条件改为“概览显示运行 + api-key 已配”（不再要求 model 预填/readyz 单列/反代端口独立判定）；空 model 发送报真实错误。— verify：描述与 spec 一致
- [x] 4.7 前端 `npx vue-tsc --noEmit`（及 `npx vitest run`，含既有 `ingressState.test.ts`）绿。— verify：退出码 0
- [x] 4.8 修 `tngui-core/src/proxy.rs` 转发 Host 递归：原 `handle_conn` 把转发给 tng 内部 ingress 的 Host 改写为 `127.0.0.1:{internal_port}`（即 tng 自身监听地址），触发 tng `400 recursion is detected`。改为经 `ProxyRoute.remote_host` 携带远端目标（`mapping` 的 `out.host` / `http_proxy` 的 `domain`，由 `config.rs::read_remote_host` 提取），转发时 Host 设为该非本机地址。— verify：`cargo test -p tngui-core` 绿（含新增 `read_remote_host` 测试）、`cargo fmt --check -p tngui-core` 绿


## 5. http_proxy dst_filters 拆分主机名+端口并以数组序列化 + 反代默认端口改 9443（扩展）

- [x] 5.1 `frontend/src/formspec.ts`：`DstFilters` 增 `port`；新增 `FieldType="domainHostPort"`；`INGGRESS_FIELDS.http_proxy` 远端由 `domainText` 改为 `domainHostPort`（主机名+端口）；`defaultFields("http_proxy")` 产出 `dst_filters:{domain:"",port:0}`；`DEFAULT_LISTEN_PORT` 由 `18443` 改为 `9443`。— verify：`npx vue-tsc --noEmit` 0 错误
- [x] 5.2 `frontend/src/components/FieldRenderer.vue`：新增 `domainHostPort` 分支（主机名输入 + 端口输入），移除已弃用的 `domainText` 分支。— verify：`npx vue-tsc --noEmit` 0 错误
- [x] 5.3 `frontend/src/components/EntryEditor.vue`：`ensureDstFilters` 兜底为 `{domain:"",port:0}`；内部监听兜默认端口改用 `DEFAULT_LISTEN_PORT`（去硬编码 `18443`）。— verify：`npx vue-tsc --noEmit` 0 错误
- [x] 5.4 `frontend/src/configmodel.ts`：`serialize`（http_proxy）输出 `dst_filters:[{domain,port}]` 数组（端口空省略 `port`）；`parse`（http_proxy）兼容数组 `[{domain,port}]` 与遗留对象 `{domain}`、统一回填内部对象 `{domain,port}`。— verify：`npx vitest run` configmodel 全绿（含数组序列化断言、数组/对象回填、verified config 导入）
- [x] 5.5 `tngui-core/src/config.rs`：`DEFAULT_OUTWARD_PORT` 由 `18443` 改 `9443`；`read_remote_host`（http_proxy）改为读 `dst_filters` 数组首元素 `dst_filters[0].domain`，并兼容遗留对象 `{domain}`；更新 `prepare_launch_default_outward_when_missing` 断言为 `9443`、新增数组 `dst_filters` passthrough 与 `read_remote_host` 数组读取测试。— verify：`cargo test -p tngui-core` 绿、`cargo fmt --check -p tngui-core` 绿
- [x] 5.6 更新 `docs/tngui-ui-guide.md`：http_proxy 远端由单文本域名改为主机名+端口两字段、`dst_filters=[{domain,port}]`。— verify：描述与 spec 一致
- [x] 5.7 `openspec validate tngui-reverse-proxy` 通过；前端 `npx vue-tsc --noEmit` + `npx vitest run` 绿。— verify：退出码 0


## 6. 反代转发 Host 带 dst 端口 + ohttp.tls 派生自域名前缀（扩展）

- [x] 6.1 `tngui-core/src/config.rs::read_remote_host`：`http_proxy` 读取 `dst_filters[0]` 的 `domain` **与同一元素 `port`**（1..=65535 时拼接 `domain:port`，否则返回裸 `domain`）；`mapping` 分支不动；更新 doc 注释与既有数组读取断言为带端口形态。— verify：`cargo test -p tngui-core` 含 Host 端口用例绿
- [x] 6.2 `tngui-core/src/proxy.rs`：`ProxyRoute.remote_host` doc-comment 语义改为"远端 host[:port]"（`handle_conn` 行为不变）。— verify：cargo compile 绿
- [x] 6.3 `frontend/src/configmodel.ts`：`EntryModel.tls` 字段；`parse` 读 `ohttp.tls===true` 回填 `tls` 并从 `dst_filters.domain` 剥离 `http(s)://` 前缀；`serialize`：https→`ohttp` 注入 `tls:true`（含写死 `header_passthrough`），否则 `ohttp` 仅含 `header_passthrough`（`ohttp:{}`）；serialize 输出的 `dst_filters.domain` 不含 scheme 前缀。— verify：`npx vitest run` configmodel 含 tls 派生/前缀剥离/回填用例
- [x] 6.4 `frontend/src/formspec.ts`：`EntryModel` 增 `tls?: boolean`、`defaultFields("http_proxy")` 域名 `"https://"` 默认或提示前缀；`INGRESS_FIELDS.http_proxy` placeholder 说明前缀语义。— verify：`npx vue-tsc --noEmit` 绿
- [x] 6.5 `frontend/src/components/EntryEditor.vue`：`ensureDstFilters` 兼容带 scheme 前缀 input；https 输入不改回写 dst_filters（前缀仅由 tls 字段派生直到序列化）；`defaultFields` 默认含 `https://` 前缀或占位提示。— verify：`npx vue-tsc --noEmit` 绿
- [x] 6.6 `docs/tngui-ui-guide.md`：说明域名框前缀语义（https→tls）与"Host 会带端口"行为；密态推理 curl 示例注明上游对应关系。— verify：描述与 spec 一致
- [x] 6.7 `openspec validate tngui-reverse-proxy` 通过；前端 `npx vue-tsc --noEmit`+`npx vitest run`；后端 `cargo fmt --check`+`cargo test -p tngui-core`；tng 实测 https 上游 Host 带端口推理成功（本地 dragon 大致同型）。— verify：退出码 0 且实测 200
