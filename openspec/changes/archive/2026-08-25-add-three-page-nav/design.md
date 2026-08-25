## 背景

现 App.vue 2 tabs（home/config）；Home.vue 展示三态灯 + /status/ JSON + tng stdout；Config.vue 有结构化配置 + 启动/重启按钮。Agent 核实 tng 推理事实：tng 是**透明隧道**（POST `127.0.0.1:<ingress-port>/v1/chat/completions` + `Authorization` 头 + `{model,messages}` body → 透传到 egress `out` 远端推理 server），无 OpenAI 语义；`/status/` 不暴露 connection/RA 状态；stdout 的 `AccessEstablished` 行（`… — encrypted={bool} attested={bool}`）是真连接+RA信号（现 `RUST_LOG=info` 已被 get_output 捕获）。

用户决：A 启停在概览 + 设置离开放存自动重启；B model+apiKey 不持久化；C 推理不存历史；D RA 状态显示 UI 占位（不接数据）；配置+连接 (i) 真接 stdout grep。

## 目标 / 非目标

**目标：** 3-tab + 概览启停/3 状态块 + 密态推理单次 send/recieve + 设置 model/apiKey/自动保存重启。

**非目标：** model+apiKey 持久化（TODO）；推理历史；RA 真接数据（TODO 接 stdout `attested=`）；搬 project-cluster 的密态推理工作台 UI。

## 决策

### 1. App.vue 三-tab + 共享状态 lift 出 compoable
- 导航 `ref<'overview'|'inference'|'settings'>`；切走时手动调 `beforeLeaveSettings()`。
- NEW `composables/useTngConfig.ts`：`ref<ConfigModel>()` + `lastSavedSerialized` 用于 dirty 检测；模块级 singleton（`useTngConfig()` 返回同一个 ref）。Settings 与 Overview 都读它。
- NEW `composables/useInferenceConfig.ts`：`{model: Ref<string>, apiKey: Ref<string>}`。`init` 默认为空；不持久化（session 内）。和现有 `defaultModel()`（TNG 配置）解耦。

### 2. 概览 Overview.vue（Home 重命名 + 增职责）
除原有 三态灯 + /status/ JSON + tng stdout/stderr 区 外，顶部加 3 个状态块 + 启停按钮：
- **进程状态块**：三态（不可达/启动中/就绪）+ pid —— 复用现有 get_status 分支。
- **配置+连接状态块**：解析 get_output 捕获的 stdout 中是否出现 `encrypted=` 行；出现 `encrypted=true` → "已连接服务端"；否则 → "未建立隧道"。覆盖每次轮询。
- **RA 验证状态块**：UI 占位（静态文案"待接数据"，TODO 标注接 `attested=`）。
- **启动/停止按钮**：
  - 启动：`invoke('launch_tng', {configJson: serialize(useTngConfig.model)})`（沿用现有命令；写盘+spawn）。
  - 停止：`invoke('stop_tng')`（新命令：`supervisor.kill_current()`）。
  - disabled: 未跑则灰禁停止；未配置完整则灰禁启动。
- 保留 tng stdout/stderr 区（概览既是监视+操作页）。

### 3. 密态推理 InferenceView.vue（新建）
- 顶部只读展示 model（来自 useInferenceConfig.model）。
- Prompt `<textarea>`（v-model 绑临时 `ref<string>`）——发送后不清空。
- "发送"按钮：disabled 条件 = `tng 未启动 / 无 ingress 配置 / model 或 apiKey 或 prompt 为空`。
- 输出 `<pre>` 只读：每次发送覆盖；解析响应 `choices[0].message.content`（OpenAI 兼容）。
- 发送经 **Rust 后端**而非 webview fetch（避免 CORS/混合内容）：
  - NEW `invoke('send_inference', {port, model, apiKey, prompt})`：core hand-rolled HTTP POST（与 `fetch_status` 同样的 `tokio::net::TcpStream`）—— POST `http://127.0.0.1:<port>/v1/chat/completions` 带 `Authorization: Bearer <apiKey>` 与 `{model, messages:[{role:'user', content:<prompt>}]}`。返回解析的 assistant 文本（`choices[0].message.content`），泡出 error 给前端展示。
  - 端口：从 `useTngConfig.model.add_ingress` 第一个 entry 取（http_proxy → `proxy_listen.port`，mapping → `in.port`）——一个 computed `inferencePort`。
- RA 过程区：占位 UI（D）。
- 错误：发起失败/超时/非 2xx → 在输出区或独立 Alert 提示。

### 4. 设置 SettingsView.vue（Config 重命名 + 调整）
- 保留现有 结构化配置表单 + 原始 JSON tab + 导入导出 + form-spec 模式渲染。
- **去掉启动/重启按钮**（移到概览）。保留 import/export。
- **底部新增"密态推理"块**：`Model` (`<a-input>`) + `API Key` (`<a-input-password>`)。v-model 绑 `useInferenceConfig`。无管理、无持久化（用户即可直接填即用）。
- **on-leave dirty 自动保存重启**（A）：
  - `useTngConfig` 同时持 `lastSavedSerialized` 快照。
  - 切走设置视由 App.vue `onMenuClick` 预先调 `beforeLeaveSettings()` ——若 TNG 配置 dirty（serialize(model) !== lastSavedSerialized）则 `invoke('save_config', {configJson: serialize(model)})` 写盘；再 `if (tng 在跑) invoke('launch_tng', {configJson: serialize(model)})`（等价 restart）。两步合一：launch_tng 单命令写+spawn 也行；这里拆 `save_config` + 可选 spawn 让"未跑仅存"这件事清晰。
  - dirty 后不管 spawn 与否都将 lastSavedSerialized 更新至新 serialize(model)。
  - model/apiKey 的改动不进 dirty（useTngConfig 仅持有 ConfigModel，不含 model/apiKey）。

### 5. 后端命令（tngui-core + src-tauri/lib.rs）
- **新 `tngui-core` `http_post`**：复用 tokio + HTTP/1.x POST + Authorization/Bearer + JSON body，读 until EOF，返回 `(StatusCode, body_string)`。放进 `status.rs` 或新 `http_client.rs`。
- **新 `send_inference` 命令**（src-tauri）：委托 core.http_post（host 127.0.0.1、port、路径 `/v1/chat/completions`、header `Authorization: Bearer`、body JSON）。返回解析的 assistant 文本或 error。
- **新 `stop_tng` 命令**（src-tauri）：调 supervisor.kill_current。
- **新 `save_config` 命令**（src-tauri）：prepare_config + write_runtime_config，不 spawn。
- **保留** `launch_tng`（exact 现有 logic = save+spawn）。`get_status`/`get_output`/`import_config`/`export_config` 不变。

### 6. 兼容与风险
- "第一个 ingress"假设单 ingress 给推理（多 ingress 用第一个；TODO 允许用户选）。
- send_inference 可能超时（后端默认超时 ~30s 足够推理响应；超时给前端错误）。
- tng 中无对应 ingress 配置 → send disabled + hint "请在设置中加入 ingress 并指向推理服务端"。
- RA "encrypted=" 推断仅在首次请求建立隧道后才有；首次发推理后可视。
- 跨 `ConfigModel` 的 persist-coupling：现有"GUI 启动每次默认模板"与"新 on-leave 写盘"的组合（dirty 才写，未 dirty 不动；GUI 重开每次仍 defaultModel 加载——不持久化用户编辑、但 tng-runtime.json 是个落盘 artifact）。与本仓前置"默认开局模板不持久化"语义一致：模型重渲染时仍用 defaultModel；磁盘 tng-runtime.json 不被回读到 form。后续要"持久化跨会话"作为 TODO。

## 迁移计划

- 纯重命名 + 新增文件（Home.vue→Overview.vue、Config.vue→SettingsView.vue）+ 新建 InferenceView.vue + 新增 composables + 新增后端命令。不破坏既有 spec/行为（host 强制、缺 port 拒绝等保留）。

## 待决问题

- 多 ingress（如推理与控制面 ingress 混在）时是否让 InferenceView 让用户在设置中指定哪个 ingress（或设置里显式"推理 ingress 端口"字段）？本期按"第一个 ingress"，TODO 后续允许指定。
- send_inference 的超时（30s 或更长？）——本期 30s 默认足够大多数推理；超时展示错误。
