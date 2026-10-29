# 提案

## 为什么

最近的 Agent 模式让调试页具备了在用户终端上执行本地工具的能力，但当前默认身份提示词仍只描述“模型推理发生在 TEE 内”，容易让模型把整个 Agent 都理解为受 TEE 保护。实际上 Agent 编排与工具执行位于用户终端、在 TEE 之外；同时推理服务和模型可能缺少 TEE、TNG 与远程证明链路的基础知识，无法仅凭术语正确理解自身运行环境。

## 变更内容

- 替换密态推理调试页的默认身份提示词，在保留原 TEE 推理说明的基础上补充：
  - Agent 框架运行在用户终端、处于用户信任域但在 TEE 之外；
  - 本地工具调用（文件读取、目录浏览、内容搜索等）及工具数据、参数、结果不受 TEE 保护；
  - TEE、TNG 与基于远程证明的链路加密的简要原理；
  - 使用本地工具时主动提醒用户确认工具范围与数据敏感程度。
- 默认身份提示词仍由 `对话模式` 与 `Agent 模式` 共用，注入开关、可编辑性、逐字注入、发送时快照与非持久化语义保持不变。
- 不新增常驻 UI 安全提示；用户关闭注入或改写提示词时自行承担后果。
- 补回并更新 `gui-shell` 中已丢失的“密态推理调试页身份提示词注入”要求，使默认文案与 Agent 边界重新获得持久规格覆盖。
- 同步更新组件测试中的默认提示词断言与 UI 指南。
- 版本从 `0.5.0` 提升到 `0.5.1`，覆盖 workspace 版本、`Cargo.lock` 的四个本地包、`frontend/package.json` 与 `frontend/package-lock.json`。

## 能力

### 新增能力

无。

### 修改能力

- `gui-shell`：更新身份提示词注入要求中的默认身份文案，补充 Agent 的本地工具执行边界、TEE/TNG/远程证明链路说明与工具安全提醒；注入行为本身不变。

## 影响

- 前端：`frontend/src/views/InferenceView.vue` 的 `DEFAULT_IDENTITY_PROMPT`，以及 `frontend/src/views/InferenceView.component.test.ts` 的默认提示词断言。
- 文档：`docs/tngui-ui-guide.md` 的密态推理请求调试说明。
- 规格：`openspec/specs/gui-shell/spec.md` 通过本变更的 delta 补回并更新身份提示词注入要求。
- 版本：`Cargo.toml`、`Cargo.lock`、`frontend/package.json` 与 `frontend/package-lock.json`。
- 不涉及后端命令、事件通道、反向代理、TNG 配置或依赖变化。
