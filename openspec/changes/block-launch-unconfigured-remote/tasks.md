## 1. 后端启动门禁

- [x] 1.1 在 `tngui-core/src/config.rs` 的 `PrepareError` 增加 `IngressInvalid(String)` 变体及其 `Display`（形态 "ingress 配置不可启动: {msg}"）与 `std::error::Error` 实现 — verify：单测断言 `PrepareError::IngressInvalid("x".into()).to_string()` 含 "ingress 配置不可启动"
- [x] 1.2 实现 `validate_ingress_for_launch(root)`：遍历 `add_ingress` 仅对 `mapping` 取 `rules[*].out.host`（兼容遗留 `{in,out}`），trim 后须 `parse::<std::net::Ipv4Addr>()` 成功，缺失/空串/全空白/非 IPv4 返回 `IngressInvalid`；`http_proxy` 与空 `rules` 不拦 — verify：`cargo test -p tngui-core prepare_rejects_empty_mapping_out_host prepare_rejects_non_ipv4_mapping_out_host prepare_rejects_legacy_mapping_missing_out_host prepare_accepts_valid_mapping_out_host_rules_and_legacy prepare_accepts_http_proxy_empty_domain` 全通过
- [x] 1.3 在 `prepare_config`（丢弃 `add_egress`、强制 ingress 本地监听回环 之后，`Ok(v)` 之前）调用 `validate_ingress_for_launch(root)?`；失败时不写盘不 spawn — verify：默认模板序列化 JSON 经 `prepare_config(..)` 返回 `Err(PrepareError::IngressInvalid(_))`；`launch_tng` 在该 Err 提前 return

## 2. 前端同语义判定与单测

- [x] 2.1 在 `frontend/src/formspec.ts` 导出 `isRemoteConfigured(model)` + 私有 `isValidIpv4`（复刻 `std::net::Ipv4Addr::from_str`） — verify：`npx vitest run src/formspec.test.ts` 全通过
- [x] 2.2 新增 `frontend/src/formspec.test.ts`，覆盖缺省留空=false、合法 IPv4(true)、前导零=false、超界/非 4 段/域名=false、首尾空格=true、全空白=false、缺 out=false、空 rules=true、http_proxy 空 domain=true、多条任一非法=false — verify：上述用例逐项通过

## 3. 概览免弹窗 UX 与设置跳转

- [x] 3.1 `frontend/src/App.vue`：菜单跳转抽 `goTo`（保留离开设置自动保存语义）+ `provide("navigate", goTo)` + 模板 `goTo(item.key as View)` — verify：三视图切换正常、离开 dirty 设置仍自动保存
- [x] 3.2 `frontend/src/views/Overview.vue`：注入 `navigate`；`remoteConfigured`/`startDisabled` computed；启动按钮 `:disabled` + `a-tooltip`；远端未配置且未运行时 `a-alert` 引导、`navigate('settings')` — verify：vue-tsc 无类型错误
- [x] 3.3 保持 `onToggle` 的 catch 仅承载非远端配置类错误 — verify：远端未配置时不出现"启动失败"弹窗

## 4. ingress 控件按行分组呈现

- [x] 4.1 `frontend/src/components/EntryEditor.vue`：远端类型选择 + 当前远端字段置于同一横排（flex 容器，固定宽 select + flex:1 远端字段）；远端类型切换即时生效（`onRemTypeChange` 去除 `Modal.confirm`，直接 `entry.mode=next` + `defaultFields(next)`）— verify：视觉两件同行；mapping/http_proxy 切换后同行字段随之替换、重置为该类型默认，且无确认弹窗
- [x] 4.2 `frontend/src/components/EntryEditor.vue`：远程证明开关（表示 ra，标签"远程证明"）+ verify 配置置于同一横排；开关开（ra/`no_ra=false`）同行渲染 model+as_provider（复用 FieldRenderer verifyFields），开关关（`no_ra=true`）仅显示开关不渲染 verify；底层仍存 `no_ra`，开关经取反 computed 绑定 — verify：开关切换后 verify 行随之显隐且与开关同行；标签为"远程证明"且无"(no_ra)"
- [x] 4.3 `frontend/src/components/EntryEditor.vue`：本地监听独占一行，移除原"远端类型+no_ra"同行旧分组结构 — verify：本地监听不与远端类型/远端字段或远程证明/verify 同行
- [x] 4.4 前端 `npx vue-tsc --noEmit` 无类型错误、`npx vitest run` 既有用例不回归 — verify：两者退出码 0

## 5. 校验与收尾

- [x] 5.1 `openspec validate block-launch-unconfigured-remote` 通过 — verify：命令退出码 0
- [x] 5.2 `cargo test -p tngui-core` 全通过且 `cargo fmt --check` 干净 — verify：退出码 0
- [x] 5.3 前端 `npx vitest run` 全通过且 `npx vue-tsc --noEmit` 无类型错误 — verify：两者退出码 0
- [ ] 5.4 人工冒烟：默认开局点启动→按钮禁用+出现引导；"前往设置"跳设置；ingress 编辑器三行分组（mapping 下"远端类型+地址端口"同行、远程证明开关开时"开关+verify"同行/关时仅开关、本地监听独立行，切 http_proxy 远端字段改域名同行且无确认弹窗）；远程证明开关标签为"远程证明"（无"(no_ra)"）、开=渲染 verify、关=仅开关；填合法网关 IPv4 保存回概览→按钮可点→点启动→四卡转起 — verify：观察到如述
