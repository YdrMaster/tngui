## Context

当前 `save_config` 只在切出设置视图时把用户侧 TNG 配置写入 `app_data_dir/tng-runtime.json`；该文件同时是 tng 启动路径使用的 runtime 配置。GUI 启动不会回读它。API Key 位于前端共享 ref 中，无后端持久化；原始 JSON 文本框中未应用的编辑也只存在于 `SettingsView` 局部 state。

相关边界：

- 用户侧 TNG 配置已有 `serialize()` / `parse()`；`parse()` 会校验用户可编辑端口并丢弃 `control_interface.restful`、`add_egress`、ingress 自定义 `ohttp`。
- `launch_tng` 仍必须执行严格的启动前校验和端口注入。
- 设置页“客户端信息”是编译期只读信息，不是可填设置。
- 原始 JSON textarea 的未应用文本不是配置模型的一部分。

## Goals / Non-Goals

**Goals:**

- 提供一个与 `tng-runtime.json` 分离的设置缓存文件，版本化、可校验且可原子替换。
- 在正常关闭流程中从前端收集一次快照并同步 flush。
- 启动时先完成缓存校验和共享状态初始化，再渲染设置状态。
- 结构化模型和 API Key 可独立恢复；一个字段不合理时不阻止另一个字段恢复。

**Non-Goals:**

- 不缓存未应用的原始 JSON 草稿、推理页 `model`、prompt 或历史请求。
- 不自动恢复运行中的 tng、不自动重建控制端口或内部 ingress 端口。
- 不引入系统 keyring、加密保险箱或跨设备同步。
- 不改变导入/导出、离开设置页自动保存与重启的现有语义。
- 不保证强杀进程、断电或崩溃时完成 flush。

## Decisions

### 1. 使用独立 `settings-cache.json`

文件路径使用 Tauri `app_data_dir()/settings-cache.json`，不写 `tng-runtime.json`。后者会被 `launch_tng` 注入隐藏控制端口和内部监听端口；混用会让“设置缓存”泄漏运行期内部状态，或把 runtime 文件误读回用户配置。

独立文件采用版本化 payload：

```json
{
  "schemaVersion": 1,
  "tng": {
    "configJson": "<用户侧 TNG 配置 pretty JSON string>",
    "apiKey": "<string>"
  }
}
```

`configJson` 存字符串可保留原始序列化结果，便于用前端同一条 `serialize()` / `parse()` 契约校验；比把内部 `ConfigModel` 直接序列化到磁盘更稳，因为内部模型字段会随实现演进。备选是把 API Key 和 TNG 配置拆成两个文件；否决，因为会引入两次关闭 IO 和不一致快照。

### 2. 关闭时由前端快照、后端原子写入

前端在正常 close 请求中拦截关闭，调用现有共享状态生成快照：

- TNG 配置：`serializeCurrent()`，即当前结构化模型；不读取未应用 raw textarea。
- API Key：当前 `useInferenceConfig().apiKey`。

随后调用新的 `flush_settings_cache` 命令，命令返回成功后再继续关闭。流程如下：

```text
CloseRequested
   |
   v
[frontend snapshot: model + apiKey] --> flush_settings_cache
   |
   v
[backend: schema JSON + atomic write] --> settings-cache.json
   |
   v
continue close / destroy window
```

后端写入先写 `settings-cache.json.tmp`，再 rename 覆盖目标文件；Unix 下将目标文件权限设为 owner-only。写失败时不 panic、不记录 payload，只返回/记录错误并继续关闭。备选是 Tauri `ExitRequested` 在 Rust 侧写盘，但 Rust 侧拿不到前端结构化模型和 API Key；若让前端持续同步到后端内存，就变成另一条状态同步路径且更容易遗漏 raw apply 边界。

### 3. 启动时先 load、校验，再进入可交互视图

后端新增 `load_settings_cache` 只返回原始缓存 JSON；语义校验放在前端 `settingsCache` 模块：

1. 检查顶层 JSON object 和 `schemaVersion === 1`。
2. `apiKey` 必须是 string，否则置空。
3. `tngConfigJson` 必须是 string，`parse()` 必须成功，且用户端口校验持续生效。
4. 恢复成功后把共享 `model` 设置为解析结果，并把 dirty 基线设为其序列化结果。
5. 任一 TNG 校验失败只回退 TNG 默认模板；API Key 的合法性与 TNG 配置独立判断。

`App.vue` 等待一次 cache bootstrap 完成后再渲染三视图路由区。这避免用户在异步 load 完成前进入设置页看到默认值。加载/校验失败按默认值继续启动，不显示阻塞错误。

### 4. 校验语义不同于启动校验

设置缓存校验要求配置能按用户侧语义回填：支持的 ingress 形态、 outward 端口、mapping 远端端口、`http_proxy` 可选端口等都要有效。它不要求 `mapping.out.host` 已配置为 IPv4，因为空白远端是初始模板的合理待填状态。启动 tng 仍走 `validate_user_config` / `prepare_launch`，有效缓存不会导致自动启动或绕过后端启动拒绝。

### 5. 保留 runtime 自动保存与重启边界

切出设置视图时继续调用现有 `save_config` 和可选自动重启；关闭 flush 是独立生命周期事件，不得触发 tng 启停。API Key 修改不进入 TNG dirty 判断，也不会让关闭 flush 拉起 tng。

## Risks / Trade-offs

- [API Key 明文落盘] → 文件放在操作系统的用户应用数据目录、owner-only 权限，日志绝不输出 payload；文档中明示本地明文风险。加密/keyring 超出本变更。
- [close 拦截在异常退出中不会执行] → 规格只承诺正常关闭流程；提供重新打开后的损坏/缺口回退语义，不部署部分文件。
- [缓存格式与前端模型演进] → `schemaVersion` 硬门禁；未来模型变化必须新增版本或迁移器，旧版本整体视为不适用。
- [非法配置写入后丢失] → 关闭 flush 允许记录当前模型，启动校验拒绝不合理配置并回退默认；不阻塞应用，也不静默发明默认端口或 host。
- [文件竞争/半写] → 临时文件加 rename 原子替换；损坏文件在启动时整体放弃 TNG 缓存。
