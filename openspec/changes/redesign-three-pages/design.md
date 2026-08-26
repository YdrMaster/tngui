## 背景

tng-client (`../tng-client/`) 是 React 19 + antd v5 + Vite 的产品原型（477 行 App.tsx + 205 行 styles.css + types.ts + mock.ts），和 tngui 是**同一定位的桌面客户端**。其设计已用 `styles.css` 形式落地：~60 个视觉规则覆盖品牌/状态卡/加密流水线/架构图/安全徽章/代码块/加密边界。tngui 现有三页视觉单薄。

用户决：A=(i)全量替换 3 view UI 设计 + 保留 tngui 已有的 raw stdout + TNG 结构化配置；B=不搬演示控制台；C=不加首次安装向导；D=引入 `@ant-design/icons-vue`。本 change 是纯视觉重构——后端 / 行为不改、无 spec delta。

## 目标 / 非目标

**目标**: 3 view UI 全量对齐 tng-client 设计语言，新组件 StatusCard / SecureFlow / ArchitectureFlow / ProtectionItem / Brand + ~60 CSS 规则 + 22 图标；保留 tngui 真实日志面板与 TNG 配置结构化编辑器。

**非目标**: DesktopTitleBar、演示控制台 Drawer、首次安装向导 Modal、后端 API 变更、行为变化、spec 需求新增/修改、RA 真实数据接入（SecureFlow 只做"模拟动画 + 真实响应文本"的混合）。

## 决策

### 1. 框架映射 React+antd → Vue 3+AntDV
| tng-client | tngui 实现 |
|---|---|
| React SFC 函数 `function X(...) { return <.../> }` | Vue 3 单文件 SFC `const props=defineProps<...>(); defineEmits`...+`<template>` |
| React `useState` / `useMemo` / `useEffect` / `useRef` | Vue `ref` / `computed` / `onMounted`+`onBeforeUnmount` / `ref(null)` + `.value` |
| antd v5 ConfigProvider theme | AntDV 4 `<a-config-provider :theme>`（已实现，token 染色已起作用） |
| antd v5 `Card/Steps/Tabs/Collapse/Drawer/Modal/Progress/Timeline/Descriptions/Badge/Tag/Tag/Form/Input/TextArea/Button/Result` | AntDV 4 同名 `<a-...>`（API ~1:1） |
| `@ant-design/icons` 22 种 | `@ant-design/icons-vue` 同名（`<SafetyCertificateOutlined>` 模板组件） |
| `Layout.Sider / Content` + width/ theme | `<a-layout-sider width=.. theme=..>` |
| `App.useApp().message` | AntDV `message` 函数 import from `ant-design-vue` |
| `className="abc xyz"` | `class="abc xyz"` |
| `style={{ ...obj }}` | `:style="{ ...obj }"` 或 `style="...inline..."` |
| `slot={...}` children | Vue slot（named slot `<template #title>...</template>`），或把渲染拆 `<a-card.Meta>` 等 |

### 2. CSS 移植策略
tng-client `styles.css` 的 ~60 个 `.class { ... }` 块直接**全量追加**到 tngui `assets/theme.css`（Tailwind import 之后），保留原 class 名（避免重名精准复刻）。Tailwind 工具类继续用于布局微调（grid-template-columns 直接用原始 CSS）。这样 tng-client 视觉过渡无失真。

> 注：tng-client 的 CSS 多用 `.ant-xxx` 全局覆盖（antd class 名）；AntDV 4 与 antd v5 class 名相同（都叫 `.ant-card`），所以覆盖规则同样生效。

### 3. Mock 数据 / 真实数据对照
| tng-client Mock | tngui 真实数据 |
|---|---|
| `gatewayInfo.version = '2.7.3'` | 取 `Cargo.toml workspace.package.version`（hardcode 或后端 `get_gateway_info`——本期 hardcode `0.2.0-dev`，TODO 后端接口） |
| `gatewayInfo.localEndpoint = 'http://127.0.0.1:8080/v1'` | `computed(() => http://127.0.0.1:${inferencePort}/v1)` 从 `useTngConfig().model.add_ingress[0].proxy_listen.port` |
| `gatewayInfo.listenAddress = '127.0.0.1:8080'` | 同上，去掉 `/v1` |
| `gatewayInfo.platform = 'macOS 15.6 · Apple Silicon'` | `navigator.userAgent` 简化 或字面 `Desktop` —— 优先 `navigator.platform`（Tauri webview 有），fallback `Desktop` |
| `gatewayInfo.model = 'Qwen3-32B-Instruct'` | `useInferenceConfig().model` |
| `gatewayInfo.apiKeyMasked = 'msk_live_…8F2A'` | `useInferenceConfig().apiKey.slice(-4)` 前并 mask 前 12 |
| `secureSteps` 5 步 | 直接移植为 tngui 常量 `frontend/src/data/secureSteps.ts`（描述不变） |
| `mockResponse = 'Mock 'mock 文本` | `send_inference` 返回的 assistant 内容（真实响应） |
| `curlExample` | 动态：`curl http://127.0.0.1:${port}/v1/chat/completions \ -H ... -d '{ "model": "${model}", ...}'` |
| `deepSeekClientConfig` | 动态同 |
| 6 个 DemoScenario | 不搬；tngui 用真实 `light.value`（red/yellow/green）映射（gatewayDown=red; ready=green; pending=yellow; fresh & invalidKey = frontend inline "请前往设置"） |

### 4. SecureFlow 真实动画
`SecureFlow` 是 5-step 水平 pipeline 视图；状态 `activeIndex` 从 0 步推进到 4 步，每步 0.5s 切。在 tng-client 中通过 `useState(0)` + `setInterval` 模拟；tngui `InferenceView.vue ` （子页 RequestDebugPanel）：
- 提交 `send_inference` 时 `set phase(0)`；然后 `setInterval` 每 0.5s phase++。如果 phase 到 4 还没收到响应，停在 "等待响应..." 状态；收到 `send_inference` 返回时 phase=4 + 显示 response。
- 失败时 phase 回到 failState（如 1），显示 `failed` class。
- SecureFlow 组件本身是纯受控（接 phase prop），props `activeIndex: number` + `failed: boolean` + `current?: step数据`。

### 5. 样式覆盖的 antd CSS
部分 `.ant-card` / `.ant-form-item` 等 antd v5 全局 class 覆盖（来自 tng-client 的 styles.css 中）——直接保留在 tngui `theme.css` 里；AntDV 4 用同一套 class 名，全局 CSS 工作。

### 6. 模板/图标 import
22 个 `@ant-design/icons-vue` 图标直接在.vue 文件里 `import { SafetyCertificateOutlined, DashboardOutlined, ... } from "@ant-design/icons-vue"`; 模板用 `<SafetyCertificateOutlined />` 当组件。不需要全局注册。

### 7. 设置页保留 TNG 结构化配置
- tng-client 设置只给 localPort + outboundAddress 两个简单字段；tngui 真实需求 ingress/egress 等更多——`SettingsView.vue` 在功能卡 "密态推理" 下追加一节 "高级 TNG 配置" 包含现有 `a-tabs`（结构化/原始 JSON 两视图 + ingress/egress 列表 + 导入导出）。
- `SettingsView.vue` 拆解布局：顶部 TNG Gateway card → 功能配置"密态推理"功能卡 → 高级 TNG 配置（现有 tabs）→ 客户端信息卡。

### 8. 概览页 tng stdout 区位置
tng-client 模态日志窗，适合 Mock。tngui 实时，直接内联在 Overview：在 primary-card 下方（或并列右侧）。需求：是 visible-not-modal。按用户"可以放在独立 layout" 的提示，可以在 primary-card 下面独立画 panel（类似 t-client 的"查看网关日志" Modal 的内容，但直接 widen 在 Overview 里）。

## 风险 / 取舍

- **AntDV vs antd CSS class 差异**: AntDV 4 也叫 `.ant-*` 大多 class 一致；个别 props `bordered` vs `variant="outlined"` API 稍不同。实施时按 AntDV 文档调整。
- **Tailwind v4 + ~60 自定义 CSS**: 两者叠加在 `theme.css` 中 → 行数变大（~270 行 Tailwind + tokens + 60 行 styles）。文件大小可接受（gzip <6KB）。
- **SecureFlow 模拟时长 vs 实际请求时延**: 5 步每步 0.5s = 2.5s；真实推理可能 1-5s。如果同步：`setInterval` walk to phase 4 后再等真实 response fill。如果异步响应先到：phase 立即跳 4 填入。如果 response err：设 phase=1 failed。一致实现。
- **后端 tng info 接口 跳过本期**: 版本/platform 等显示信息用硬编码 "v0.2.0-dev / Desktop"。
- **后续 RA 才进状态真接**（用户 D 之前说占位），SecureFlow 作为"模拟动画"用于视觉呈现 + 真实响应填入下方——不声称 SecureFlow 步子对应真实 RA 状态。

## 迁移计划

纯 UI 重构、对前端 build/CI 无 ls 草稿（依赖只加 @ant-design/icons-react）。可 git-revert 回退。

## 待决问题

- **首次 callTark俄国 tngplatform 的来源**: `navigator.platform` 在 Tauri webview 可能不准——用 `navigator.userAgent` 简化（Win/Mac/Linux）。设为静态 "Desktop" 最安全；按真实值显示非硬需求，铺 UI 即可。(By：本期用 ua 简化 OK)
- **StatusCard 的 "本地 TNG 网关" 显示 tng PID? 用状态灯 tone 显示 hue? 不主动把进程 pid 显示详细到 UI**（tngui 后端 `get_status` 不知道 pid——pid 是 Rust `ManagedChild.pid` 没暴露给前端；若要展示需新命令）。本期: **不显示 pid**，配合 tng-client "运行中 / 未运行" 二态展示。
- **`Ant-card.Meta` available?** AntDV 4 有 `a-card.Meta`——逐步复刻即可。