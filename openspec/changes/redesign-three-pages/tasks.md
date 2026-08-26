# 任务清单

> 纯 UI 重构 + 保留 tngui 已有功能。移植 tng-client React 设计为 Vue 3 + AntDV SFC。不搬 演示控制台 + 首次安装向导 + Mock 6-scenario。

## 1. 引入图标依赖 + 移植 CSS 视觉规则 ✓

- [x] 1.1 `npm install -D @ant-design/icons-vue` ✓ (3 packages)
- [x] 1.2 tng-client `styles.css` 全 205 行追加到 tngui `theme.css`（~60 class：brand/status-card/secure-flow/architecture-flow/protection-item/boundary-row/compare-grid/primary-card/secure-badge/pulse-ring/code-block/gateway-state/feature-card/feature-icon/endpoint-box/runtime-mini/top-strip/tab-intro/… + antd 覆盖 + 响应式 + reduced-motion）✓
- [x] 1.3 合并 :root（tngui `--color-*` 原有变量 + tng-client `--primary`/`--primary-soft`/`--bg-layout`/`--text*`/`--border`/`--split`/`--shadow`/`--success`/`--warning`/`--error` 新增）+ 统一 body → background #e9edf2 / min-width 1180px / scrollbar ✓

## 2. App.vue shell 改造 ✓

- [x] 2.1 Sider 内 `sidebar` class + Brand（shield-icon + brand-mark + "可信网关"/"TNG GATEWAY" 双行）✓
- [x] 2.2 sidebar-menu Button(图标+label)+design height 42 + left aligned ✓
- [x] 2.3 sidebar-bottom `runtime-mini`（营商环境 badge + 运行中/未运行 + XMPP 状态 动态来自 pollRuntime get_status 轮询2s）✓
- [x] 2.4 Content 顶 top-strip（sticky+backdrop-blur+badge+检查更新占位）✓
- [x] 2.5 不含 DesktopTitleBar ✓

## 3. Overview.vue 全量替换 ✓

- [x] 3.1 PageHeader（概览标题 + "重新检测"按钮）✓
- [x] 3.2 3 StatusCard（本地 TNG 网关 / XMPP 控制信道 / 本地访问 with icon + badge + detail + tone + action copy + gotoSettings）✓
- [x] 3.3 primary-card（"TNG Gateway 已在本机就绪" + endpoint-box + 复制 + 网关设置 → gotoSettings + 启停按钮都 inline 在 primary-card 内）✓
- [x] 3.4 secure-badge 圆形 pulse-ring （条件 tone 由 tngReady 控制 success/error 色）✓
- [x] 3.5 配置+连接 / RA 验证 2 状态块 + 启停按钮保留（内联到 primary-card）✓
- [x] 3.6 /status/ JSON 保留 in 独立 a-card panel ✓
- [x] 3.7 tng stdout/stderr 保留 in 独立 a-card panel ✓
- [x] 3.8 安全说明引导 Alert → "进入调试" button ✅

## 4. InferenceView.vue 全量替换 + 3 sub-tab ✓

- [x] 4.1 PageHeader + debug-workbench card + 3 Tabs ✓
- [x] 4.2 SecureFlow 组件新建 + secureSteps.ts 常量 ✓
- [x] 4.3 Tab 请求调试：usable gate + model readonly + prompt textarea + 发送 with SecureFlow 5-step animation phase(0→4) + Progress + 响应 override + history-notice Alert ✓
- [x] 4.4 Tab AI 客户端接入：IntegrationPanel with Descriptions(API Base URL + 网关状态 + 监听范围 + 兼容协议) + DeepSeek_steps + cURL example computed + deepSeekClientConfig computed + "不要填写云端地址" warning ✓
- [x] 4.5 Tab 安全说明：SecurityPanel security-hero(Result+title+tag matrix) + ArchitectureFlow + 加密边界列表 + TLS 对比表（compare-grid 6×3 grid） + 可信证据 Descriptions + Alert ✓
- [x] 4.6 新建 components：SecureFlow.vue / ArchitectureFlow.vue / ProtectionItem.vue / StatusCard.vue ✓

## 5. SettingsView.vue 改装 ✓

- [x] 5.1 PageHeader "设置" ✓
- [x] 5.2 TNG Gateway Card（3 gateway-state badge + 重启+查看日志+导出日志+导出诊断包按钮占位）✓
- [x] 5.3 功能配置 section heading "已启用 1 个功能" Tag ✓
- [x] 5.4 feature-card 密态推理（API Key input + show/hide + 保存+复制+导入+导出按钮 + Model 输入 + 清除配置）+ ConfigJsonModal ✓
- [x] 5.5 高级 TNG 配置：结构化 a-tabs（control_interface / ingress+EntryEditor / egress+EntryEditor）+ 原始 JSON textarea + 保存 + 导入导出 ✓
- [x] 5.6 客户端信息卡（客户端版本/操作系统/更新通道 Descriptions）✓

## 6. 验证 ✓ + 端到端 □

- [x] 6.1 `npm run build` 通过（vue-tc + vite + Tailwind v4 + @ant-design/icons-vue 联合构建）✓ 3181 modules
- [x] 6.2 `npm test` vitest 10/10 pass ✓
- [x] 6.3 `cargo clippy -p tngui-core -D warnings` cleanPass ✓
- [ ] 6.4 (用户机) `cargo tauri dev` → 3-tab 视觉对比（StatusCard with icons / pageHeader h3 / primary-card 节点彩虹 / SecureFlow 5步 / ArchitectureFlow 3域2段 / compare-grid / TLS证据 / feature-card / setting tabs / client-info / sidebar Brand + top-strip + runtime-mini / stdout in overview / send inferenc 真发）、功能完整（启动/停止 / 密态推理 send 真实响应 / 配置 dirty 自动保存重启）