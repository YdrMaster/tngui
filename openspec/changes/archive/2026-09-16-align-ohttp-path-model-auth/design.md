## Context

tngui 当前链路是“普通 OpenAI 请求 → tngui 反代解析 body.model 并注入 `x-model` → TNG ingress 透传 `x-model`”。capi 最新方案已改为 path 模型身份：credential 透传到 OHTTP outer 请求，`x-model` 不再参与鉴权。tngui 钉定的 TNG 版本为 2.9.2，TNG ingress 支持 `ohttp.path_rewrites`；TNG 会在模型化 base URL 上发起 key-config 与 tunnel，因此一处 `path_rewrites` 可同时服务这两个 OHTTP 协议面。

## Goals / Non-Goals

**Goals:**
- 在不引入后端服务和额外进程的前提下，把现有 tngui 反改造成 capi 契约中的 pre-TNG proxy。
- 让 TNG ingress 的 outer path 固定携带 `/models/{model-segment}`，避免每个模型在前端生成分散配置。
- 保留现有 TNG lifecycle、端口注入、RA/verify、mapping/http_proxy 与反代单点对外入口架构。
- 用规范测试覆盖模型编码、错误请求、`x-model` 隔离、ingress 序列化与导入回填。

**Non-Goals:**
- 不实现 capi 管理 API、Envoy、aside TNG egress、post-TNG restore proxy，也不部署远端依赖。
- 不引入多模型集群选择逻辑；模型路由由远端 Envoy / capi 完成。
- 不提供用户可编辑的 `path_rewrites` 或 `header_passthrough`。
- 不追求旧 `x-model` 行为兼容。

## Decisions

### D1: 继续复用现有 tngui 反代，而不是新增独立进程
反代已经负责对外暴露、内部端口注入和 lifecycle。将 path 注入逻辑放在这里能保持“pre-TNG proxy”与对外入口同属一个组件，不需要新的端口、进程模型或 Tauri 命令。备选是另起新 proxy 进程，会破坏现有“设置一个本机端口 = 一个对外入口”的模型。

### D2: 模型身份只来自 body.model，path 是唯一注入点
supported path 仅限定为 `POST /v1/chat/completions` 与 `POST /v1/messages`。反代按 UTF-8 JSON object 解析顶层 `model`，trim 后对除字母数字与 `-._~` 之外的 UTF-8 字节做 percent-encoding，因此 `provider/model` 变成 `provider%2Fmodel`。body 不修改，避免二次修改推理 payload。`x-model` 不读取也不写入；理由是 capi 已声明它不能作为模型身份，继续透传会扩大旧契约的歧义。

### D3: TNG ingress 使用固定 path rewrite
每条 ingress 统一输出：
```yaml
ohttp:
  path_rewrites:
    - match_regex: '^/models/([^/]+)(?:/.*)?$'
      substitution: '/models/$1'
  header_passthrough:
    request_headers:
      - authorization
      - x-api-key
```
这由前端序列化层锁定，导入配置中的 ingress `ohttp` 一律被丢弃后重建。该配置与 TNG 2.9.2 的 `OHttpArgs` 一致。TNG 在 `construct_base_url` 上应用同一规则，因此 key-config 与 tunnel 都会落在模型化 base URL 上。

### D4: failed model 解析必须本地 fail-closed
supported 端点上：缺 `model`、`model` 非 string、trim 后为空、body 不是 UTF-8 JSON object 时返回 400，不进入 TNG。超过 10 MiB 返回 413。这样可以避免无效请求绕过模型语义后落在 no-model fallback path。其他 path 仍按普通反代转发，最终由远端路由拒绝。

### D5: 不保留 BOM 剥离特例
capi 契约要求 body 原始字节保留。现有“剥 UTF-8 BOM 再转发”的行为会把带 BOM 的合法字面 JSON 改写成另一种字节流， 不再支持；带 BOM 的 JSON 在推理端点按非法 JSON object 返回 400。若日后需要 BOM 兼容，必须单独立项并修改 body-preservation 契约。

### D6: UI 只改锁定契约，不增加新表单
`path_rewrites` 与 `header_passthrough` 保持锁死，不暴露控件。远端仍是 Envoy edge。文档描述模型身份来源为 “body.model → reverse proxy path segment”，不再说明 `x-model`。根 README 中 `TNG_VERSION` 描述同步纠正为 `2.9.2`。

## Risks / Trade-offs

- [旧 x-model 客户端不兼容] → 明确标记 breaking；远端必须先具备 capi path 模型路由。期外客户端必须使用标准 body.model。
- [模型名编码错误会导致 capi 精确匹配失败] → 实现 percent-encoder 单元测试，覆盖 slash、百分比、非 ASCII、UTF-8 多字节、query 分隔符和 trim 行为。
- [TNG path rewrite 若配置丢失，authz 会退回 no-model path] → 更新前端序列化、导入与测试，确保 ingress `ohttp` 只能用锁定值。
- [错误请求继续兼容现有反向代理转发] → supported path 上 fail-closed；unsupported path 不做模型推断，由下游默认拒绝。
- [改动跨越前端配置契约与核心代理] → tasks 分成配置契约、代理行为、文档/测试三层，分别验证。

## Migration Plan

1. 更新 TNG ingress 锁定的 `ohttp` 配置。
2. 更新反代 body.model → path 注入逻辑，替换 `x-model` 相关测试。
3. 更新 UI 与文档，避免旧术语继续出现。
4. 远端 Envoy/capi/egress/restore proxy 方案部署完成后，再启用包含该 PR 的 tngui 客户端。

回滚时，保留远端旧认证方案已不再可能继续工作；因此该变更只应与远端方案切换一起发布。若必须回滚，需要同步回退 tngui release 使用旧有 capi/Envoy 契约。
