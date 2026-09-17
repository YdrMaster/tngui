## Why

用户可编辑的端口框目前没有一致的边界：远端端口可输入越界或 `0` 值，导入/原始 JSON 也能绕过表单控件。这会让无效配置在启动时才失败，甚至产生含义模糊的“端口 0”序列化结果。

## What Changes

- 将所有用户显式编辑的服务端口约束为 `1~65535`，覆盖反代对外端口、mapping 远端端口和 http_proxy 目标端口。
- **BREAKING**：`http_proxy` 的 `0` 端口不再作为“匹配任意端口”的可编辑值；“想匹配任意端口”须将端口留空并让序列化结果省略 `dst_filters.port`。
- mapping 远端端口和反代对外端口为必填端口，不接受空值或 `0`。
- http_proxy 目标端口为可选端口：留空表示未指定端口；显式填写时必须为 `1~65535`。
- 前端配置模型/导入/原始 JSON 回填与后端启动前校验都必须识别并拒绝非法端口，避免只靠 InputNumber 控件约束。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `gui-shell`: 新增用户可编辑端口取值、端口号控件边界与 http_proxy 可选端口语义要求；调整导入/回填/启动前校验对非法端口的行为。

## Impact

- 前端：`EntryEditor.vue`、`FieldRenderer.vue`、`formspec.ts`、`configmodel.ts` 及相关测试。
- 后端：`tngui-core/src/config.rs` 启动前端口校验及周边测试。
- 行为面：结构化表单、原始 JSON 回填、JSON 导入、启动校验；受影响字段为 `tngui_outward.port`、`mapping.rules[*].out.port`、`http_proxy.dst_filters[*].port`。
- 不改变 tngui 自动注入的内部监听端口与管控端口；这些端口仍由系统自动选取且不作为用户输入。
