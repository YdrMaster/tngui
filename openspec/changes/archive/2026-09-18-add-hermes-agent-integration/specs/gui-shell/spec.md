# Spec Delta

## ADDED Requirements

### Requirement: 密态推理页提供 Hermes Agent 客户端接入导引

系统须（SHALL）在“密态推理”视图的“AI 客户端接入”选项卡中提供 Hermes Agent 接入导引。该导引须（SHALL）包含：

- Hermes Agent 标题与简要介绍，说明其为 Nous Research 开发的开源自主 AI Agent，并概括其持久记忆、技能自学习、工具调用和多种对话平台能力。
- 指向 Hermes Agent 官方主页 `https://hermes-agent.nousresearch.com/` 的可访问链接。
- 配置 Hermes Agent custom endpoint 的操作步骤：执行 `hermes model`、选择 `Custom endpoint`、填写 tngui 反代 API Base URL、填写 API Key 和服务端返回的 Model ID。
- 与当前 tngui 反代端点一致的 Hermes 配置示例。
- Hermes Agent 配置截图。
- 继续强调客户端必须使用本地 TNG 地址，不得填写云端服务地址。

系统不得（MUST NOT）在该选项卡中展示 DeepSeek Client 标题、DeepSeek Client 接入步骤或 DeepSeek Client 配置示例。

#### Scenario: 打开 AI 客户端接入选项卡

- **WHEN** 用户进入“密态推理”视图并打开“AI 客户端接入”选项卡
- **THEN** 界面显示 Hermes Agent 介绍、指向 `https://hermes-agent.nousresearch.com/` 的官方主页链接、Hermes custom endpoint 接入步骤、动态配置示例和配置截图

#### Scenario: 使用本地端点和已发现模型生成配置示例

- **WHEN** tngui 反代端点已可用且当前模型清单包含用户选中的模型
- **THEN** Hermes 配置示例使用该反代端点作为 `base_url`、使用 `provider: custom`、使用 API Key 占位说明，并把服务端返回的模型 ID 原样用作模型值
- **WHEN** 反代端点不可用或模型未成功发现
- **THEN** 配置示例在对应字段显示明确的未配置或未发现状态，不伪造可用端点或模型 ID

#### Scenario: 移除 DeepSeek Client 导引

- **WHEN** 渲染“AI 客户端接入”选项卡
- **THEN** 页面不出现 DeepSeek Client 标题、DeepSeek 接入步骤或 DeepSeek 配置示例

#### Scenario: 保持本地接入安全提示

- **WHEN** 用户查看 Hermes Agent 接入导引
- **THEN** 页面保留使用本地 TNG 地址的提示，并明确不得填写云端服务地址
