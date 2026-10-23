# Proposal

## Why

引擎的前缀缓存按文本前缀共享，块键里没有调用者这一维。于是“某段文本是否已经被缓存”会通过命中计数、TTFT、前缀亲和路由等方式露出来，成为跨调用者的侧信道。防御手段是给每个请求带一个缓存分区键 `cache_salt`：盐相同的请求才可能复用彼此的缓存块。tngui 的本机 pre-TNG 反代就在调用侧，应该在进入链路加密之前把这个字段写进请求体，并让用户能控制盐怎么来。

## What Changes

- 反代对 `POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/responses` 三类端点，在解析出有效 `body.model` 之后、转发给内部 ingress（进入链路加密）之前，向请求体顶层写入字符串字段 `cache_salt`。其余端点与精确 `GET /v1/models` 直连分支不注入。
- 默认加盐，但无盐请求照常处理：tngui 不检查、也不因缺少盐而拒绝或降级。
- 盐来源三态，在设置页配置：关闭、固定值、自动刷新随机值；默认自动刷新，每 30 分钟一次。
- 是否覆盖请求体里已有的 `cache_salt` 可配置，默认不覆盖（只在缺少时注入）。
- 盐只进请求体（内层密文），不进请求头、outer metadata、日志、错误详情或 `ProxyDiagnosticsSnapshot`；自动模式当前的随机盐不落盘、不回显前端。
- 请求体改写是对既有“字节原样保留”的有意例外：只在顶层 JSON object 首个 `{` 后插入一个成员，字段顺序、空白、转义、`model` 与 `messages` 的内容都不动。既有 `body.model` path 注入、非法/缺失 `model` 的 fail-closed、超 10 MiB 的 413、非推理端点透传与 `GET /v1/models` 直连分支都保持不变。
- 设置页的“密态推理”功能卡新增盐配置（模式、刷新周期、固定值、覆盖开关），随设置缓存持久化，改动即时生效，不触发 tng 重启，也不计入 TNG 配置 dirty。
- 设置缓存的 `tng` 段新增盐配置字段，缺失时回落默认值；不提升缓存 `schemaVersion`，避免升级时清空既有 API Key。
- 更新自包含的 `README.md` 反代段与本地文档边界要点，用 tngui 自己的说法描述加盐行为。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `gui-shell`：反代从“请求体字节原样保留”改为“默认注入 `cache_salt` 的最小侵入改写”，并新增可配置的盐模式、刷新周期与覆盖开关；设置页“密态推理”功能卡从只承载 API Key 扩展为同时承载盐配置；设置缓存与 dirty 语义相应扩展。

## Impact

- 代码：`tngui-core/src/proxy.rs`（注入与盐状态）、新增盐策略模块、`tngui-core/Cargo.toml`（新增一个随机源依赖）、`src/lib.rs`（`AppState` 盐句柄、配置命令、启动接线）、`frontend/src/views/SettingsView.vue`、`frontend/src/settingsCache.ts`、`frontend/src/tauri.ts`、`frontend/src/settingsLifecycle.ts` 及对应测试。
- 行为：三个推理端点的请求体会多出顶层 `cache_salt`；关闭盐模式、或已有盐且不覆盖时，请求体可保持字节不变。其余端点、失败路径与诊断快照不变。
- 依赖：新增一个跨平台随机源依赖，用于生成自动模式的盐值。
- 文档与规格：`openspec/specs/gui-shell/spec.md`（delta）、`README.md`、`docs/tngui-doc-boundaries.md`。
- 非目标：不实现服务端加盐、校验或拒绝逻辑；不新增或改写 `x-model`；不链接任何 tng crate；不改变 tng 配置与远端授权、路由语义。
