## 为什么

TNG 的控制面（`control_interface.restful`）是无鉴权的内部管控接口，理应由 tngui 全权托管、仅回环可达、对用户完全隐藏。现行实现却把 `control_interface.restful.port` 作为"配置"视图的结构化控件暴露给用户，并规定缺端口则拒绝启动——这既向用户暴露了管控端口配置，也把本应自动化的端口选择甩给了用户，与"tng 进程由 tngui 全面管控、禁止外部直接接触/控制 tng"的原则相悖。MVP（`2026-08-22-tngui-mvp-startup/design.md`）当初就把"GUI 自动注入 `control_interface.restful`、用 `127.0.0.1:0` 选空闲端口、向用户隐藏控制面"列为"留到下一轮'配置生成'"的备选——本变更即兑现该轮。

## 变更内容

- **BREAKING（配置契约）：** `control_interface.restful`（host + port）不再由用户提供或编辑；改由 tngui 在拉起 tng 时自动注入——`host` 强制 `127.0.0.1`、`port` 为 tngui 自行选取的空闲回环端口——并覆盖用户输入的任何 host/port。
- 移除"配置"视图结构化中的 `control_interface` 卡片（即 `restful.host` 只读输入 + `restful.port` 可编辑输入那一处配置控件）。
- 移除 TNG Gateway 状态卡里只读展示的 `127.0.0.1:<port>` "控制面监听"端口文字（运行/已连接指示予以保留）。
- 前端配置模型不再承载 `control_interface.restful`：`serialize()` 不再输出 `restful`；`parse()` 不再因缺 `restful.port` 报错，并在导入/解析时丢弃用户提供的 `restful.host`/`port`。
- 后端新增"选取空闲回环端口"能力；`prepare_config` 不再要求用户提供 port、不再因缺 port 报错，改由 tngui 启动时注入；`save_config` 仅持久化用户侧配置（不含 `restful`）。
- **移除约束：** "缺失 `control_interface.restful.port` 即拒绝启动"不再适用于用户输入（因为 tngui 必然注入）；现改为——若 tngui 无法分配空闲回环端口，则拒绝启动并给出明确提示。

## 能力

### 新能力
（无新增 capability；端口自动选取属于 `gui-shell` 既有管控面的实现细节，不单列。）

### 变更能力
- `gui-shell`：管控面归属与端口来源变更——`control_interface.restful` 由 tngui 自有（`host` 强制回环 + 自动空闲端口）、不对用户暴露。据此改写"控制面 host 强制走回环地址""缺失控制端口时拒绝启动""结构化配置控件""原始 JSON 高级视图""默认开局模板""JSON 配置导入导出"等要求。

## 影响

- 后端 `tngui-core/src/config.rs`：`prepare_config` 语义变更（接受注入端口、不再要求用户 port、不再因缺 port 报错）；新增 `pick_free_port()`；`control_port()` 复用；移除/改写 `NoRestfulPort` 错误与 `missing_port_is_error` 测试，新增"注入/覆盖 restful"单测。
- 后端 `src/lib.rs`：`launch_tng` 改为"先选端口 → 注入 → 写盘 → spawn → 写 PortCell"；`save_config` 改为仅校验 + 持久化用户配置（不注入 `restful`）。`get_status`/`fetch_status(port)` 逻辑不变（仍按 PortCell 中的端口轮询回环）。
- 前端 `frontend/src/formspec.ts`：`ConfigModel` 去掉 `control_interface.restful`，保留 `control_interface` 的同级 `extra`（如 `ttrpc`）以维持未结构化字段往返；`defaultModel()` 去掉 `restful`。
- 前端 `frontend/src/configmodel.ts`：`serialize()`/`parse()` 去掉 `restful` 验证/输出，导入时丢弃 `restful.host`/`port`。
- 前端 `frontend/src/views/SettingsView.vue`：删除 `control_interface（host 强制 127.0.0.1）` 卡片；状态卡删除端口文字、保留指示灯。
- 测试：`frontend/src/configmodel.test.ts`、`tngui-core/src/config.rs` 单测相应更新；新增端口注入/覆盖、导入丢弃 `restful` 的单测。
- 文档：`docs/tngui-ui-guide.md` 中"`control_interface`：`restful.port` 可编辑"等描述同步更新。
- 不在范围内：推理用本地透明代理端口（`send_inference` 的 `port`，见 `frontend` 的 `localPort`）与 `control_interface.restful` 是两个不同端口，本变更不触及；`control_interface` 的同级 `ttrpc` 等 advanced 字段维持现状（仍走原始 JSON / `extra` 往返）。
