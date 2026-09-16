## Why

capi 最新契约已从 `x-model` 头鉴权切换到 TNG OHTTP outer path 模型鉴权。tngui 目前的反代仍注入 `x-model`，TNG ingress 也把 `x-model` 写进透传白名单，因此无法与新 capi、Envoy 数据面协作。

## What Changes

- **BREAKING**：tngui 反代不再注入、解析或依赖 `x-model` 作为模型身份。
- tngui 反代升级为 capi 方案中的 pre-TNG proxy：对支持的 OpenAI 兼容 POST 推理端点读取 `body.model`，并把内部请求路径改写为 `/models/{model-segment}{original-path}`。
- 模型名按单一路径 segment 做 percent-encoding；`provider/model` 必须编码为 `provider%2Fmodel`。
- 每条客户端 ingress 的 TNG `ohttp` 锁定配置改为固定 `path_rewrites` 和 `["authorization","x-api-key"]` 请求头透传，不再锁入 `x-model`。
- 保留反代对外绑定、TNG ingress 本地监听注入、 lifecycle、RA/TLS 配置与现有 UI 结构。
- 规范 `x-model` 旧语义的测试、UI 帮助文本与文档，避免继续向用户暴露废弃模型身份。

## Capabilities

### New Capabilities
- （无）

### Modified Capabilities
- `gui-shell`: 反代行为从 x-model 注入改为模型 path 注入；TNG ingress 锁定 OHTTP 配置增加 path rewrite 并移除 x-model 透传；相关 UI 序列化、导入导出、默认模板、推理发送与文档要求同步更新。

## Impact

- 受影响代码：`tngui-core/src/proxy.rs`、`frontend/src/formspec.ts`、`frontend/src/configmodel.ts` 及相关 Rust / Vue 测试。
- 受影响配置：所有 `mapping` 与 `http_proxy` 客户端 ingress 的 TNG `ohttp` 输出。
- 受影响文档：`docs/tngui-ui-guide.md`、根 README 中 x-model / TNG 版本描述。
- 兼容性：旧客户端若无体面 `body.model` 将无法获得模型路径，capi 将拒绝。该变更要求远端已按 capi path 模型方案部署 Envoy/TNG egress/restore proxy。
