# Tasks

## 1. 品牌区布局

- [x] 1.1 修改 `frontend/src/App.vue` 的品牌区标记：第一行保留品牌图标和“可信网关”，第二行紧随其后单独渲染 “Trusted Network Gateway”；通过源码检查和 `npm run typecheck` 验证。
- [x] 1.2 调整 `frontend/src/assets/theme.css`：品牌图标容器圆角改为 `border-radius: 4px`，品牌区使用紧凑两行布局且英文全名不被截断或溢出 196px 侧边栏；通过浏览器或 UI 检查复核。
- [x] 1.3 增加或更新品牌区组件断言，覆盖两行结构、英文全名完整出现在第二行，以及图标容器圆角为 `4px`；通过 `npm test` 中相关前端测试验证。

## 2. 参考值服务地址

- [x] 2.1 将 `frontend/src/formspec.ts` 中 `DEFAULT_RVS_URL` 改为 `https://rvs.cloud.misuan.com`，并更新 `formspec.test.ts`、`configmodel.test.ts` 与 `settingsCache.test.ts` 中默认值断言；通过相关测试验证。
- [x] 2.2 修改 `frontend/src/components/RemoteAttestationServiceConfig.vue`：label 改为“参考值服务地址”，删除 technical `extra` 文案，placeholder 改为 `https://rvs.cloud.misuan.com`；通过组件测试验证时可见标签为“参考值服务地址”、input `placeholder` 同步。
- [x] 2.3 更新受影响的 Settings 测试和现有含旧默认地址的自定义 RVS 值断言，确保显式旧地址仍优先于默认地址；通过 `npm test` 验证。

## 3. 文档与规格一致性

- [x] 3.1 更新 `docs/tngui-ui-guide.md` 中品牌区描述、RVS 地址显示名称、默认地址和 technical extra 描述，保持与 GUI 行为一致；通过人工通读验证。
- [x] 3.2 复核 specs 中的 RVS 显示名和默认地址，与 `DEFAULT_RVS_URL` 及 placeholder 完全一致；通过 `openspec validate ui-brand-and-rvs-copy --type change --strict` 验证。
