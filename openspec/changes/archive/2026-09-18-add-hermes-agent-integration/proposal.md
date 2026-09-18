# Proposal

## Why

密态推理页的「AI 客户端接入」导引目前以 DeepSeek Client 为唯一示例，但没有覆盖更完整的 Agent 工作流。Hermes Agent 是开源自主 AI Agent，可通过 OpenAI-compatible custom endpoint 接入 TNG；将该页的客户端导引改为 Hermes Agent，能为用户提供更前沿、更具代表性的接入示例。

## What Changes

- 将密态推理页「AI 客户端接入」中的 DeepSeek Client 示例替换为 Hermes Agent 示例。
- 介绍 Hermes Agent 的定位：Nous Research 开发的开源自主 AI Agent，支持持久记忆、技能自学习、工具调用和多种消息平台。
- 在 Hermes Agent 标题或介绍区提供官方主页链接：`https://hermes-agent.nousresearch.com/`，外链使用 `target="_blank"` 且带 `rel="noopener noreferrer"`。
- 提供一条 `hermes model` 配置 custom endpoint 的操作步骤：
  1. 运行 `hermes model`；
  2. 选择 `Custom endpoint`；
  3. 填写 tngui 反代 API Base URL；
  4. 填写 API Key 与服务端返回的 Model ID。
- 配置示例随当前本地端点动态生成，使用 Hermes `model` 配置形态（`provider: custom`、`base_url`、`api_key`、模型 ID），并继续使用 `/v1/models` 返回的模型 ID。
- 展示用户提供的 Hermes Agent 配置截图。
- 将根目录中的 `hermes-agent-config.png` 移动到 `frontend/src/assets/hermes-agent-config.png`，以 Vite asset import 方式引用；提交后仓库根目录不得继续保留该截图。
- 移除 DeepSeek Client 的文案、CSS 视觉标识和配置示例命名。当前仓库没有已跟踪的 DeepSeek 截图文件；需移除的是模板中的 DeepSeek 视觉/文案引用，而不是额外删除一个不存在的图片文件。
- 同步更新用户手册中的「AI 客户端接入」说明。
- 保留动态 API Base URL、网关状态、监听范围、OpenAI-compatible 协议说明、cURL 示例和“不要填写云端服务地址”警示。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `gui-shell`: 密态推理页「AI 客户端接入」的客户端导引由 DeepSeek Client 变更为 Hermes Agent，新增 Hermes Agent 官方主页链接、产品介绍、接入步骤、Hermes 配置示例和配置截图要求。

## Impact

- Frontend:
  - `frontend/src/views/InferenceView.vue`
  - `frontend/src/assets/theme.css`
  - `frontend/src/views/InferenceView.component.test.ts`
  - New asset: `frontend/src/assets/hermes-agent-config.png`
- Documentation:
  - `docs/tngui-ui-guide.md`
- No backend, Tauri command, TNG JSON schema, inference request, model discovery, API authentication, or remote-attestation behavior changes.
- No new runtime dependency is introduced.
