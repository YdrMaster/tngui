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
- [ ] 3.4 人工冒烟（Windows）：启动 tng → 反代对外端点可达；curl 反代 `/v1/chat/completions`（含 model + Authorization）→ 200、网关收到 `x-model`；客户端自带 `x-model`（与 body.model 不一致）被覆盖为 body.model；0.0.0.0 toggle 可对外、默认 127.0.0.1；外部客户端连接的是反代而非 tng 内部 ingress 端口；tng-runtime.json 中 `control_interface.restful.port` 与各 ingress 内部端口两两不同、且无一等于对外端口（不再复现单点探测占走对外 18443 的 10048）。— verify：观察到如述
