## Context

见 `proposal.md - Why`。真实链路依据 cmaas-deploy `publish/docs/03-使用.md` §2 与 `docs/ra-config.md` §3.3：客户端 `tng-client-config.json` 只含 `add_ingress`（每条带 `ohttp` + `verify`，seg1=OHTTP/HPKE、客户端单向 RA），不含 `add_egress`；客户端两种入口形态——`nodeport`→`mapping`（`out` = `<节点IP>:<nodeport>`，host 必为 IP）、`ingress`→`http_proxy`（`dst_filters = {domain, port默认80}`）。现实现 `formspec.ts`/`configmodel.ts`/`EntryEditor.vue` 按 TNG 通用形态暴露 5 种 ingress 模式、把 `ohttp` 藏在高级 raw JSON、`add_egress` 整段可编，且 `SettingsView` 另起与结构化 ingress 断开的 `localPort`/`outboundAddress`。后端 `prepare_config`（`auto-manage-control-port` 已合并）仍原样透传除 restful 外的所有字段。

## Goals / Non-Goals

**Goals:**
- 把结构化 ingress 钉成客户端唯一会出现的 OHTTP 形态，去掉 egress，并让密态推理连接信息收归结构化 ingress 单一来源。

**Non-Goals:**
- 不改推理发送逻辑（见 Open Questions）。
- 不改首页状态卡语义、不改 `control_interface.restful` 注入（属 `auto-manage-control-port`）。
- 不结构化 `verify` 之外更细的 RA 字段（`aa_provider`/`refresh_interval` 属 egress `attest` 侧，客户端用不到）。

## Decisions

- **D1 — 锁 OHTTP = `ohttp` 常开 + `header_passthrough` 写死 3 头，mode 收敛 mapping/http_proxy。** 与 cmaas 客户端两形态一致。备选：维持 5 模式——否决，客户端只会出现这两种，混述会再制造"写出不可能配置"的问题。`socks5`/`netfilter`/`hook` 从 `INGRESS_MODES` 移除。
- **D2 — egress 完全去除（含 `prepare_config` 丢 `add_egress`）。** 理由：cmaas 客户端 config 无 `add_egress`，egress 属服务侧网关，不应出现在 tngui。备选：保留 egress 进阶——否决，用户明确不需要。
- **D3 — 远端两形态＝TNG 两种 entry。** `地址端口`→`mapping`（`out={host:<IP>,port:<port>}`，TNG 约束 host 必为 IP）；`域名`→`http_proxy`（`dst_filters={domain}`）。备选：合成单 `host:port` 文本再解析——否决，`mapping` 的 IP 约束与 `http_proxy` 的"tng 当 HTTP 代理、目标写真实域名 URL"语义不同，且 `http_proxy` 本就无 `out`。
- **D4 — 域名单文本框、不结构限定 http/https。** 用户定夺。`dst_filters` 只收 `domain`，scheme 取决于应用请求 URL，tng 客户端这段不做 TLS 终止（TLS 在 ingress-nginx 侧）。备选：拆 `domain`+`port(默认80)` 结构——否决，用户要求不结构限定。
- **D5 — 本地监听 host 强制回环：前端只读 + 后端 `prepare_config` 覆盖。** 与 `control_interface.restful` 强制回环同法，defense-in-depth。备选：仅前端锁——否决，后端兜底防绕过（导入/外部编辑的配置仍经 `prepare_config`）。
- **D6 — `no_ra`/`verify` 互斥序列化、默认 `no_ra=false`(verify on)，暴露 `verify` 的 `model`+`as_provider` 两字段。** 对齐 cmaas 客户端；现实现默认 `no_ra=true` 与"OHTTP+verify"矛盾，一并修正。备选：恒定平铺 `no_ra` 布尔 + `verify` 进 extra——否决，与真实链路不一致且把核心 RA 语义塞回高级 JSON。
- **D7 — 收编 feature 卡 `localPort`/`outboundAddress`。** 本地端口与远端唯一来源＝结构化 ingress；feature 卡仅 API Key/Model。消除两套断开的"本地端口+远端"。`InferenceView` 已从 `tngConfigModel.add_ingress[0]` 推 `inferencePort`，自然对齐。
- **D8 — 未结构化字段兜底＝全局原始 JSON 视图（非逐条折叠）。** `ohttp`/`verify` 已结构化、`control_interface.restful`/`add_egress` 被丢弃，逐条折叠仅剩极少未结构化（如 `ttrpc`、`metric`），收口到全局更清。备选：保留逐条高级折叠——否决。
- **D9 — 非 `mapping`/`http_proxy` 的 ingress（遗留 socks5/netfilter/hook 导入）整体丢弃并提示，不保留。** 锁定形态编辑器无法表达；GUI 默认每会话重置、无持久化，损失可接受。备选：转入 raw 往返——否决，复杂且与锁定语义冲突。
- **D10 — 默认 `out` 占位。** 默认模板 `out` host 留空、port `10000`，UI placeholder 提示填写网关 IP；不预填真实地址。
- **D11 — 归档组织与编排。** 本变更 delta 与在途未归档的 `auto-manage-control-port` 同改"结构化配置控件/默认开局模板/原始 JSON 高级视图/JSON 配置导入导出"等条目。先后归档序：**先归档/sync `auto-manage-control-port`，再归档本变更。** 否则若本变更先归档、`auto-manage-control-port` 后归档，后者对"结构化配置控件"的整段覆写会把本变更的 ingress-lock/egress-drop 回退。

## Risks / Trade-offs

- [`http_proxy`(域名) 形态下推理发送语义与 `mapping` 不同] → 本次不改发送逻辑：`mapping` 可直接 `POST 127.0.0.1:<ingress-port>/v1/...` 转发到 `out`；`http_proxy` 需 tng 当 HTTP 代理、请求目标写真实域名 URL。留待后续 InferenceView 适配（见 Open Questions）。
- [导入旧含 `socks5`/`netfilter`/`hook` ingress 或 `add_egress` 的配置会丢失这些条目] → 锁定形态下客户端本不应有；给出明确提示而非静默丢失。
- [`verify` 默认 `passport`/`tpm` 不适配所有部署] → 暴露 `model`/`as_provider` 可改；更细字段属 egress attest 侧、客户端不需要。
- [`ohttp` 写死 `header_passthrough` 限制扩展] → 与 cmaas 客户端一致（3 个推理鉴权/路由头）；若后续要自定义，再议。
- [delta 覆盖序回退] → mitigation：D11 编排，先 sync `auto-manage-control-port` 再归档本变更。

## Migration Plan

纯前端契约/UI 收紧 + 后端 `prepare_config` 增加 ingress 收口。旧 `tng-runtime.json`/导入 JSON 中含 `add_egress`、`socks5`/`netfilter`/`hook` ingress 的条目：启动时被后端 `prepare_config` 丢弃、导入时被前端 `parse` 丢弃并提示；`control_interface.restful` 仍按 `auto-manage-control-port` 丢弃/注入。无数据/接口迁移。回滚＝`git revert` 本次提交。

## Open Questions

- `InferenceView` 在 `http_proxy`(域名) 形态下的发送适配（`mapping` 与 `http_proxy` 发送语义不同）——本次范围外，留作后续一项独立变更。
