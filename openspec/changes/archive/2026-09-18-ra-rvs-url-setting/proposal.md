# Proposal

## Why

远程证明开启时，TNG 的 TPM 验证链路依赖一个用户可配的 RVS 服务地址；当前 GUI 不会把该地址传给 tng 子进程，导致 TNG 回落到内置默认 `https://rvs.tsk.com:9443`，而且用户无法在设置页中改变它。远程证明部署中的 RVS 地址往往是私有地址，因此用户必须能在 GUI 中配置它并保证启动进程确实使用同一份数值。

## What Changes

- 在“设置”视图的 TNG 配置区域新增标题为“远程证明服务配置”的全局配置块。
- 当任意 ingress 开启远程证明时，在 TNG 配置内容下方展示该配置块；当全部 ingress 关闭远程证明时，该配置块不作为当前生效配置的一部分展示。
- “远程证明服务配置”提供一个可编辑的 RVS 地址。
- 首次启动、设置缓存缺失/无效时，RVS 地址预填为 `https://rvs.tsk.com:9443`；存在有效设置缓存时，恢复缓存中的用户填写值，不覆盖为默认值。
- 用户提交的 RVS 地址属于 TNG 配置状态，并随设置缓存跨会话保存。
- 启动或重启 RA 版 tng 进程时，GUI 必须把界面中当前提交的 RVS 地址注入到 tng 子进程环境变量 `RATS_TEE_VERIFIER_URL`，使实际使用的地址与界面值一致。
- RVS 地址变化视为 TNG 配置修改，沿用设置页离开时的自动保存与自动重启语义。
- 为避免破坏 TNG 的严格配置解析，该值不作为未知字段写入 `tng-runtime.json`；它作为 GUI 侧 TNG 配置状态保存，并在启动进程时转换为环境变量。
- 不修改 TNG 源码或二进制接口，继续使用 RA 版 tng 已支持的 `RATS_TEE_VERIFIER_URL` 环境变量。
- **BREAKING**: 无。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `gui-shell`: 新增远程证明服务配置、缓存恢复、启动时 RVS 地址传递与一致性保证，并补充相关设置页位置约束。

## Impact

- 前端配置模型与设置缓存：`frontend/src/formspec.ts`、`frontend/src/configmodel.ts`、`frontend/src/settingsCache.ts`、`frontend/src/tauri.ts`、`frontend/src/views/SettingsView.vue`。
- 启动链路：`src/lib.rs` 的 `launch_tng` 命令与 `tngui-core/src/process.rs` 的 `TngSupervisor::build_command` / `launch`。
- 测试：前端配置/缓存/生命周期测试与后端 RA 启动命令测试。
- 面向用户的影响：RA 开启时设置页出现“远程证明服务配置”；RVS 地址可持久化并真实影响 tng 子进程。
- 兼容性：不改 `tng-runtime.json` 结构，不向 TNG JSON 增加未知字段，保持 TNG 严格解析兼容。
