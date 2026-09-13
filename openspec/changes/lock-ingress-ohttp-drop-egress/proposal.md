## Why

tngui 是客户端侧工具，从它出发的 Seg1 真实只有 OHTTP 一种形态（见 `fix-inference-security-desc` 与 cmaas-deploy `publish/docs/03-使用.md` §2：客户端 `tng-client-config.json` 只含 `add_ingress + ohttp + verify`、不含 `add_egress`）。但当前"设置"视图的结构化控件却按 TNG 通用形态暴露：ingress 给 5 种模式选择器（含 socks5/netfilter/hook）、`ohttp` 藏在高级原始 JSON 里、`add_egress` 整段可编，且"密态推理"卡另起一套与结构化 ingress 断开的 `localPort`/`outboundAddress`。配置界面既能写出客户端不会出现的内容（egress、socks5），也和真实链路对不上。需把结构化 ingress 钉死成客户端唯一会出现的形态、去掉 egress、并把密态推理连接信息收归结构化 ingress 单一来源。

## What Changes

- **BREAKING（配置契约）**：ingress 锁定为客户端 OHTTP 形态——
  - 仅 `mapping`（"地址端口"）/`http_proxy`（"域名"）两种远端形态；`socks5`/`netfilter`/`hook` 不再作为 ingress 模式提供。
  - `ohttp` 永远开（seg1=OHTTP）：结构化序列化每条 ingress 必出 `ohttp`；`ohttp.header_passthrough.request_headers` 写死为 `["x-model","x-api-key","authorization"]`，用户不可关闭 ohttp、不可改这 3 个头。
  - 保留 `no_ra` toggle：开则不出 `verify`；关则可配 `verify`（`{model, as_provider}`，默认 `passport`/`tpm`）。`no_ra` 与 `verify` 在序列化中互斥（与 cmaas-deploy 客户端一致），不再恒定平铺 `no_ra` 布尔。默认 `no_ra=false`（verify on，对齐真实链路；现实现默认 `no_ra=true` 与链路矛盾，一并修正）。
  - 本地监听 host 强制 `127.0.0.1`（`mapping` 的 `in.host`、`http_proxy` 的 `proxy_listen.host`），端口可配：前端锁死只读 + 后端 `prepare_config` 一律覆盖（与 `control_interface.restful` 强制回环同法）。
  - 远端两形态：`地址端口` → `mapping`，`out = {host:<IP>, port:<port>}`（TNG 约束 host 必为 IP）；`域名` → `http_proxy`，`dst_filters = {domain:<单文本框原样>}`，单文本框、不结构限定 http/https、不拆分端口。
- **BREAKING**：去掉 `add_egress`——前端模型/序列化/结构化控件/默认模板/导入导出/原始 JSON 全部不再承载 egress；后端 `prepare_config` 丢弃 `add_egress`。
- **（UI 收编）**：`SettingsView` 的"密态推理"卡不再承载 `localPort`/`outboundAddress` 及关联的本地 URL 复制与导入导出 JSON 弹窗；本地端口与远端一律取自结构化 ingress，该卡只保留 API Key / Model。
- 默认开局模板改为一条锁定形态的 OHTTP `mapping` ingress（`127.0.0.1` 监听 + 可配端口、`no_ra=false`、写死 header_passthrough），不含 egress、不含 `control_interface.restful`（承接 `auto-manage-control-port`）。

## Capabilities

### New Capabilities
（无新增 capability）

### Modified Capabilities
- `gui-shell`：把"结构化配置控件""默认开局模板""原始 JSON 高级视图""JSON 配置导入导出"改为客户端 ingress 锁定形态（仅 `mapping`/`http_proxy`、`ohttp` 常开写死 header_passthrough、`no_ra`/`verify` 互斥、本地监听强制回环+可配端口、egress 去除）；新增"客户端 ingress 锁定 OHTTP 协议""ingress 本地监听强制走回环""ingress 的 no_ra 与 verify 互斥序列化"三条要求；密态推理连接信息（本地端口+远端）收归结构化 ingress 单一来源。

## Impact

- 前端契约/模型：`frontend/src/formspec.ts`（`ConfigModel` 去 `add_egress`；`INGRESS_MODES` 收敛为 `mapping`/`http_proxy`，删除 `EGRESS_MODES`/`EGRESS_FIELDS`；`INGRESS_FIELDS` 改为两形态 + `header_passthrough` 常量 + `verify` 字段定义；`defaultModel()` 改为锁定形态 ingress）；`frontend/src/configmodel.ts`（`serialize` 每条 ingress 注入锁定 `ohttp` 并按 `no_ra`/`verify` 互斥产出；`parse` 丢弃 `add_egress`、丢弃 ingress 的 `ohttp`、识别 `verify`、仅认 `mapping`/`http_proxy` 两种 ingress）；`frontend/src/configmodel.test.ts`（重写用例）。
- 前端 UI：`frontend/src/components/EntryEditor.vue`（去 `kind=egress`；模式选择器收敛为"远端类型 地址端口/域名"二选一；本地监听 host 只读 + 端口可配；`域名` 单文本框；`no_ra`/`verify` 互斥；移除逐条"高级原始 JSON"折叠，未结构化字段由全局原始 JSON 视图兜底）；`frontend/src/components/FieldRenderer.vue`（新增/复用 `域名` 文本类型、本地监听 host 只读）；`frontend/src/views/SettingsView.vue`（去 egress 卡片与 `addEgress`；密态推理卡去 `localPort`/`outboundAddress`/本地 URL/JSON 弹窗，保留 API Key/Model）；`frontend/src/views/InferenceView.vue`（`inferencePort` 去掉 socks5 分支，保留 mapping/http_proxy）。
- 后端：`tngui-core/src/config.rs`（`prepare_config` 丢弃 `add_egress`、强制每条 ingress 本地监听 host=`127.0.0.1`；保留 restful 注入，属 `auto-manage-control-port`；新增/调整单测）。
- 文档：`docs/tngui-ui-guide.md`（ingress 模式收敛为 mapping/http_proxy、客户端无 egress、ohttp 常开与 no_ra/verify 语义、密态推理连接信息来源）。
- 依赖与编排：本变更的 `gui-shell` delta 与在途未归档的 `auto-manage-control-port` 同改"结构化配置控件""默认开局模板""原始 JSON 高级视图""JSON 配置导入导出"等条目；建议先归档/sync `auto-manage-control-port` 再归档本变更，避免两条 delta 对同一 requirement 的覆盖序导致回退（详见 design）。
- 不在范围内：不改推理发送逻辑（`http_proxy` 形态下发送语义与本机 `mapping` 不同，留作后续开放项）；不改首页状态卡语义；不改 `control_interface.restful` 注入逻辑（属 `auto-manage-control-port`）。
