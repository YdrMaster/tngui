# 任务清单

> 纯视觉重构。Tailwind v4 替代内联 style + AntDV ConfigProvider 主题 + design token CSS 变量 + App shell 美化。不改后端、不改行为。

## 1. 安装 Tailwind v4 + Vite 插件 ✓

- [x] 1.1 `npm install -D tailwindcss @tailwindcss/vite`；建 `assets/theme.css`（首行 `@import "tailwindcss"`）。 ✓ v4.3.3
- [x] 1.2 `vite.config.ts` 加 `tailwindcss()` 插件。 ✓

## 2. 设计 token + ConfigProvider ✓

- [x] 2.1 `theme.css` 追加 `:root` 块（~40 变量：primary/success/warning/error 全色阶 + portal palette + 字体/间距/圆角 + scrollbar）。 ✓
- [x] 2.2 `main.ts` 加 `import "./assets/theme.css"`。 ✓
- [x] 2.3 `App.vue` 根包 `<a-config-provider :theme>`（`colorPrimary:#1677ff` + `borderRadius:8` + `fontFamily` PingFang/YaHei）。 ✓

## 3. App.vue shell ✓

- [x] 3.1 Sider 加右侧描边 + brand 文字 portal-navy 色。 ✓
- [x] 3.2 Content 背景渐变 `linear-gradient(145deg,#fff,#f3f8ff,#f8fbff)`。 ✓
- [x] 3.3 外层 `p-4 overflow-auto` 替代内联 style。 ✓

## 4. Overview.vue Tailwind 化 ✓

- [x] 4.1 外层 `flex flex-col gap-3 h-full`。 ✓
- [x] 4.2 `a-card :bordered="false"` 3 个状态卡。 ✓
- [x] 4.3 状态灯 → Tailwind `w-4 h-4 rounded-full border` + computed `lightBg`(bg-red-500/yellow-400/green-600/slate-400)。 ✓
- [x] 4.4 `.panel` → `rounded-lg border border-slate-200 bg-slate-50/50 p-4`。 ✓
- [x] 4.5 删除 `<style scoped>` 块。 ✓

## 5. InferenceView.vue Tailwind 化 ✓

- [x] 5.1 外层 `flex flex-col gap-3 h-full`。 ✓
- [x] 5.2 `.panel` → Tailwind。 ✓
- [x] 5.3 `<pre>` 加 `font-mono text-xs text-slate-700`。 ✓
- [x] 5.4 删除 `<style scoped>` 块。 ✓

## 6. SettingsView.vue ✓

- [x] 6.1 外层 `flex flex-col gap-3 h-full`。 ✓
- [x] 6.2 `a-card` 保持 AntDV（ConfigProvider 染色 + 圆角自动）。 ✓
- [x] 6.3 无 scoped style 块（跳过）。 ✓

## 7. 验证 ✓ + 端到端 □

- [x] 7.1 `npm run build` 通过（vue-tsc + vite + Tailwind 联合构建）。 ✓ 3172 modules
- [x] 7.2 `npm run typecheck` 无错误。 ✓ (build 内含 vue-tsc)
- [ ] 7.3 (用户机) `cargo tauri dev` → 3-tab UI 可视觉对比：品牌蓝 #1677ff + 8px 圆角 + 渐变背景 + 清爽 sider；功能不受影响。