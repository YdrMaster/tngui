## 1. Backend：端口选取与配置注入

- [x] 1.1 在 `tngui-core/src/config.rs` 新增 `pub fn pick_free_port() -> std::io::Result<u16>`：用 `std::net::TcpListener::bind("127.0.0.1:0")` 取 `local_addr().port()` 后立即 drop 该 listener 返回端口。验证：新增单测 `pick_free_port_returns_loopback_usable_port`——返回的端口落在合法范围且为非 0；`cargo test -p tngui-core` 通过。
- [x] 1.2 重构 `tngui-core/src/config.rs`：分出 `pub fn validate_user_config(user_json: &str) -> Result<Value, PrepareError>`（仅 JSON 解析 + 根对象校验，不再要求/校验 `control_interface.restful.port`）；新增 `pub fn prepare_config(user_json: &str, control_port: u16) -> Result<Value, PrepareError>`，在 `validate_user_config` 基础上缺则建、有则覆盖 `control_interface.restful = {"host":"127.0.0.1","port": control_port}`，保留 `control_interface` 同级与 `restful` 其余键。验证：单测——缺/无 `control_interface` 不再报错且注入后 `host=127.0.0.1`、`port=<注入>`；用户 `host=0.0.0.0/10.0.0.1` → 覆盖为 `127.0.0.1`；用户 `port=99999` → 覆盖为注入 port；`control_interface.ttrpc` 同级保留；`cargo test -p tngui-core` 通过。
- [x] 1.3 清理 `tngui-core/src/config.rs` 错误枚举与注释：移除 `PrepareError::NoRestfulPort`（及不再触达的 `InvalidRestful` 分支）并更新 `Display`/安全收口注释；保留 `InvalidJson`。验证：`cargo build` 无 dead-code/unused 警告阻塞；`cargo test -p tngui-core` 通过。
- [x] 1.4 改 `src/lib.rs::launch_tng`：先 `pick_free_port()`（失败返回说明性错误如"无法分配控制端口"），再 `prepare_config(&config_json, port)`，再 `write_runtime_config` + `supervisor.launch`，最后 `*state.port.lock() = Some(port)`。验证：本地 `cargo tauri dev`（或 `cargo run`）拉起 tng 后状态卡为运行；用 `ss -ltnp`/`lsof` 核对 tng 监听在 `127.0.0.1:<某自动端口>`，且该端口与前端无关。
- [x] 1.5 改 `src/lib.rs::save_config`：改调 `validate_user_config`（不注入端口），写盘为不含 `control_interface.restful` 的用户侧配置。验证：在"设置"页改配置后切走触发保存，检查 `app_data_dir/tng-runtime.json` 不含 `control_interface.restful` 字段；运行中的 tng 不受影响。

## 2. Frontend：模型与序列化去掉 restful

- [x] 2.1 改 `frontend/src/formspec.ts`：`ConfigModel` 去掉 `control_interface.restful`，保留 `control_interface` 同级为 `control_interface_extra: Record<string, unknown>`；`defaultModel()` 不再写 `control_interface.restful`，仍保留一条 `no_ra` 的 `mapping` ingress 示例。验证：`npm run typecheck` 通过；`serialize(defaultModel())` 结果不含 `control_interface.restful`（用控制台或单测核对）。
- [x] 2.2 改 `frontend/src/configmodel.ts`：`serialize()` 输出 `control_interface = { ...model.control_interface_extra }`（无 `restful`）；`parse()` 在导入/回填时丢弃 `control_interface.restful`（`host`/`port`），保留 `control_interface` 同级与其它未结构化字段，且不再因缺 `restful.port` 报错。验证：`npm run test` 通过；新增用例"含 `control_interface.restful` 且含 `control_interface.ttrpc` 的 JSON → restful 丢弃、ttrpc 保留"。
- [x] 2.3 更新 `frontend/src/configmodel.test.ts`：删除"缺 control_interface.restful.port 返回 error"用例与 `host-forced/valid_config_preserves_*` 中断言 `restful.port` 的部分；新增"serialize 不含 `control_interface.restful`"与"parse 丢弃 restful、保留 ttrpc"用例。验证：`npm run test` 全绿。

## 3. Frontend：UI 移除管控端口展示

- [x] 3.1 改 `frontend/src/views/SettingsView.vue`：删除结构化 Tab 中的 `control_interface（host 强制 127.0.0.1）` 卡片（`restful.host` 只读 `a-input` 与 `restful.port` 可编辑 `a-input-number`）。验证：`npm run build` 通过；结构化 Tab 不再出现 `control_interface` 卡片。
- [x] 3.2 改 `SettingsView.vue` 的 TNG Gateway 状态卡：删除只读展示 `127.0.0.1:{{ model.control_interface.restful.port }}` 的"控制面监听"端口文字，保留运行/已连接指示灯。验证：`npm run build` 通过；状态卡不再出现端口号。
- [x] 3.3 清理 `frontend/src` 内对 `control_interface.restful`/`restful.port`/`restful.host` 的一切残留引用（模板与脚本）。验证：`grep -rn "control_interface.restful\|restful\.port\|restful\.host" frontend/src` 无输出；`npm run build` 通过。

## 4. 文档、回归与收尾

- [x] 4.1 更新 `docs/tngui-ui-guide.md`：将"`control_interface`：`restful.host` 强制 127.0.0.1 且不可编辑；`restful.port` 可编辑，tngui 需要该端口轮询状态"等描述改为"管控端口由 tngui 在拉起 tng 时自动选取空闲回环端口并注入，对用户不暴露；配置页不提供 `control_interface` 控件"。验证：文档描述与 spec delta/实现一致；`grep -n "restful.port" docs/tngui-ui-guide.md` 无"可编辑"残留措辞。
- [ ] 4.2 端到端回归：`cargo test`（含 `tngui-core`、`tngui-app`）、`npm run test`、`npm run build`、`npm run typecheck` 全绿；手动运行 GUI：导入一个含 `control_interface.restful` 的旧 JSON → 结构化控件回填且无 restful 卡片、原始 JSON 不含 control_interface.restful → 启动 tng → 运行状态卡正常（无端口展示）→ 状态为"运行"。验证：以上全过。
- [x] 4.3 用 `openspec validate --changes "auto-manage-control-port" --json` 复核 change 合法，`openspec status --change "auto-manage-control-port"` 确认 apply 门槛满足。验证：validate 返回 `valid: true`，status 显示所有 planning artifact 为 done/ready。
