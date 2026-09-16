## Why

密态推理调试页发送时会把五个流程节点横向一字铺开，响应卡内容宽度有限，节点容易被截断或显得拥挤。需要把发送阶段展示改成更垂直紧凑的单卡转场。

## What Changes

- 把响应卡发送中区域从横向 5 节点流程条改为只显示当前阶段的单张阶段卡。
- 阶段推进时，已到达/经过的当前卡向上淡出，新到达的阶段卡从下方淡入。
- 保留小型阶段进度指示和现有线性进度条，让用户知道当前处于五步流程的哪一步。
- 阶段图标、标题、说明继续复用现有五个安全流程语义，尤其保持“建立加密通道”为 OHTTP/证明表述。
- 在系统偏好减少动态效果时禁用垂直位移/淡动，直接切换阶段内容。
- 不修改推理 API 请求流程、鉴权、响应解析、调试详情或五段安全语义。

## Capabilities

### New Capabilities

- 无：不新增能力目录，只调整既有密态推理页行为。

### Modified Capabilities

- `gui-shell`: 新增密态推理发送阶段的垂直转场呈现要求，补充单阶段卡、方向性切换和减少动效回退行为。

## Impact

- 前端展示：`frontend/src/views/InferenceView.vue`、`frontend/src/components/SecureFlow.vue` 或新发送阶段组件、`frontend/src/assets/theme.css`。
- 行为规格：`openspec/specs/gui-shell/spec.md`。
- 用户文档：`docs/tngui-ui-guide.md` 中请求调试和 SecureFlow 的描述。
- 不修改 Tauri 窗口配置、后端进程管理、反代协议或推理请求格式。
