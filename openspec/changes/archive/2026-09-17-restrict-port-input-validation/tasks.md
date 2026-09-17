## 1. 前端端口模型与序列化

- [x] 1.1 引入共享端口有效性判定，并把 `1~65535` 外、非整数、`0` 均判为非法；为该判定补 Vitest 单测。验证：`cd frontend && npm test` 通过新用例。
- [x] 1.2 调整 mapping 远端端口与反代对外端口的模型/解析规则，使缺失、空、`0` 与越界值不再静默回填默认端口并可在模型中暴露为无效；补 `configmodel.test.ts` 覆盖空值、`0`、`65535`、`65536`。
- [x] 1.3 调整 `http_proxy` 目标端口的模型/序列化：留空或导入 JSON 中缺省时省略 `dst_filters.port`；显式有效端口保留；显式 `0`/越界值报错。补 `configmodel.test.ts` 覆盖“省略端口、有效端口、显式 0、65536”。
- [x] 1.4 同步原始 JSON 应用和配置导入的错误路径，确保非法端口回填失败且当前配置不变；补一个非法导入回填用例。

## 2. 结构化输入控件

- [x] 2.1 给 FieldRenderer 与 EntryEditor 中的用户可编辑端口数字框统一声明 `1~65535` 整数边界，mapping 远端端口显示必填提示，http_proxy 目标端口允许留空。验证：分别输入 `0`、`70000`、空、`65535`，检查模型只在有效数字或空值间变化。
- [x] 2.2 确认切换远端类型时 mapping 默认 `80`、http_proxy 默认 `443` 不被破坏；补/更新 `formspec.test.ts`。验证：新增/切换 ingress 后远端端口默认仍正确。

## 3. 后端启动校验

- [x] 3.1 在 tngui-core 启动前校验 `tngui_outward.port`、每条 mapping 的当前 `out.port`、每条 http_proxy 的显式 `dst_filters[*].port`；错误包含 ingress 序号与字段位置。补 Rust 单测覆盖合法、缺失可选端口、缺失必填端口、`0`、`65535`、`65536`、非整数。
- [x] 3.2 保证后端必填端口校验同时作用于结构化、原始 JSON 和导入后的启动路径，不因 JSON 缺少 `tngui_outward` 就静默回退；补集成级配置校验测试。验证：非法端口启动 API 返回明确错误且不写运行配置。

## 4. 文档与整体验证

- [x] 4.1 更新 `docs/tngui-ui-guide.md` 中三类端口字段的描述：取值 `1~65535`、mapping/反代端口必填、http_proxy 可留空表示不限定目标端口。验证：文档中不再把 `0` 描述为可选端口或特殊空端口。
- [ ] 4.2 运行前端与 Rust 检查，并让 OpenSpec validate 通过。验证命令：`cd frontend && npm run test`、`cargo test`、`openspec validate restrict-port-input-validation --type change --strict`。
