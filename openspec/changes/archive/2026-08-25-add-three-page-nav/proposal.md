## Why

把导航改为三页"概览 / 密态推理 / 设置"，让 GUI 从"纯 tng 配置启动器"迈进一步——加一个直接发推理请求的密态推理工作页 + 状态更显式的概览页。概览页承担 tng 进程/连接/RA 验证三态状态展示 + 启停操作；密态推理页直接通过 tng 透明代理发推理请求、显示输入输出；设置页保留 tng 配置编辑、新增推理 model + API Key 输入，且离开时自动保存并自动重启 tng。

## What Changes

- 导航 2 → 3 tabs：**"首页"→"概览"**（Overview）、**新增"密态推理"**（Inference）、**"配置"→"设置"**（Settings）。
- **概览**：新增 3 维状态块（进程、配置+连接、RA 验证）+ 启动/停止按钮（从设置页移入此处）+ 保留 tng stdout/stderr 日志区。
  - 进程状态：三态灯（real /livez /readyz）+ pid。
  - 配置+连接：解析 tng stdout grep `encrypted=true` → "已连接"；未出现过 → "未建立隧道"。
  - RA 验证：UI 占位（D — 不接 stdout 的 `attested=` 数据；TODO 落地真接）。
- **密态推理**：单次作用域 = prompt textarea（不清空、可改可重发）+ 输出区（只读，每次发送覆盖上一次响应）。
  - 发送：`POST http://127.0.0.1:<tng-ingress-port>/v1/chat/completions` + `Authorization: Bearer <apiKey>` + `{model,messages:[{role:user,content:<prompt>}]}`；解析响应取 `choices[0].message.content` 显示。
  - 端口取自 tng 配置模型第一个 ingress（http_proxy `proxy_listen.port` / mapping `in.port`）。
  - RA 过程：UI 占位（D），TODO 从 stdout grep `attested=` 接真数据。
- **设置**：保留现有结构化 TNG 配置 + 原始 JSON + 导入导出（不删）；**移除启动/重启按钮**（移动到概览）；新增"密态推理 model / API Key"两个输入框（不持久化，无增删管理，直接送推理时用）。离开设置 tab 时若 tng 配置 dirty → 写 `tng-runtime.json`；若 tng 正在运行 → 自动重启（kill+spawn 新配置）。

## Capabilities

### New Capabilities
<!-- 无新能力；均为对既有 gui-shell 的变化。 -->

### Modified Capabilities
- `gui-shell`：
  - 导航 2 tab → 3 tab（概览/密态推理/设置）；启动/停止控件迁至概览，设置页不再含启动/重启按钮。
  - "首页"→"概览"不再纯监视：加 启动/停止 按钮 + 进程/配置+连接/RA 验证 三状态块（进程+连接为真接，RA 占位）。
  - 新增密态推理页（通过 tng 透明代理发送 OpenAI 兼容推理请求，显示当次输入输出，不存历史，RA 过程占位）。
  - 设置页新增推理 model + API Key 输入（无管理、不持久化），离开时若 config dirty → 写盘 + tng 在跑自动重启。

## Impact

- **前端**：`App.vue` 改为 3-tab 导航（`overview`/`inference`/`settings`）；`Home.vue` → `Overview.vue`（加启停 + 3 状态块）；`Config.vue` → `SettingsView.vue`（去启动按钮 + 加 model/apiKey 字段 + on-leave dirty 自动保存/重启）；新增 `views/InferenceView.vue`。新增 composables `frontend/src/composables/useTngConfig.ts`（lift TNG 配置 model 全 App 共享）与 `frontend/src/composables/useInferenceConfig.ts`（`model/apiKey` 两 ref，不持久化）。
- **后端（Tauri 命令）**：保留 `launch_tng(config_json)`（写盘+spawn）；新增 `stop_tng()`（kill_current）；新增 `save_config(config_json)`（仅 prepare_config + write，不 spawn）。
- **非目标**：model + API Key 不持久化（TODO）；推理不存历史；RA 状态显示仅 UI 占位（TODO 接 stdout 真实数据）；不复用 project-cluster 的密态推理客户端前端（产品形态不同）。
