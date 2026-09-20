# Proposal

## Why

左侧品牌区的图标与完整英文名并排排列，导致“Trusted Network Gateway”末尾容易超出 196px 侧边导航栏。同时，设置页中的 “RVS 地址” 是内部英文缩写，不如“参考值服务地址”清晰；当前默认地址和冗长说明也需要更新。

## What Changes

- 重排左侧品牌区为两行展示：
  - 第一行：品牌图标 + “可信网关”。
  - 第二行：独立整行展示 “Trusted Network Gateway”。
- 将品牌图标容器改为圆角矩形，圆角固定为 `4px`。
- 设置页“远程证明服务配置”中的地址输入标签从“RVS 地址”改为“参考值服务地址”。
- RVS 地址默认值从 `https://rvs.tsk.com` 改为 `https://rvs.cloud.misuan.com`；placeholder 同步为该默认地址。
- 移除设置页中“启动远程证明版 TNG 时通过 RATS_TEE_VERIFIER_URL 环境变量使用；该地址写入设置缓存，不写入 tng 配置 JSON。”的说明文案。
- 统一 UI 文案、开发者文档、测试与 OpenSpec 规格中的默认地址；不改变有效缓存或显式配置优先于默认值的语义。
- 不改变 RVS 地址的持久化位置、启动注入机制、锁定行为、改动重启行为或 TNG runtime JSON 兼容性。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `gui-shell`: 修改左侧品牌区视觉布局，以及远程证明服务配置的标签、默认地址和隐藏冗余说明要求。

## Impact

- 前端 UI：
  - `frontend/src/App.vue`
  - `frontend/src/assets/theme.css`
  - `frontend/src/components/RemoteAttestationServiceConfig.vue`
- 前端模型与测试：
  - `frontend/src/formspec.ts`
  - 品牌区组件渲染检查或视觉回归
  - RVS 默认值、输入标签、placeholder 相关单元测试
- 文档：
  - `docs/tngui-ui-guide.md`
- 规格与启动行为：
  - `openspec/specs/gui-shell/spec.md` 需要同步更新
  - 后端 RVS 启动注入、设置缓存与 TNG 配置剥离逻辑不需要行为变更
