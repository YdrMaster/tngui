## Context

见 `proposal.md - Why`。回归根因：`mapping` 的 `out.host: ""` 不被 tng 在配置加载期接受（`TNG/tng/src/config/mapping_rule.rs` 的 `RuleEndpoint.host: Option<Ipv4Addr>` 与 `into_checked`"out.host is required"），tng 退出 → 控制面永不绑定 → 概览四卡恒停"关停/未初始化/未获取"。该回归由在途 `lock-ingress-ohttp-drop-egress` 的决策 D10（默认 `out.host` 留空占位）引入。客户端真实链路依据 `cmaas-deploy/publish/docs/03-使用.md` §2：`out` 为集群网关 NodePort 的节点 IP、host 必为 IP。既有同族先例：`auto-manage-control-port` 以"无法分配空闲回环端口则拒绝启动并展示说明性错误"承接"管控端口自动选取"。ingress 编辑器当前（`EntryEditor.vue`）顶部 `a-space` 放"远端类型 select + no_ra switch"，下方 `a-form layout="vertical"` 纵向堆 本地监听 / 远端字段 / verify；语义相关控件被拆。锁定形态由 `lock-ingress-ohttp-drop-egress` 确定（`mapping`/`http_proxy` 两形态、`ohttp` 常开、`no_ra`/`verify` 互斥），本变更的行分组只动分组排布。

## Goals / Non-Goals

**Goals:**
- 在拉起 tng 前切断"远端未配置 → 拉起注定失败的 tng → 卡片恒停"链路，并覆盖全部启动入口（概览启动、设置保存/重启、离开设置自动重启）。
- 以概览"禁用启动 + 引导设置（真正跳转）"的免弹窗 UX 取代事后弹窗。
- 前后端使用同一判定语义，杜绝"按钮可点击、点了才报"。
- 按语义把 ingress 相关控件同行分组：本地监听独立行、远端类型↔远端字段同行、远程证明开关↔verify 同行。

**Non-Goals:**
- 不回退/不改 `lock-ingress` D10 的默认 `out.host` 留空占位，不改默认开局模板形态。
- 不对 `http_proxy` 的 `dst_filters.domain` 施加同款门禁。
- 不改推理发送逻辑；不引入"完整 HTTP 反代 + 注入 x-model"适配器（另立独立变更）。
- 不还原 v0.2.2"裸点启动即转绿"的误导体验。
- ingress 行分组不改字段集/模式/序列化；窄屏仅允许同组内折行，不强制单行像素等高。

## Decisions

- **D1 — 在 `prepare_config` 拦截，后端是真实闸门。** 仅拦 `mapping` 的 `out.host`：经 trim 后 `parse::<Ipv4Addr>()` 须成功（复刻 `std::net::Ipv4Addr::from_str`，含拒前导零）；`http_proxy` 不拦、空 `rules` 不拦。失败返回新增 `PrepareError::IngressInvalid`、不写盘、不 spawn，使三条启动入口统一被拦。备选：仅前端禁用——否决，导入/外部编辑/设置页直接重启可绕过前端。
- **D2 — 概览禁用启动 + 引导设置（免弹窗）。** 启动控件 `:disabled="!tngRunning && !remoteConfigured"`，附 `a-tooltip`；远端未配置时 `a-alert` 引导，其"前往设置"真正跳转——`App` 将菜单跳转抽 `goTo` 并 `provide("navigate", goTo)`，Overview 注入。停止控件不受禁用。
- **D3 — 前端 `isRemoteConfigured` 与后端 `validate_ingress_for_launch` 同语义。** 共用判定，前端 `isValidIpv4` 精确复刻 `Ipv4Addr::from_str`（4 段、0-255、拒前导零；先 trim）；由此 `remoteConfigured=true ⇔ 后端接受`，杜绝"按钮可点、点了弹窗"。
- **D4 — 保留 `lock-ingress` D10 默认空占位。** 不预填假 IP；把"留空"重新解释为"未配置"，并由引导落地 D10 的"提示填写网关 IP"。
- **D5 — ingress 控件三行分组（flex 容器，非 a-row，便于组内折行）。** 本地监听独占行；第二行用 flex 容器放"远端类型 select（固定宽）+ 当前远端字段（flex:1）"，切类型沿用 `onRemTypeChange` 重置语义；第三行 flex 容器放"no_ra 开关（固定宽）+ verify（flex:1，`no_ra` 开时不渲染）"。verify 复用 `FieldRenderer` 的 `verifyFields`（已为水平 `a-space`），无需改其结构。备选：用 a-row/a-col——否决，窄屏不易组内折行。

## Risks / Trade-offs

- [v0.2.2"点启动即转绿"体验不复现] → 不还原：无真实出向的"运行"是假象；改为引导填好真出向后再转绿。
- [设置页保存/重启在远端未配置时仍会弹"保存失败"] → 保留后端 `IngressInvalid` 兜底，本变更不把设置页保存/重启也禁用（Open Questions）。
- [前后端 IPv4 判定偏差 → 弹窗或错杀] → 单一 `isRemoteConfigured` + `isValidIpv4` 复刻 `Ipv4Addr::from_str`，单测覆盖前导零/首尾空格/超界，后端兜底。
- [前端禁用依赖响应式 model] → 复用单例 `useTngConfig` 共享 `model`，`isRemoteConfigured(model.value)` 为 `computed`。
- [行分组与 `lock-ingress` EntryEditor 改动叠加] → 行分组只动布局/分组，不动字段集与 `onRemTypeChange`；delta 为 ADDED，不覆盖其 MODIFIED。

## Migration Plan

纯新增门禁 + UI 引导 + ingress 行分组，不改配置形态、无数据迁移。回滚＝`git revert`。

## Open Questions

- 是否把"设置页保存/重启/离开自动重启"在远端未配置时也禁用（而非仅概览）？当前仅概览引导，设置页仍由后端 `IngressInvalid` 兜底并弹"保存失败"。
