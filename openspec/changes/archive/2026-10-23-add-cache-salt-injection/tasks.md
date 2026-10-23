# Tasks

## 1. 盐策略核心

- [x] 1.1 在 `tngui-core/Cargo.toml` 新增 `getrandom` 依赖，用于生成 128 位随机盐；验证：`cargo build -p tngui-core` 通过，依赖树里只多出这一个 crate。
- [x] 1.2 新建 `tngui-core/src/cache_salt.rs`，定义盐模式（关闭/固定/自动）、盐策略（模式、刷新周期、固定值、覆盖开关）与共享句柄，提供“取当前盐”的入口；验证：单测覆盖关闭返回无盐、固定返回固定值、自动返回非空随机值。
- [x] 1.3 在自动模式实现按周期的惰性轮换：每个请求比较当前时刻与上次生成时刻，超过周期就换新随机盐；验证：单测推进时间跨过一个周期后两次取到的盐不同，周期内两次取到的盐相同。
- [x] 1.4 校验并规整策略输入：周期取有效正整数、固定值按字符串处理、非法输入回落默认（自动、30 分钟、不覆盖）；验证：单测覆盖周期为 0/负数/非数字与固定值为空的回落结果。
- [x] 1.5 在 `tngui-core/src/lib.rs` 导出新模块；验证：`cargo test -p tngui-core cache_salt` 能编译并运行到新单测。

## 2. 反代注入与不泄漏

- [x] 2.1 在 `tngui-core/src/proxy.rs` 实现最小侵入改写：只在顶层 JSON object 首个 `{` 后插入一个 `cache_salt` 成员，盐值用 `serde_json` 转义；验证：单测断言除新增成员外，原体的字段顺序、空白与转义逐字节保留。
- [x] 2.2 实现注入条件：模式关闭不改写；已有顶层 `cache_salt` 且覆盖关闭时不改写；覆盖开启时替换该成员；复用模型解析已得的 `Value` 判断是否已有盐；验证：单测覆盖这四种分支，并断言“已有盐且不覆盖”时请求体与原体逐字节相等。
- [x] 2.3 在 `handle_conn` 的模型解析之后、设置 `Content-Length` 之前接入注入，`start_proxy` 接收共享盐句柄并传给每条连接；验证：单测断言三类端点转发体顶层含 `cache_salt` 且 path 注入结果不变。
- [x] 2.4 验证端点与失败边界不受影响：非推理端点与精确 `GET /v1/models` 不注入；非法/缺失 `model` 仍 400；超 10 MiB 仍 413；验证：单测覆盖这些场景，并断言对应响应码与既有诊断计数不变。
- [x] 2.5 验证不泄漏：转发请求的头集合与未加盐时一致、不含 `cache_salt`；`ProxyDiagnosticsSnapshot` 的字段集合与计数语义不变、不含盐；验证：单测比对加盐前后的头集合与快照。
- [x] 2.6 更新会受影响的既有反代测试：给只验证既有透传语义的测试路由使用关闭盐模式的策略，并重述 `direct_client_body_is_identity_feature_invariant` 的语义为“加盐是唯一允许的 body 增量”；验证：反代测试全绿，含新加的开盐正反用例。
- [x] 2.7 在 `README.md` 的反代段补充加盐行为（注入端点、关闭/固定/自动三态、默认不覆盖、盐只进请求体），并同步 `docs/tngui-doc-boundaries.md` 的本地边界要点；验证：文档只描述 tngui 自身行为，不出现跨仓库引用，术语与规格一致。

## 3. 后端接线

- [x] 3.1 在 `src/lib.rs` 的 `AppState` 增加盐句柄，新增 Tauri 命令接收模式/周期/固定值/覆盖开关并更新句柄；验证：单测断言命令收到非法输入时回落默认值、合法输入后“取当前盐”反映新配置。
- [x] 3.2 在 `launch_tng` 起反代时把 `AppState` 的盐句柄传给 `start_proxy`，使配置在反代运行期间即时可达；验证：现有反代启停与 `launch_tng` 测试通过，新增用例断言改动句柄后反代立即使用新值。
- [x] 3.3 在 `src/lib.rs` 命令注册处挂上新命令；验证：`cargo build` 通过，命令出现在生成的 handler 列表里。

## 4. 前端设置

- [x] 4.1 在 `frontend/src/views/SettingsView.vue` 的密态推理功能卡加入盐配置项：模式三态、周期输入（自动）、固定值输入（固定）、覆盖开关（默认关），并提供生成随机固定值的操作；文本控件带 `autocapitalize=off` 与 `autocorrect=off`；验证：组件测试覆盖默认值（自动/30 分钟/不覆盖）与模式切换后控件的可用性。
- [x] 4.2 在 `frontend/src/settingsCache.ts` 与 `frontend/src/tauri.ts` 的 `SettingsCachePayload` 增加 `tng.cacheSalt`，实现解析与回落（缺失/非法用默认，且不影响 apiKey 与 TNG 配置恢复）；验证：设置缓存单测覆盖完整字段、缺字段、非法字段三种输入，且 `schemaVersion` 仍为 1。
- [x] 4.3 在 `frontend/src/settingsLifecycle.ts` 的 bootstrap 与盐配置改动处调用新命令推送配置；确认盐配置不进 TNG 配置 dirty；验证：生命周期单测断言盐配置改动不触发 `saveConfig`/`launchTng`，bootstrap 会把恢复的盐配置推给命令。

## 5. 集成验证

- [x] 5.1 端到端走一遍：启动 tng 后分别用关闭、固定、自动模式发三类端点请求，确认转发体顶层 `cache_salt` 行为、请求头无盐、诊断快照无盐，且 GUI 密态推理页可正常收流；验证：按 `docs/ant-codespace-testing.md` 在 chroot 内单线程运行全部 Rust 测试与前端测试，结果全绿。
- [x] 5.2 对照 delta spec 逐条核对每个 Scenario 都有对应测试或可观察验证，缺失的补上；验证：规格场景清单与测试用例一一对应。

## 6. 版本发布

- [x] 6.1 把版本号升至 0.4.10 并保持一致：`Cargo.toml`（workspace）、`Cargo.lock`、`frontend/package.json`、`frontend/package-lock.json`；验证：四处版本均为 0.4.10，`cargo metadata` 无版本冲突。

## Workflow follow-up

- 在实现与验证完成后，按项目既有 OpenSpec 流程归档本变更。
- 归档后确认 `openspec/specs/gui-shell/spec.md` 已并入上述 ADDED/MODIFIED 需求。
