## ADDED Requirements

### Requirement: 映射远端出口须合法 IPv4 否则拒绝启动

系统须（SHALL）在拉起 tng 前校验每条 `mapping` ingress 的远端 `out.host`：经首尾空格 trim 后须为合法 IPv4 地址（恰好 4 段、每段 0-255、拒绝前导零——与该字段在 tng 侧 `Option<Ipv4Addr>` 的解析一致）。任一 `mapping` 规则的 `out.host` 缺失、为空串/全空白、或非合法 IPv4 时，系统绝不（MUST NOT）写盘 `tng-runtime.json`、绝不（MUST NOT）拉起 tng，并须（SHALL）以明确错误拒绝该次启动。`http_proxy` 形态不因 `dst_filters.domain` 为空被拒（tng 仍加载该形态，空 domain 仅匹配不到远端）；`mapping` 的 `rules` 为空数组时不被拒（不携带生效规则不构成远端缺失）。

#### Scenario: 默认占位与空串/空白被拒

- **WHEN** 用户以默认模板、或以 `out.host` 为空/全空白的 `mapping` ingress 触发启动
- **THEN** 系统不写盘、不拉起 tng，并以明确错误拒绝（提示须填写远端网关 IPv4 地址）

#### Scenario: 非合法 IPv4 被拒

- **WHEN** 某条 `mapping` 规则的 `out.host` 为域名、非 4 段、含超界段、或含前导零（如 `010.0.0.1`）
- **THEN** 系统不写盘、不拉起 tng，并以明确错误拒绝

#### Scenario: 合法 IPv4 放行

- **WHEN** 所有 `mapping` 规则的 `out.host` 经 trim 后均为合法 IPv4
- **THEN** 启动流程继续（写盘并拉起 tng）

#### Scenario: 覆盖所有启动入口

- **WHEN** 用户经概览启动、或经设置页保存/重启、或经离开设置时的自动重启触发启动，且存在 `mapping` 的 `out.host` 未配置/非法
- **THEN** 任一入口均不拉起 tng，并给出明确错误

#### Scenario: http_proxy 空 domain 不在门禁范围

- **WHEN** 仅有的 ingress 为 `http_proxy` 且 `dst_filters.domain` 为空
- **THEN** 启动放行（本要求不门禁 `http_proxy` 远端；tng 加载该形态与空 domain 无关）

#### Scenario: 空 rules 不被拒

- **WHEN** 某条 `mapping` 的 `rules` 为空数组
- **THEN** 该条不触发"远端未配置"拒绝

### Requirement: 远端未配置时概览禁用启动并引导设置

系统须（SHALL）在概览视图，于 tng 未运行且远端未配置（按"映射远端出口须合法 IPv4 否则拒绝启动"的同一判定为"远端未配置"）时，禁用启动控件、保持停止控件可用，并通过引导式提示告知用户去设置视图填写远端网关地址；该引导须（SHALL）提供可直接跳转到设置视图的动作。远端已配置或 tng 运行中时不出现该禁用与引导。前端判定远端是否配置须（SHALL）与后端启动拒绝语义一致，使"启动控件可用"当且仅当"后端会接受"以避免按钮可点击却在点击后才报错。系统绝不（MUST NOT）以因远端未配置而弹出的启动失败弹窗作为其主引导方式——引导须在启动控件被禁用前完成。

#### Scenario: 远端未配置且未运行 → 禁用启动并引导

- **WHEN** tng 未运行且任一 `mapping` 的 `out.host` 缺失/为空/非合法 IPv4
- **THEN** 启动控件不可交互并附说明性提示；概览以引导式提示指引用户前往设置填写远端地址端口；该提示含可直接跳转到设置视图的动作

#### Scenario: 停止控件不受影响

- **WHEN** tng 处于运行中且远端未配置（例如运行中清空了远端）
- **THEN** 停止控件保持可用，且不出现远端引导

#### Scenario: 远端已配置 → 可启动且无引导

- **WHEN** 远端已按本判定配置完成，或 tng 正在运行
- **THEN** 启动控件可交互且不出现远端引导

#### Scenario: 前后端判定一致无事后弹窗

- **WHEN** 概览启动控件处于可交互状态且用户触发启动
- **THEN** 对同一配置经任意启动入口触发，后端均接受并启动，不产生因远端未配置的"启动失败"弹窗

### Requirement: ingress 控件按行分组呈现

系统须（SHALL）在 ingress 的结构化编辑器中按以下三行分组呈现一条 ingress 的控件：第一行为本地监听（host 只读 `127.0.0.1` + port），独占一行；第二行为远端类型选择（`mapping`/`http_proxy`）与其当前远端类型对应的远端字段（`mapping` → 地址端口 IP+port，`http_proxy` → 域名单文本框），二者在同一横排依次出现，且远端类型切换须（SHALL）即时生效——直接切换控件显示状态与对应远端字段、将字段重置为该类型的默认值，绝不（MUST NOT）弹窗要求用户确认；第三行为远程证明开关（表示"ra"——是否启用远程证明，标签为"远程证明"）与其 verify 配置（model / as_provider，仅在开关开启即 `no_ra=false` 时出现），二者在同一横排依次出现；开关关闭即 `no_ra=true` 时该行仅显示开关，不渲染 verify。该分组不得改变锁定的字段集、不改变 ingress 仅为 `mapping`/`http_proxy` 两种形态、不改变 `no_ra`/`verify` 的互斥序列化语义——仅是呈现排布与切换交互的变化。窄屏下允许单一横排内换行，但不得把上述同一横排的两个控件错位到不相关行。

#### Scenario: 远端类型与远端字段同行

- **WHEN** 渲染一条 ingress 的远端配置
- **THEN** 远端类型选择与当前类型对应的远端字段出现在同一横排（`mapping` → 地址端口，`http_proxy` → 域名）

#### Scenario: 远端类型切换即时生效无弹窗

- **WHEN** 用户在远端类型选择中从当前类型切换为另一类型
- **THEN** 控件即时切换为该类型的显示状态、远端字段重置为该类型默认值，且不出现任何确认对话框

#### Scenario: 远程证明开关表示 ra

- **WHEN** 渲染一条 ingress 的远程证明配置
- **THEN** 远程证明开关标签为"远程证明"，表示"是否启用远程证明"（ra）；开关开启（ra=on/`no_ra=false`）时 verify 配置出现在同一横排；开关关闭（ra=off/`no_ra=true`）时该行仅显示开关，不渲染 verify

#### Scenario: 本地监听独立成行

- **WHEN** 渲染一条 ingress 的本地监听
- **THEN** 本地监听独占一行，不与远端类型/远端字段或远程证明/verify 同行
