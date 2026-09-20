# Design

## Context

侧边栏当前宽度为 196px，品牌区把图标、“可信网关”和 “Trusted Network Gateway”放在同一行，英文名右侧空间不足。品牌图标容器当前样式在 `frontend/src/assets/theme.css` 中定义。

参考值服务地址由 `frontend/src/formspec.ts` 的 `DEFAULT_RVS_URL` 提供默认值；`RemoteAttestationServiceConfig.vue` 提供可见入口。该地址仍随设置缓存恢复，并由后端启动流程剥离出用户 JSON 后注入 `RATS_TEE_VERIFIER_URL`，现有数据链路无需变化。

## Goals / Non-Goals

**Goals:**

- 用两行品牌布局消除英文全名横向溢出。
- 将品牌图标容器圆角固定为 `4px`。
- 把设置页地址标签改为“参考值服务地址”，删除技术实现说明。
- 将首次/默认地址统一为 `https://rvs.cloud.misuan.com`，继续让有效缓存与显式配置优先。

**Non-Goals:**

- 不修改侧边栏宽度、菜单项数量或底部运行状态区布局。
- 不改变参考值服务地址的存储模型、导入/导出协议、锁定行为或启动时环境变量注入机制。
- 不清理主规格中与本需求无关的历史矛盾。
- 不更新、删除或迁移已有设置缓存中的旧地址。

## Decisions

- **品牌区使用结构化两行布局**
  - `App.vue` 把图标和中文标题保留在第一行，英文名移到紧随其后的独立整行。
  - `theme.css` 将 `.brand` 从固定 70px 水平品牌行调整为可控的上/下布局；第二行使用全宽文本区域，允许 `Trusted Network Gateway` 在一行内完整呈现。
  - 图标容器保持 36x36，只把圆角从当前值改为 `4px`，避免把尺寸调整混入本次文案/布局变更。

- **RVS 文案只改展示层**
  - `RemoteAttestationServiceConfig.vue` 中 label 改为“参考值服务地址”，删除 `extra` 文案，placeholder 同步为默认地址。
  - 内部状态键、缓存字段、请求参数和后端字段仍叫 `rvsUrl` / RVS，避免跨端兼容性破坏。

- **默认地址集中在 `DEFAULT_RVS_URL`**
  - 实现只修改前端常量，不硬编码多份新地址。
  - 组件 placeholder 从常量派生或显式同步，保证后续默认地址变更时展示一致。

- **规格采用全量 MODIFIED 块**
  - 对既有的 RVS 地址一致性和单一 ingress 默认配置 requirement 提供完整替换内容，避免归档时丢掉启动注入、缓存优先、锁定等不变行为。
  - 品牌区布局作为新增 requirement，不挂在现有窗口布局 requirement 下，避免影响其他导航行为。

## Risks / Trade-offs

- [Risk] 英文名在不同字体度量下仍可能接近侧边栏边界 → 实现时在 196px 侧边栏下复核不换行、不截断；如局部样式需要微调，只允许调整品牌区内边距/字号/字距，不改全局样式。
- [Risk] 已有用户缓存中的 `https://rvs.tsk.com` 不会被迁移，界面下一次启动仍显示旧地址 → 保持缓存优先语义不变，避免静默覆盖用户配置；只有首次或无效缓存才使用新默认值。
- [Risk] 测试中大量用 `https://rvs.tsk.com` 作为自定义值 → 更新默认值断言和默认 placeholder/label 相关测试，但继续使用不同域名的假地址验证缓存与导入优先级。
- [Trade-off] 删除 technical extra 会让实现细节在设置页不可见 → 该信息已在规格与文档中保留。

## Migration Plan

无数据迁移。实现后同步更新 UI 文档和测试；`openspec validate --strict` 验证规格 delta。发布时使用当前前端构建流程即可。
