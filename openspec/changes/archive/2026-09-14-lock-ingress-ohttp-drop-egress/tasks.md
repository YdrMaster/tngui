## 1. 前端契约/模型：ingress 锁定形态 + 去 egress

- [x] 1.1 改 `frontend/src/formspec.ts`：`ConfigModel` 删除 `add_egress`；`INGRESS_MODES=[ "mapping","http_proxy" ]`，删除 `EGRESS_MODES`/`EGRESS_FIELDS`；`INGRESS_FIELDS` 重写为两种形态——`mapping`：`rules` 默认 `[{ in:{host:"127.0.0.1", port:<内置默认>}, out:{host:"", port:10000} }]`；`http_proxy`：`proxy_listen` 默认 `{host:"127.0.0.1", port:<内置默认>}` + `dst_filters` 单文本 `domain`；新增常量 `HEADER_PASSTHROUGH=["x-model","x-api-key","authorization"]` 与 `verify` 默认 `{model:"passport",as_provider:"tpm"}`；`EntryModel` 增加 `verify?: {model:string;as_provider:string}`；`defaultModel()` 改为一条锁定形态 OHTTP `mapping` ingress、`no_ra=false`、含 `verify` 默认值、不含 `add_egress`。验证：`npm run typecheck` 通过；`serialize(defaultModel())` 结果不含 `add_egress`、不含 `control_interface.restful`、`add_ingress[0]` 含 `ohttp` 且 `no_ra` 缺失而 `verify` 存在。
- [x] 1.2 改 `frontend/src/configmodel.ts`：`serialize` 不输出 `add_egress`；对每条 ingress 注入锁定 `ohttp`（`header_passthrough.request_headers` = 写死常量）并按互斥规则产 `no_ra`/`verify`（`no_ra=true` → 出 `"no_ra":true` 不出 `verify`；`no_ra=false` → 出 `verify` 不出 `no_ra`）；`parse` 丢弃 `add_egress`、丢弃每条 ingress 的 `ohttp`（回填用锁定值）、读 `verify` 回填 `EntryModel.verify`（有 `verify` 则 `no_ra=false`，无则回填旧 `no_ra`），且仅认 `mapping`/`http_proxy` 两种 ingress tag，其余形态被丢弃并在 `error` 中提示。验证：`npm run test` 通过。
- [x] 1.3 重写 `frontend/src/configmodel.test.ts`：删除 egress 模式用例与 `no_ra` 恒定平铺断言；新增用例——`serialize` 含锁定 `ohttp` 且 `header_passthrough` 恰为 3 个 header；`no_ra/verify` 互斥两态；导入含 `add_egress` 的 JSON → `add_egress` 丢弃；导入含 `ohttp` 自定义值 → 丢弃并用锁定值；导入含 `socks5`/`netfilter` ingress → 被丢弃并 `error` 提示；`http_proxy` 的 `dst_filters.domain` 单文本回填往返。验证：`npm run test` 全绿。

## 2. 后端 prepare_config：去 egress + ingress 本地监听强制回环

- [x] 2.1 改 `tngui-core/src/config.rs::prepare_config`（在既有 `control_interface.restful` 注入之外）：删除 root 下的 `add_egress`；遍历 `add_ingress`，对每条 ingress 强制本地监听 host=`127.0.0.1`（`mapping` 的 `in.host`、`http_proxy` 的 `proxy_listen.host`）；保留 `auto-manage-control-port` 的 restful 注入逻辑不变。`ingress` 的 `ohttp`/`verify` 由前端序列化产出，后端原样透传、不强制。验证：`cargo test -p tngui-core` 通过；新增单测——含 `add_egress` 的配置 prepare 后 `add_egress` 被去；`mapping` `in.host="0.0.0.0"` → `127.0.0.1`；`http_proxy` `proxy_listen.host="10.0.0.1"` → `127.0.0.1`；restful 注入仍生效。

## 3. 前端 UI：EntryEditor 锁定形态 + FieldRenderer

- [x] 3.1 改 `frontend/src/components/EntryEditor.vue`：移除 `kind="egress"` 分支与 egress 模式/字段引用；模式选择器收敛为"远端类型"二选一（`地址端口=mapping`、`域名=http_proxy`），切换时仍 reset 字段但保持 `ohttp`（常开）与 `no_ra`；本地监听 `host` 以 `127.0.0.1` 只读呈现、`port` 可编辑；`地址端口` 渲染 `out` 的 IP+port，`域名` 渲染 `dst_filters.domain` 单文本框；`no_ra` 开关 + 条件 `verify`（`model`/`as_provider` 两字段，默认 `passport`/`tpm`）；移除逐条"高级原始 JSON"折叠（未结构化字段由全局原始 JSON 视图兜底）。验证：`npm run build` 通过；结构化 ingress 仅出现两种远端类型，本地监听 host 只读、port 可配。
- [x] 3.2 改 `frontend/src/components/FieldRenderer.vue`：支持 `dst_filters.domain` 的单文本类型渲染；`mapping` 的 `in.host` 只读呈现 `127.0.0.1`（不接受输入）；提供 `verify` 的 `model`/`as_provider` 文本输入。验证：`npm run build` 通过；`域名` 形态单文本、`mapping` 本地 host 只读。

## 4. SettingsView 收编 + InferenceView 清理

- [x] 4.1 改 `frontend/src/views/SettingsView.vue`：删除 `add_egress` 卡片与 `addEgress`/`removeEgress`；"密态推理"卡删除 `localPort`/`outboundAddress`/`configJson`/`jsonValue`/`jsonOpen`/`jsonMode`/`applyJson`/`copyLocal` 及本地 URL 复制与配套导入导出 JSON 弹窗，保留 API Key 与 Model，其"导入/导出配置"按钮指向"高级 TNG 配置"的导入导出（沿用既有 `onImport`/`onExport`）。验证：`npm run build` 通过；设置页无 egress 卡片；密态推理卡仅 API Key/Model，无独立本地端口/远端输入。
- [x] 4.2 改 `frontend/src/views/InferenceView.vue`：`inferencePort` 去掉 `socks5` 分支，仅保留 `mapping`（`rules[0].in.port`）与 `http_proxy`（`proxy_listen.port`）。验证：`npm run typecheck` 通过；`http_proxy` 形态可推到监听端口。

## 5. 文档

- [x] 5.1 更新 `docs/tngui-ui-guide.md`：ingress（客户端侧）可选模式收敛为 `mapping`（地址端口）/`http_proxy`（域名），删除 `socks5`/`netfilter`/`hook` 作为客户端可选模式的描述；说明客户端无 `add_egress`；说明 `ohttp` 常开且 `header_passthrough` 写死、`no_ra`/`verify` 互斥语义（默认 verify on）；说明密态推理本地端口与远端取自结构化 ingress（feature 卡仅 API Key/Model）。验证：`grep -nE "socks5|netfilter|hook" docs/tngui-ui-guide.md` 不出现将三者列为客户端可选 ingress 模式的措辞；`grep -n "add_egress" docs/tngui-ui-guide.md` 描述与"客户端无 egress"一致。

## 6. 构建与回归

- [x] 6.1 在 `frontend/` 跑 `npm run typecheck`、`npm run test`、`npm run build` 全绿；在仓库根跑 `cargo test -p tngui-core` 全绿。验证：各命令退出 0。
- [x] 6.2 静态核对 `specs/gui-shell/spec.md` 全部 scenario（源码 grep + 人工确认）：ingress 仅两种远端类型、本地监听 host 锁 `127.0.0.1` 只读且 port 可配、`ohttp` 常开且 `header_passthrough` 写死 3 头、`no_ra`/`verify` 互斥（不恒定平铺 `no_ra`）、无 `add_egress` 结构化控件、默认模板为锁定形态 ingress、导入丢 `add_egress` 与非 `mapping`/`http_proxy` ingress、密态推理卡只 API Key+Model。验证：每个 scenario 对应一项可观察确认通过。
- [x] 6.3 `openspec validate --changes "lock-ingress-ohttp-drop-egress" --json` 返回 `valid: true`；`openspec status --change "lock-ingress-ohttp-drop-egress"` 确认 apply 门槛满足。验证：`validate` 合法、`status` 显示 planning 完成。提示：归档前建议先归档/sync `auto-manage-control-port`（见 `design.md` D11），避免两条 delta 对同一 requirement 的覆盖序导致回退。
