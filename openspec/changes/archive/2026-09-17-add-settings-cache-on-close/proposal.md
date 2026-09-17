## Why

设置页中的 TNG 配置当前只在切出设置时写入 `tng-runtime.json`，且不会在下次启动回读；API Key 只留在 GUI 会话内存中。用户停止并重新打开 GUI 后需要重新填写这些信息，体验不完整。

## What Changes

- 新增应用级设置缓存文件，在应用关闭流程中 flush 当前设置页的已确认状态。
- GUI 启动时读取缓存，把合理内容恢复到设置页；无缓存、缓存损坏或内容不合法时使用默认模板/空凭据。
- 缓存范围限定为设置页可填信息：已应用到配置模型的 TNG 配置（含 `tngui_outward`、ingress 与 verify 状态）和 API Key；未点“应用”的原始 JSON 草稿属于未提交中间态，不缓存。
- **BREAKING**：反转现有“用户编辑与 API Key 关闭后不保留”的跨会话行为；API Key 将以明文保存在本机应用数据目录的设置缓存文件中。
- 不自动启动 tng：启动后仅恢复设置，仍由用户在概览页触发启动。
- 不改变“离开设置页时自动保存并重启 tng”的现有启动配置流程，也不把 `control_interface.restful` 或内部注入端口暴露到缓存。
- 应用发布版本升至 `0.4.2`，并随本变更升级前端与 Cargo lockfile 中的兼容依赖；不做无关主版本迁移。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `gui-shell`: 增加关闭时 flush 与启动时恢复设置缓存的需求；替换“设置编辑与 API Key 均不跨会话保留”的行为，并明确默认模板只在无有效缓存时使用。

## Impact

- 后端：Tauri 需要新增设置缓存读取/关闭写入能力，使用 `app_data_dir` 下独立文件；避免读写现有 `tng-runtime.json`。
- 前端：应用生命周期需要提供关闭前快照；启动时用缓存初始化共享设置状态。损坏或不合法缓存按默认值处理。
- 测试：需要覆盖 flush、恢复、默认回退、不合法字段丢弃、API Key 明文 persist 语义，以及原始 JSON 未应用草稿不恢复。
- 版本/依赖：workspace 与前端包版本、npm lockfile、Cargo lockfile。
