## 背景

tngui 前端 Vue 3 + AntDV 4.x + Vite 5。当前无 ConfigProvider / 无 CSS 变量 / 无 Tailwind；AntDV 默认主题（旧蓝 #1890ff + 直角）。三个 view 用内联 `style="display:flex;gap:12px"` 控布局，Home/Config 各自有 scoped CSS（`.panel`/`.light`）但风格不统一。

project-cluster 的设计栈（已核验）：antd v5 ConfigProvider(`colorPrimary:#1677ff`, `borderRadius:8`) + `admin-design-system.css`（~100 个 `:root` CSS 变量：primary/success/warning/error 全色阶 + 字体 + 间距 + 组件级 ant-table/ant-input 覆盖）+ Tailwind CSS v4（PostCSS `@tailwindcss/postcss`）+ ProComponents。视觉调性：白色 Sider + 浅蓝渐变内容区 + 8px 网格 + 圆角卡片 + backdrop-filter nav。

## 目标 / 非目标

**目标：** 品牌色 #1677ff + 8px 圆角对齐；Tailwind v4 工具类替代内联 style；Design token CSS 变量统一色板/字体/间距；App.vue 布局美化（渐变背景 + 清爽 Sider）；3 个 View 模板统一化。

**非目标：** dark mode（TODO）；Ant Design ProComponents 移植；图标集（`@ant-design/icons-vue`，待后续按需加）；3D 动画/门户 Banner 页；任何后端/行为变化。

## 决策

### 1. Tailwind v4 via `@tailwindcss/vite`
相比 PostCSS 方案更简洁、Vite 原生插件、无需 `tailwind.config.js`（v4 CSS-first 配置）。`vite.config.ts` plugins 数组加 `tailwindcss()`；`theme.css` 首行 `@import "tailwindcss";`；构建时自动 tree-shake 仅用到的工具类。

### 2. AntDV ConfigProvider 主题
`App.vue` 根包 `<a-config-provider :theme="themeConfig">`：
```
{ token: { colorPrimary: "#1677ff", colorInfo: "#1677ff", colorSuccess: "#52c41a",
           colorWarning: "#faad14", colorError: "#ff4d4f", borderRadius: 8,
           fontFamily: '"PingFang SC","Microsoft YaHei",Arial,sans-serif' } }
```
所有 AntDV 组件（Button/Card/Input/Table/Tag/Steps/Tabs/Modal 等）自动继承。

### 3. Design tokens (`assets/theme.css`)
移植 project-cluster 的 `:root` 变量块（primary/success/warning/error 各 ~10 个色阶 CSS 变量 + link 色 + 字体/间距规则 + 组件级 `.ant-table`/`.ant-input` 颜色 override）。`main.ts` 引入。自定义组件可直接 `var(--color-primary)` 用。

### 4. App.vue shell
- Sider: `bg-white border-r border-slate-200 backdrop-blur-md`（Tailwind）替代现有纯白无描边的 `a-layout-sider`。
- Content: `bg-gradient-to-br from-white via-blue-50/30 to-white` 替代纯白。
- Brand 文字用 `--portal-navy` (#0b1d4f) + `font-semibold text-lg`。
- Menu items 保持 `a-menu mode="inline"` + AntDV 选中态色 #1677ff 自动跟随 token。

### 5. View 模板重写（Tailwind 替代内联 style）
关键替换：
| 旧内联 | 新 Tailwind |
|---|---|
| `style="display:flex;flex-direction:column;gap:12px;height:100%"` | `class="flex flex-col gap-3 h-full"` |
| `style="flex:1;overflow:auto"` | `class="flex-1 overflow-auto"` |
| `.panel { border:1px solid #555; border-radius:6px; padding:8px; ... }` | `class="rounded-lg border border-slate-200 bg-slate-50/50 p-4"` |
| `.light { width:16px;height:16px;border-radius:50%;... }` | `class="inline-block w-4 h-4 rounded-full border border-slate-400"` |
| `style="margin-left:8px;font-weight:600"` | `class="ml-2 font-semibold"` |

保留 AntDV 组件本身（`a-card`/`a-tag`/`a-button`/`a-typography-text`/`a-table` 等）——它们已被 ConfigProvider 主题染好；只在**外层 wrapper** 上用 Tailwind 做布局。

### 6. 删除旧 scoped CSS
`Overview.vue` / `InferenceView.vue` 的 `<style scoped>` 块里那些 `.panel` / `.light` / `.panel-title` 等手写样式，全部被 Tailwind 工具类 + `theme.css` 变量取代 → 删除该 `<style>` 块（或保留极少量 AntDV 无法表达的）。SettingsView 同理（极少手写——只有 gutter 偏移可用 Tailwind）。

### 7. color-scheme: light
`<html>` 或 `:root` 设 `color-scheme: light`。AntDV `theme.defaultAlgorithm`（light）作为唯一模式。Dark mode 留到后续如果用户需要（AntDV 支持 `darkAlgorithm`；但 Tailwind v4 dark mode 需要 `dark:` 变体配置）。

## 风险 / 取舍

- **Tailwind v4 + Vite 5 版本兼容**：最新栈，可能有 minor 迭代；当前稳定（v4 已发布数月）。低风险。
- **preflight vs AntDV 重置**：Tailwind v4 preflight 设 `box-sizing:border-box` + `margin:0` 等；AntDV 组件自带 scoped reset。两者不冲突——preflight 影响 native 元素 + body；AntDV 组件的样式不受 preflight 影响（CSS-in-JS 注入的 specificity > preflight）。低风险。
- **bundle size**：Tailwind v4 只 tree-shake 用到的 utilities + preflight ≈ ~10KB gzip。可忽略。
- **Design token 命名**：project-cluster 用 `--color-primary` 等（antd v5 命名）；AntDV 4 的 CSS-in-JS 生成的是 `.ant-[component]-css-var` 格式。两套变量并存不矛盾——`--color-primary` 给自定义组件用，AntDV 自带的 CSS-in-JS 变量给 AntDV 组件用。
- **视觉不完全等同 project-cluster**：project-cluster 有门户渐变 + 3D 节点 + ProComponents 布局；tngui 用的是轻量版（admin 风格的卡片布局 + 渐变背景）。不追求 1:1 视觉等价，追求"同一种设计语言"。

## 迁移计划

纯视觉重构，Git revert 即可回退。无数据迁移。前端 `npm install` 后 `npm run build` 验证。

## 待决问题

- **图标**：是否本期加 `@ant-design/icons-vue`？倾向**不加**——当前 UI 以文字 + 彩色 Tag 表达状态足够；后续若用户觉得"少图标"再加（只需 `npm install @ant-design/icons-vue` + import per-icon）。
- **font-family 在 Tauri webview 里的可用性**：`PingFang SC`（macOS）、`Microsoft YaHei`（Windows）是系统字体，Tauri webview 直接可用；Linux 无这两个但 fallback `sans-serif` 也够。无需 Web font。