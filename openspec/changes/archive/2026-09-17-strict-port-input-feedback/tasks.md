## 1. 组件测试环境与核心校验逻辑

- [x] 1.1 添加 `@vue/test-utils` 和 `happy-dom` 到 `frontend` 的 dev dependencies，并配置 Vitest 组件测试环境
- [x] 1.2 实现端口候选文本计算与合法性判断的纯函数，覆盖追加、粘贴、拖入、选区替换、删除、越界、小数、非数字与前导零
- [x] 1.3 为上述候选逻辑补齐 Vitest 单测，验证 `001`、`0`、`65536`、`12.5`、`abc` 均被拒绝，`1~65535` 均被接受

## 2. PortInput 组件与前端集成

- [x] 2.1 实现 `PortInput.vue`，基于 `a-input` + `beforeinput` 拦截并展示红色错误态
- [x] 2.2 为 `PortInput.vue` 补组件测试，验证非法输入被阻止、非法尝试/必填空值显示错误态、可选端口空值不显示错误态
- [x] 2.3 替换 `EntryEditor.vue` 中的反代对外端口控件，并确认与现有 `min/max/precision` 设置等价的校验语义被保留
- [x] 2.4 替换 `FieldRenderer.vue` 中的 mapping 远端端口与 http_proxy 目标端口控件，保留必填/可选语义
- [x] 2.5 检查 `PortInput` 的 `type`、`inputmode`、`maxlength` 和错误态 class，确认输入法/粘贴/选区替换行为可预期

## 3. 回归、文档与验证

- [x] 3.1 更新 `docs/tngui-ui-guide.md` 中端口输入的交互说明
- [x] 3.2 运行 `npm run test`、`npm run typecheck`，确认无回归
- [x] 3.3 运行或手动冒烟 `PortInput` 的键入、粘贴、拖入、选区替换与失焦行为
- [x] 3.4 运行 `openspec validate strict-port-input-feedback --type change --strict` 并复核 delta spec 与实现一致
