# 任务

## 1. 默认身份提示词

- [x] 1.1 将 `frontend/src/views/InferenceView.vue` 的 `DEFAULT_IDENTITY_PROMPT` 替换为 `gui-shell` 增量规格中的原文；逐字核对实现字符串与规格文本一致。
- [x] 1.2 将 `frontend/src/views/InferenceView.component.test.ts` 的 `expectedIdentityPrompt` 同步为同一文本；运行 `npx vitest run src/views/InferenceView.component.test.ts`，确认身份默认值、关闭注入、编辑、进行中修改和重挂载相关测试通过。
- [x] 1.3 确认 `对话模式` 与 `Agent 模式` 仍发送同一份身份提示词快照；核对现有 `sendInferenceStream` 与 `runAgentMessage` 对 `systemPrompt: expectedIdentityPrompt` 的断言通过，仅在覆盖缺失时补充断言。

## 2. 文档

- [x] 2.1 在 `docs/tngui-ui-guide.md` 第 4.1 节补充身份注入控件、默认提示词作用域和 Agent 本地工具边界；确认指南说明 Agent 编排与本地工具运行在用户终端、位于 TEE 之外，而模型推理在 TEE 内完成并使用基于远程证明的 TNG 链路保护。

## 3. 验证

- [x] 3.1 在 `frontend/` 运行 `npm run typecheck`；确认命令成功退出。
- [x] 3.2 在 `frontend/` 运行 `npm test`；确认前端完整测试套件通过。
- [x] 3.3 运行 `openspec validate "expand-agent-identity-prompt" --type change --strict`；确认变更无校验错误。

## 4. 版本

- [x] 4.1 将 workspace、`Cargo.lock` 本地包、`frontend/package.json` 与 `frontend/package-lock.json` 的版本提升到 `0.5.1`；确认 `cargo metadata --locked --no-deps` 成功，且四个本地包版本均为 `0.5.1`。

## 后续流程

- 评审通过后归档变更；确认归档后的 `gui-shell` 规格包含更新后的身份提示词要求与默认文案。
