# Proposal

## Why

阶段 2 要求 tngui 把 client-side pre-TNG proxy、模型身份、模型发现与本地诊断收敛到同一可验证实现。当前反代已有大部分契约行为，但仍存在 `body.model` 本地 trim，且缺少可展示的反代本地诊断指标；这会导致 path 身份偏离中心契约，也难以在 GUI 内判断模型注入与发现失败域。

## What Changes

- 修改反代模型身份解析：支持端点只识别 body 顶层模型字符串，并禁止任何首尾 trim、大小写或格式化；`provider/model` 仍编码为 `provider%2Fmodel`。
- 保持只有 `POST /v1/chat/completions` 与 `POST /v1/messages` 注入 `/models/{model-segment}` 前缀；`GET /v1/models` 继续作为本地发现例外直达当前 ingress 的 capi origin。
- 不把 `x-model` 作为模型身份；`body.model`、URL 前缀、OHTTP path rewrite 与模型发现/诊断类别不引入第二套身份。
- 新增 tngui 进程内的本地反代诊断快照与 GUI 诊断状态：区分模型身份有效/被拒、模型发现成功/失败、反代运行/未运行，并记录计数；不引入外部 collector，也不实现服务端授权或统一 metrics reporter。
- 诊断标签、状态与错误展示不得包含 prompt、output、raw API key、raw attestation token 或模型名。

## Capabilities

### New Capabilities

<!-- 本变更不新增能力；沿用既有的 GUI 外壳能力承载反代与调试页本地行为。 -->

### Modified Capabilities

- `gui-shell`: 收紧 pre-TNG path 注入的模型身份语义，并新增反代本地诊断快照与 UI 状态要求。

## Impact

- `tngui-core/src/proxy.rs`：移除模型解析 trim，补齐精确端点、编码与身份伪造测试；在监听器内维护本地诊断计数与快照读取。
- `src/lib.rs` 与 `frontend/src/tauri.ts`：暴露当前反代诊断快照。
- `frontend/src/views/InferenceView.vue` 及组件测试：呈现无敏感 label 的本地诊断状态。
- 不修改 `capi/`、不修改中心仓库其他文件，不引入外部 collector/systemd/HTTP metrics 端点。
