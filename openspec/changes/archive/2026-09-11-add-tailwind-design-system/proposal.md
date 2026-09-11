## Why

当前前端样式纯内联 `style=""`，无色板/间距/字体体系，AntDV 用默认主题（#1890ff 旧蓝+直角），背景纯白——观感"老旧"。需要与一号节点产品线（project-cluster）的设计风格对齐：品牌蓝 #1677ff + 8px 圆角 + 全色阶 design token + Tailwind 工具类布局 + 浅渐变背景。

## What Changes

- 引入 **Tailwind CSS v4**（`@tailwindcss/vite` 插件，Vite 原生、无需 config 文件），Vue SFC 模板用 Tailwind 工具类做布局/间距（替代现有内联 `style=""`）。
- 新建 **`assets/theme.css`**：`@import "tailwindcss"` + 移植 project-cluster 的 `admin-design-system.css` `:root` 块（~100 个 CSS 变量：primary/success/warning/error 全色阶 + 字体栈 + 间距规则 + 组件级 ant-table/ant-input 颜色覆盖）。
- **AntDV ConfigProvider 主题**：在 App.vue 根包 `<a-config-provider :theme>` 设 `colorPrimary: #1677ff` + `borderRadius: 8` + fontFamily `PingFang SC / Microsoft YaHei` + success/warning/error 色对齐。
- **App.vue 布局美化**：Sider 白底 + 右侧 1px 描边 + `backdrop-filter: blur(12px)`；内容区背景 `linear-gradient(145deg, #fff, #f3f8ff, #f8fbff)`。
- **三个 View**（Overview/InferenceView/SettingsView）模板重写：Tailwind 工具类替代内联 style；卡片统一 `rounded-lg` + subtle shadow；各 view 的间距按 8px 网格对齐。
- 统一 `color-scheme: light`（不做 dark mode）。

## Capabilities

### New Capabilities
<!-- 无新能力——纯视觉重构。 -->

### Modified Capabilities
<!-- 无行为变化故无需求变更。skip_specs: true。 -->

## Impact

- **前端构建**：`vite.config.ts` 加 `tailwindcss()` 插件；`package.json` 加 `tailwindcss` + `@tailwindcss/vite` devDeps；`npm install`。
- **前端文件**：`App.vue`（ConfigProvider + 布局重写）、`Overview.vue` / `InferenceView.vue` / `SettingsView.vue`（模板 Tailwind 化）、`main.ts`（import theme.css）、新增 `frontend/src/assets/theme.css`。
- **后端**：不动。
- **Spec**：`skip_specs: true`——纯视觉，不改行为契约。