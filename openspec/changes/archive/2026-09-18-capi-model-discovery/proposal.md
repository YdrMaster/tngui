# Proposal

## Why

capi 已支持通过 `/v1/models` 探测可用模型，但 tngui 目前让用户手工填写模型名，导致模型不匹配、无效模型请求和额外排障。tngui 应直接利用服务端模型清单，让密态推理测试页只呈现真实可用模型。

## What Changes

- **pre-TNG proxy 放行模型发现请求**
  - 对精确的 `GET /v1/models` 直接转发到当前 ingress 指向的 capi origin，不进入 tng ingress，也不走 OHTTP/path-model 推理链路。
  - 查询串保留，模型发现不做 body 改写、不注入 model path、不生成或使用 `x-model`。
  - `POST /v1/chat/completions` 与 `POST /v1/messages` 继续保持现有 TNG 推理路径和 `/models/{model}/...` pre-TNG path 注入契约。
- **推理测试页改为服务端模型选择**
  - 模型控件从自由文本输入改为只读选项下拉菜单；用户不能输入、创建或选择 `/v1/models` 未返回的模型。
  - 页面通过本地 pre-TNG proxy 的 `/v1/models` 获取模型清单，并解析 OpenAI 兼容响应中的 `data[].id` 渲染选项。
  - `v1/models` 返回空列表时，下拉菜单禁用并显示 `未检测到密态模型`，发送测试请求按钮禁用。
  - 只有一个模型时自动选中并显示该模型。
  - 有多个模型时默认选中第一个，用户可切换；不提供空选项，也不允许清除选择。
  - 列表刷新后，若当前模型仍在列表中则保留；否则回落到新列表第一项；刷新后为空时清空选择并进入空列表状态。
  - 模型发现请求失败时显示明确的加载失败状态，不伪装成空列表。
  - 选中的模型保持 GUI 会话内内存态，不写入设置缓存、TNG 配置或 `tng-runtime.json`；关闭 GUI 后需重新获取并选择。
- **安全边界调整**
  - `/v1/models` 是模型元数据发现例外，直接发往 capi。推理请求仍须经 tng ingress、OHTTP/RATS-TLS，并由 pre-TNG proxy 注入模型路径。
  - tngui 下拉获取模型清单时不发送 API Key，避免将推理凭据暴露到模型发现链路。
- **文档与回归**
  - 补充 README 与 UI guide 中 `/v1/models` 特殊路径、模型下拉规则和安全边界说明。
  - 覆盖 Rust proxy/config/model-list 测试与前端推理页状态测试。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `gui-shell`: pre-TNG proxy 增加精确 `GET /v1/models` 直连 capi 的例外路由；密态推理页面从自由输入模型改为基于 `/v1/models` 的强制下拉选择，并调整发送门锁与会话内模型状态要求。

## Impact

- **Rust / Tauri**
  - `tngui-core/src/proxy.rs`: 新增 `GET /v1/models` direct capi 分支，保留既有推理转发逻辑。
  - `tngui-core/src/config.rs`: 从当前唯一 ingress 解析 direct capi origin，包括 `http_proxy` 的 TLS 语义与 `mapping` 的远端 host/port。
  - `tngui-core/src/inference.rs` 或新增 models 模块：为 UI 模型发现提供响应解析能力。
  - `src/lib.rs` 与前端 `tauri.ts`: 新增或暴露模型发现命令，使 UI 经本地 proxy 获取模型列表。
  - 可能新增 Rust TLS HTTP client 依赖（如 `reqwest` + `rustls-tls`），仅用于 direct `/v1/models` 分支。
- **Vue 前端**
  - `frontend/src/views/InferenceView.vue`: 下拉菜单、加载/空/错误状态、选中与默认规则、发送禁用。
  - `frontend/src/composables/useInferenceConfig.ts`: 会话内模型列表与选中状态。
  - `frontend/src/views/InferenceView.component.test.ts`: 覆盖 1/0/N 模型、刷新回落、禁用和发送参数。
- **规范与文档**
  - 覆盖现有 `gui-shell` 中“模型可自由输入”“model 不影响门锁”“模型输入 trim”的旧行为。
  - 更新 README 与 `docs/tngui-ui-guide.md`。
