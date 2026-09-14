## Why

在途变更 `lock-ingress-ohttp-drop-egress` 把默认 ingress 的 `out.host` 留空作为"待填写网关 IP"的占位（决策 D10），但启动流程原样把它透传给 tng。tng 的 `RuleEndpoint.host: Option<Ipv4Addr>` 不接受空串，配置加载期即以 `data did not match any variant of untagged enum MappingDe` 崩溃退出，控制面永不绑定，概览四卡恒停"关停/未初始化/未获取"，用户只能在进程日志里看到难以理解的错误。需在拉起 tng 之前拦截"远端未配置"并引导用户去设置填写，避免拉起注定失败的 tng，且不再依赖事后弹窗。

此外，当前 ingress 编辑器把"远端类型"与"远程证明开关(no_ra)"放在顶部同一行，而"本地监听""远端字段""verify 配置"各自纵向堆叠，语义相关的控件（远端类型↔远端字段、远程证明开关↔verify）被拆到不同行，扫视与编辑割裂。本变更一并按语义把相关控件归到同一横排，使一条 ingress 的配置面在视觉上对齐其结构。

## What Changes

- **映射远端出口未配置/非法时拒绝启动**：后端 `prepare_config` 在拉起 tng 前拦截——`mapping` 每条规则 `out.host` 经 trim 后须为合法 IPv4（与 tng `mapping_rule::RuleEndpoint.host: Option<Ipv4Addr>` 及 `into_checked`"out.host is required"一致，并复刻 `std::net::Ipv4Addr::from_str`：拒空、拒非 4 段、拒每段超 255、拒前导零）；不满足则返回 `IngressInvalid`、不写盘、不 spawn。覆盖概览启动、设置页保存/重启、离开设置自动重启三条启动入口。`http_proxy` 的 `dst_filters.domain` 即便为空 tng 仍加载（仅匹配不到远端），与既有处理一致，不拦。
- **概览在远端未配置时禁用启动并引导设置（免弹窗）**：概览启动按钮在"tng 未运行 且 远端未配置"时不可交互、附 tooltip 说明；同时呈现引导式 `a-alert`，指向"设置 → 入口"的远端地址端口，其"前往设置"动作真正跳转到设置视图。停止按钮不受影响；远端已配置或 tng 运行中时不出现引导。
- **前端判定与后端同语义**：前端用同一套 `isRemoteConfigured` 规格（`mapping` 的 `out.host`：trim 后合法 IPv4；`http_proxy` 不拦、空 rules 不拦），使"禁用"与"后端拒绝"对齐，杜绝"按钮可通过、点了才弹窗"。
- **ingress 控件按行分组呈现与切换交互**：在 ingress 结构化编辑器中按三行分组——本地监听独占一行；"远端类型选择 + 其当前类型对应的远端字段（地址端口/域名）"同一横排，且远端类型切换即时生效（直接切换显示状态、重置为该类型默认字段、不弹窗确认）；"远程证明开关（表示 ra、标签为'远程证明'）+ verify 配置"同一横排，开关开（ra/`no_ra=false`）时同行渲染 verify、开关关（`no_ra=true`）时仅显示开关。仅改呈现分组与切换交互，不改字段集、不改 `mapping`/`http_proxy` 两形态、不改 `ohttp` 常开与 `no_ra`/`verify` 互斥序列化语义。
- **不改默认模板、不回退 D10**：保留默认 `out.host` 留空占位；本变更把"留空"重新解释为"未配置"，并使 D10 的"提示填写网关 IP"成为可执行的引导而非静默占位。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `gui-shell`：新增三条要求——"映射远端出口须合法 IPv4 否则拒绝启动""远端未配置时概览禁用启动并引导设置""ingress 控件按行分组呈现"；承接并落实在途 `lock-ingress-ohttp-drop-egress` D10 的默认 `out` 占位语义（不改 D10、不回退其默认模板；ingress 行分组亦不改其锁定的字段/模式/互斥）。

## Impact

- 后端：`tngui-core/src/config.rs`（`PrepareError` 增 `IngressInvalid`；`prepare_config` 在丢弃 `add_egress`、强制 ingress 本地监听回环之后、返回前调用 `validate_ingress_for_launch`，仅拦 `mapping` 的 `out.host` 空串/非合法 IPv4；新增/调整单测，含前导零等回退边界）。
- 前端：`frontend/src/formspec.ts`（导出 `isRemoteConfigured` + 私有 `isValidIpv4` 复刻 `std::net::Ipv4Addr::from_str`）；`frontend/src/formspec.test.ts`（新增）；`frontend/src/views/Overview.vue`（启动按钮 `:disabled` + `a-tooltip`；远端未配置且未运行时 `a-alert` 引导并真跳设置）；`frontend/src/App.vue`（菜单跳转抽 `goTo` 并 `provide("navigate", goTo)`）；`frontend/src/components/EntryEditor.vue`（三行分组：远端类型与远端字段同行、远程证明开关（表示 ra，标签"远程证明"）与 verify 同行、本地监听独立成行；远端类型切换去除 Modal.confirm 弹窗、即时切换字段；开关开=`no_ra=false` 渲染 verify、关=`no_ra=true` 仅开关；移除原"远端类型+no_ra"同行旧分组）；`frontend/src/components/FieldRenderer.vue`（若 verify 行紧凑所需的最小调整）。
- 依赖与编排：本变更 delta 仅向 `gui-shell` **新增**要求，不与 `auto-manage-control-port`/`lock-ingress-ohttp-drop-egress` 已修改条目重叠；归档序沿用既有约定（先 `auto-manage-control-port`、再 `lock-ingress-ohttp-drop-egress`、最后本变更）。
- 不在范围内：不改 `http_proxy` 远端(domain)的启动门禁；不改推理发送逻辑；不含"完整 HTTP 反代 + 注入 x-model"适配器（另立独立变更）。
