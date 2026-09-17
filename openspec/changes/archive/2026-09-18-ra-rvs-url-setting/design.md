# Design

## Context

当前设置页已经在“远程证明”开关下暴露 `verify.model` 与 `verify.as_provider`，`verify` 会被序列化为真正的 TNG 配置，而 TNG 的 TPM 远程证明实际把 RVS 地址绑定在环境变量 `RATS_TEE_VERIFIER_URL` 上，不落在 `tng-runtime.json`。同时 TNG 的配置根是严格 schema（`deny_unknown_fields`），任意新增顶层/ingress 字段都会在解析时被拒绝。既有设置缓存目前保存 `configJson` 与 `apiKey`，没有 RVS 地址。

## Goals / Non-Goals

**Goals:**
- 让 RA 场景拥有一个全局、用户可改、可跨会话恢复的 RVS 地址。
- 保证界面显示/提交的地址与 tng 子进程实际收到的 `RATS_TEE_VERIFIER_URL` 完全一致。
- 保持 `tng-runtime.json` 与 TNG 的严格 JSON schema 完全兼容。
- 让 RVS 地址变化参与现有 TNG 配置 dirty/重启语义，而不是另起一套保存流程。
- 保持 UI 标题统一为“远程证明服务配置”，并放在任意 ingress 开启 RA 后的 TNG 配置内容下方。

**Non-Goals:**
- 不修改 TNG 源码、配置 schema 或日志语义。
- 不为每条 ingress 单独提供 RVS 地址。
- 不引入 RVS 连通性测试。
- 不配置 `RATS_TEE_VERIFIER_CA`、`RATS_TEE_VERIFIER_TENANT_ID`、策略 ID、租户 ID 或证书内容。

## Decisions

1. **把 RVS 地址建模为 GUI 侧 TNG 配置的一部分**
   - 界面概念上，它属于 TNG 配置状态，而不是推理凭据或单独的高级环境变量设置。
   - 它随 TNG 配置缓存一起保存、恢复，并参与 dirty/重启判断。

2. **不把 RVS 地址写入 TNG runtime JSON**
   - 理由是 TNG 的 `TngConfig` 使用 `deny_unknown_fields`，新字段会在解析期失败。
   - 方案是在生成传给 tng 的配置文件时剥离该字段，并在启动进程时把它注入到子进程环境变量 `RATS_TEE_VERIFIER_URL`。

3. **复用现有设置缓存而不是新建独立配置文件**
   - 该地址和 `configJson`、`apiKey` 一样属于设置态，适合随现有设置缓存一起生命周期化。
   - 保存、恢复、默认值和损坏回退逻辑可与现有缓存校验路径一致。

4. **全局地址而不是 per-ingress 地址**
   - RA 版 tng 进程只能持有一个全局 `RATS_TEE_VERIFIER_URL`。
   - 界面因此使用全局编辑框，并在有任意 ingress 开启 RA 时展示，避免出现无法真正生效的伪 per-ingress 配置。

5. **复用现有 dirty/重启语义**
   - RVS 地址变化后，只有沿用现有“离开设置自动保存并按需重启”流程，才能保证运行中的 tng 实际拿到新值。
   - 该值不改变 `apiKey`、`model` 的现有处理方式。

6. **默认值优先级**
   - 默认值仅在首次启动或设置缓存无效/缺失时写入。
   - 只要缓存通过校验且包含合法字符串，就用缓存值；不做静默覆盖。
   - 该默认值与 RA 版 TNG 当前内置默认值保持一致，保证新用户和旧行为没有意外差异。

7. **启动链路**
   - 前端启动函数需要把 RVS 地址随 TNG 配置一起提交给后端。
   - 后端启动路径在生成 tng 参数时注入 `RATS_TEE_VERIFIER_URL`。
   - 若当前配置不存在任意 RA ingress，则不要求也不展示该配置块；不强制把 RVS 地址写入 runtime JSON。

## Risks / Trade-offs

- [Risk] 用户填写的 RVS 地址不可达，导致远程证明失败。-[Trade-off] 这次只保证 GUI 与子进程使用同一地址，不在启动前主动探测网络。
  - [Mitigation] 保持错误日志可见，便于用户回看地址问题。
- [Risk] 把地址当作 TNG 配置写入 JSON 可能破坏 TNG 严格解析。
  - [Mitigation] 保持该字段只存在于 GUI/缓存模型，并统一在生成 tng-runtime JSON 时剥离。
- [Risk] 多 ingress 开启 RA 时仍只能共享一个全局 RVS 地址。
  - [Mitigation] UI 明确使用全局配置块；未来如需 per-ingress，应先扩展 TNG 配置模型再扩展 UI。
- [Risk] 缓存损坏或 schema 不匹配时，用户需要重新填写地址。
  - [Mitigation] 在这种情况回填默认值，保证设置页仍可用并保持 RA 有可启动路径。

## Migration Plan

- 新缓存字段随本功能一起增加；未包含该字段的历史缓存将在首次加载时按默认值补齐。
- 已有用户如果之后保存过 RVS 地址，则缓存值持续保留。
- 不需要迁移 `tng-runtime.json`，因为该文件结构保持不变。
