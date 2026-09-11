## Why

当前 tngui 三页的视觉层次纯靠"3 荫性质文字卡 + 原生 textarea/pre 输出"支撑，层次单薄且缺品牌感。`../tng-client/` 是同产品的 React 原型，视觉方案成熟：含动画 SecureFlow 5步管线 + ArchitectureFlow 3域2段图 + TLS对比表 + 品牌侧栏 + 彩色状态卡 + 脉冲 安全徽章 + AI 客户端接入导引 + 加密边界列表——整套设计语言已定义为 `.styles.css` + 实现为 React 组件。本次将其全量移植为 Vue 3 SFC + AntDV 4 组件。

迁移时**同时保留**tngui 已有的两块 tng-client 缺失或较弱的真实控件功能：① 概览的 tng stdout/stderr 实时日志框、② 设置页的 TNG JSON 配置结构化编辑器（form-spec + ingress/egress + 原始 JSON 双视图）。

## What Changes

### 全局
- 新增 `@ant-design/icons-vue` devDep，模板可 `import { ... } from "@ant-design/icons-vue"` 引入 22+ 图标。
- 入口 `theme.css` 扩展：追加 tng-client `styles.css` 里 ~60 条自定义视觉规则（`.brand` / `.brand-mark` / `.status-card` / `.status-icon` / `.secure-flow` / `.flow-node` / `.flow-line` / `.trust-zone` / `.secure-segment` / `.architecture-flow` / `.protection-item` / `.boundary-row` / `.compare-grid` / `.primary-card` / `.secure-badge` / `.pulse-ring` / `.code-block` / `.gateway-state` / `.feature-card` / `.feature-icon` / `.endpoint-box` / `.runtime-mini` 等），其中能用 Tailwind 表达的用 Tailwind 替代（`flex` / `gap` / `p-*`），专有视觉（pulse 动画 / 渐变背景 / 流线虚线动画）保留原生 CSS。
- App.vue 改造：Sider 加 Brand（盾形图标 + 可信网关 / TNG GATEWAY 中英双标题 + `linear-gradient(145deg,#1677ff,#4096ff)` + drop-shdow)；底部加 runtime-mini（badge + 状态 + XMPP信息 模拟）；Content 顶部加 top-strip（背景 backdrop-filter blur + badge + 检查更新按钮 placeholder）。
- 不搬 DesktopTitleBar（Tauri 自带原生窗口框架，不需 web mock）；不搬演示控制台；不加首次安装向导；不搬 Mock 6-scenario 切换（tngui 有真实后端场景就够）。

### Overview 概览
完全替换为 tng-client `OverviewPage` 设计：
- 3 个 **StatusCard**（图标 + 标签 + 徽章 + 运行值 + 详细 + tone + 可选 action）；分别映射到: 本地 TNG 网关（真是 light state） / XMPP 控制信道（占位待真接） / 本地访问（显示 127.0.0.1:port）。
- 1 张 **primary-card**（主画面）："TNG Gateway 已在本机就绪" + 本地 API Base URL endpoint-box + 复制 + 网关设置引导；右侧附 secure-badge 圆形 pulse-ring 蓝色徽章；after-element 是 radial-gradient 光晕。
- 沿用 tngui 已有：启停按钮 + tng stdout/stderr 区放在 primary-card 下方（TNG 进程输出区，独立 rounded-lg panel，tng-client 也有该位置放日志模态，但 tngui 已有实时展示更对齐"概览", 不走 Modal 而走页面直接展示）。
- 沿用 tngui 已有：/status/ JSON panel 也保留（信息密度更细节，放日志区右上或并列）。

### 密态推理 InferenceView 页
完全替换为 tng-client `ConfidentialInferencePage` 3 子标签：
- **请求调试**：左侧 form（model readonly + prompt textarea + 发送按钮）；右侧响应区：
  - 发送时使用 **SecureFlow** 5-step 动画（含 progress bar + phase title + description），步骤映射到 tngui 的实际流程本地→封装→通道→推理→解密；进度跟着真实 send_inference 请求时间（或者 mock 节拍比真接 tng 时返回时延，简单先做"模拟"展示 + 返回时填入 send_inference 真实响应）；响应成功时显示 `200 OK` tag + 解密标记；失败时显示 BlockingAlert "API Key 无效 / 网关异常"。
- **AI 客户端接入**：DeepSeek status 描述 + API Base URL (来自本地 port) + 兼容协议 tag + 4 步接入步骤 + 配置参数 pre + cURL 示例 pre（dark code-block）；底加 "不要填写云端地址" 警示 Alert。
- **安全说明**：SecurityPanel 完整移植：
  - security-hero：Result（success/error/info）+ "网络看不到 / 宿主机读不到 / 伪造节点连不上" 大文案 + 四色彩 tag 矩阵；
  - **ArchitectureFlow** 3 域 2 段图（客户域 + Gateway TEE + 推理引擎 TEE，中间两段 RATS-TLS 密文段动画线 packet）；
  - **ProtectionItem** 列两列卡片（"两段链路如何验证" + "推理中如何保护"）；
  - **加密边界**列表 + **RATS-TLS vs TLS 对比表** + **可信证据 Descriptions**（三个 Tab）。

### 设置 SettingsView 页
合并 tng-client 设置视觉 + tngui 已有的结构化控件：
- **TNG Gateway** 卡（top-status 3 badges + 重启/查看日志/导出日志按钮导入诊断包；其中查看日志按钮可以关联 tngui 的实时 stdout 区，但 tngui 已有概览直接展示，此处的"查看日志"做成打开 Modal + 或简化为 "查看实时输出 → 跳转概览"）。
- **功能配置** section：tngui 保留现有"密态推理"功能卡（model + API Key），布局沿用 tng-client 的 feature-card 设计（feature-icon + "已启用" tag + security info Alert + Key input prefix + 高级端口/outboundAddress collapse）。
- **保留 tngui 现有**：结构化 TNG JSON 配置（form-spec + ingress/egress + no_ra + 原始 JSON + 导入导出）作为设置的第二大节——标题"高级 TNG 配置"（tng-client 仅给本地端口+出向地址，tngui 真实需 ingress/egress，远超 tng-client）。
- **客户端信息** 卡片（版本/OS/更新通道）。

### 后端
不改 backend (现有命令已足够)。可选优化：新增 `get_gateway_info` 返回 tng version/listenAddress/platform 等展示用信息，但本期设为前端静态赋值（version 取 Cargo.toml版本或写死"v0.2.0-dev"等；listenAddress 取 useTngConfig 的 port；platform 用 navigator.oscpu 或简化"Desktop"）。**下一轮再做 tauri info 命令接口**。

## Capabilities

### New Capabilities
<!-- 无新能力——纯 UI 重构 + 保留现有功能。 -->

### Modified Capabilities
<!-- 视觉重构不改行为；且 skip_specs: true。 -->

## Impact

- **前端文件**: `App.vue`（Brand + top-strip + runtime-mini）；`Overview.vue`（StatusCard + primary-card + secure-badge + 沿用 stdout）；`InferenceView.vue`（3 子标签 SecureFlow + IntegrationPanel + SecurityPanel）；`SettingsView.vue`（TNG 卡 + 密态推理功能卡 + 保留结构化控件）；`main.ts`（引依赖）；`theme.css`（+60 视觉规则）。
- **新增组件**: `components/StatusCard.vue` / `SecureFlow.vue` / `ArchitectureFlow.vue` / `ProtectionItem.vue` / `Brand.vue`（或在 App.vue 里 inline，待实现时定）。
- **新增依赖**: `@ant-design/icons-vue` (@types not needed - bundled).
- **后端**: 不改。
- **Spec**: `skip_spec: true`。