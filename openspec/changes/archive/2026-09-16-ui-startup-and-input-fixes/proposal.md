## Why

当前桌面窗口以 1440×960 固定逻辑尺寸启动，在常见桌面上显得过大；设置页“密态推理”功能卡的标题与内容间距失衡，影响可读性。同时，mapping/http_proxy 的新建默认远端端口不符合用户预期，而 macOS WebKit 文本输入会自动把英文首字母转为大写。

## What Changes

- 本次发布版本推进到 `0.4.1`；workspace 版本已在当前工作区更新，客户端信息继续以编译期 `CARGO_PKG_VERSION` 展示。
- 桌面主窗口启动时改为最大化呈现；保留 1120×720 最小窗口约束，不再要求 1440×960 作为默认初始尺寸。
- 将设置页“密态推理”功能卡标题区约加高 50%，并保持图标、标题、副标题在标题行内垂直居中。
- 将该功能卡内容区的上下留白约缩短 50%，并将 API Key 输入框由大尺寸改为常规高度；仅调整“密态推理”卡，不影响其他卡片和入口编辑器。
- 将新建或重置的 mapping 远端默认端口从 10000 改为 80；将新建或重置的 http_proxy 远端默认端口从 0 改为 443。导入或用户已配置的显式端口不变，http_proxy 域名前缀的 TLS 派生语义不变。
- 对可输入英文文本的文本框/文本域禁用 WebKit 自动首字母大写；同时禁用自动更正和拼写检查相关行为，避免 macOS 输入法改写用户输入。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `gui-shell`: 调整桌面窗口初始呈现、设置页密态推理卡片布局、ingress 新建/重置默认远端端口，以及前端文本输入的自动大写行为。

## Impact

- 主要影响 `tauri.conf.json`、`frontend/src/assets/theme.css`、`frontend/src/views/SettingsView.vue`、`frontend/src/views/InferenceView.vue`、`frontend/src/components/FieldRenderer.vue` 和 `frontend/src/formspec.ts`。
- 可能影响现有前端端口默认值测试；不改变已有配置导入/导出的显式端口，也不改变反代对外端口 9443 或 TNG 内部注入端口逻辑。
- UI 间距细节需要在桌面构建中做人工视觉验证；macOS 首字母大写修复需要 macOS 环境实测。
