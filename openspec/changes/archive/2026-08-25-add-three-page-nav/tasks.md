# 任务清单

> 决定：3-tab 导航（概览/密态推理/设置）；概览启停+3 状态块；密态推理单次 POST+显示；设置去启停+加 model/apiKey+离开 dirty 自动保存重启。RA 显 UI 占位。前端本机可 vue-tsc/vitest 验；Rust 需 webkit 机器。

## 1. 前端骨架 ✓

- [x] 1.1 新建 `composables/useTngConfig.ts`：`ref<ConfigModel>` + `lastSavedSerialized` + dirty detection ✓
- [x] 1.2 新建 `composables/useInferenceConfig.ts`：`{model, apiKey}` refs，不持久化 ✓
- [x] 1.3 `App.vue` 3-tab 导航 + `beforeLeaveSettings()` 自动保存重启 ✓
- [x] 1.4 Home.vue → `Overview.vue`、Config.vue → `SettingsView.vue`、新建 `InferenceView.vue`（Home/Config 已删） ✓

## 2. 后端命令 ✓

- [x] 2.1 tngui-core 新建 `inference.rs`：`http_request`（HTTP/1.x POST）+ `send_inference`（POST /v1/chat/completions 透传） ✓
- [x] 2.2 src/lib.rs 新增 `stop_tng`（kill_current）+ `save_config`（仅写盘）+ `send_inference` 命令 ✓
- [x] 2.3 `invoke_handler!` 注册新命令；既有 5 个不变 ✓

## 3. 概览页 Overview.vue ✓

- [x] 3.1 3 状态块 UI（进程/配置+连接/RA 验证） ✓
- [x] 3.2 启停按钮（启动 disabled via launch + 停止 disabled when not running） ✓
- [x] 3.3 配置+连接状态 dig解析 stdout computed `"encrypted=true"` → connected/未建立隧道 ✓
- [x] 3.4 RA 状态占位 + TODO 注 `attested=` ✓
- [x] 3.5 启动 = launchTng(serializeCurrent)，停止 = invoke('stop_tng') ✓

## 4. 密态推理页 InferenceView.vue ✓

- [x] 4.1 model 只读显示（来自 useInferenceConfig.model，空则提示前往设置填） ✓
- [x] 4.2 Prompt textarea 不清空 ✓
- [x] 4.3 输出只读，每次发送覆盖 ✓
- [x] 4.4 发送按钮 disabled 条件（襟口 judgment） ✓
- [x] 4.5 inferencePort computed（第一个 ingress 的 listen 端口） ✓
- [x] 4.6 发送 = invoke('send_inference', {port, model, apiKey, prompt}) ✓
- [x] 4.7 RA 过程区 UI 占位 ✓
- [x] 4.8 不折叠 UI（非必需） ✓

## 5. 设置页 SettingsView.vue ✓

- [x] 5.1 现 Config.vue 衍生（保留结构化/原始JSON/导入导出；去启动/重启按钮） ✓
- [x] 5.2 TNG 配置 model 用 `useTngConfig`（共享，session 内，all views 读同 model） ✓
- [x] 5.3 新增"密态推理"分组（Model + API Key 输入，绑 useInferenceConfig） ✓
- [x] 5.4 onLeaveSettings (= App.vue 的 beforeLeaveSettings hook) + dirty-check + 写盘 + 若 tng 在跑 自动 restart ✓
- [x] 5.5 "[保存]"实质按钮（onSaveConfig 履行 dirty+restart-if-running） ✓
- [x] 5.6 不加载磁盘 tng-runtime.json 到 form ✓

## 6. 联调 ✓ + 端到端 □

- [x] 6.1 本机 build + vitest + clippy 全绿 ✓
- [x] 6.2 (用户机) cargo tauri dev → 3-tab 导航切换 + 设置离开 dirty+tng 运行中自动重启
- [x] 6.3 (用户机) Ingress 配置推理服务端 → 启动 tng → 密态推理 发送 → 推理输出
- [x] 6.4 (用户机) 关闭重启 tngui → model+apiKey 空 ✓（不持久化）→ 配置 form 仍 defaultModel（不持久化）