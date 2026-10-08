# Design

## Context

`tngui` 当前已实现本地反代、精确推理端点识别、`GET /v1/models` 直连 capi origin 与模型下拉状态。中心模型身份契约要求不改动 body、不引入 `x-model`、按单一 URI segment 编码模型字符串；现有实现仍对 `body.model` 执行 trim。诊断目前主要依赖推理失败摘要、模型发现状态和 TNG 状态卡，没有当前反代会话的本地计数。

## Goals / Non-Goals

**Goals:**
- 把 `body.model` 的字符串身份边界从“解析后 trim”改为“保留原字符串并精确 percent-encode”。
- 用紧凑共享诊断结构在当前反代 handle 的连接任务中累计固定类别。
- 通过既有 Tauri 命令边界向 GUI 暴露快照，并渲染只读状态与计数。

**Non-Goals:**
- 不实现 capi 侧授权、服务端 policy、全局 registry、或统一 metrics reporter。
- 不新增外部 metrics endpoint、collector 或把快照写入磁盘。
- 不把 TNG 控制面状态、`/readyz` 或 OHTTP/RA 快照重解释为反代业务健康。

## Decisions

- **诊断数据结构随反代 handle 生命周期存在**：`start_proxy` 建立共享 diagnostics，所有 listener 任务通过共享引用更新。重启时 tngui 已 stop 旧 handle 并创建新 handle，因此计数天然随会话重置。替代方案是用全局 OnceLock 计数，但这会跨会话残留，不符合 spec。
- **类别固定、无动态 label**：快照仅保留 `identity_valid_total`、`identity_rejected_total`、`payload_rejected_total`、`discovery_success_total`、`discovery_failure_total`、`upstream_failure_total` 和由 AppState 判定的 running 布尔。这避免模型名、prompt、header 值或 token 进入 label；也不需要 Prometheus label 设计。
- **在事件就近类别处计数**：身份 400 在 pathresolver 的 Invalid 分支，消息超过上限在 body 读取分支，direct discovery 在返回前按结果分类，upstream 失败在连接/读写错误分支。避免把 400 都归入网络失败。
- **UI 为只读辅助，不阻塞发送**：诊断卡片在密态推理页展示 6 个固定计数与运行状态；发送门禁继续使用运行状态、API key、模型清单状态和选中模型，不因诊断展示功能缺失或新增失败而改变既有门禁。
- **精度优先于传输包装**：继续在 `handle_conn` 中读取 `Content-Length` 并保留原 bytes，移除 `.trim()` 只作用于模型值来源；不引入 body 序列化器。
- **类型安全 IPC**：新增 `proxy_diagnostics` Tauri 命令返回序列化快照；前端封装类型并在既有 `fetchProxy()` 轮询中读取，减少第二个 timer。

## Risks / Trade-offs

- [进程内存计数在 tngui 重启后消失] → 规格明确快照只用于当前会话，不作为审计或跨重启证据。
- [原生 HTTP 分支错误路径较多] → 把 GET /v1/models 与推理端点的计数分支分别放在 direct request 和全局错误分支，测试覆盖 mock 成功、origin 缺失、不可达、invalid/oversize。
- [模型字符串包含空白或 emoji] → RFC3986 单一 segment codec 逐字节 percent-encode，测试继续断言 body 原样和完整 `%20`/UTF-8 编码。
- [UI 诊断可能被误读为授权结果] → 明确文案只表示 tngui 本地代理观测，不进入远端健康或授权卡。

## Migration Plan

实现可向后兼容发布：迁移时可出现旧版反代与新版前端，新命令返回空结果时 UI 保留既有模型状态并可隐藏零计数。回滚只需恢复 handle 与命令签名行为；没有外部系统依赖新指标。

## Open Questions

无。
