## 1. tngui-core pre-TNG proxy

- [x] 1.1 新增内部模型路径工具：从 `POST /v1/chat/completions` 与 `POST /v1/messages` 识别 supported path/query，从 JSON object 顶层读取 string `model` 并 trim；实现单一路径 segment percent-encoding（保留字母数字与 `-._~`，编码 `/`、`%`、UTF-8 多字节与控制字符）。— verify：Rust 工具单测覆盖普通模型、`provider/model`、前后空白、locale Unicode、百分号、query 保留
- [x] 1.2 修改 `tngui-core/src/proxy.rs` 请求处理：body 原样保留；移除 `x-model`；仅对 supported path 做 `/models/{encoded-model-segment}{original-path}` 注入；按现有完整反代回应并保留 response 透传。— verify：Rust 集成测试断言上游收到的 path、query、body 字节与 credential header
- [x] 1.3 对 supported path 的无效输入 fail-closed：缺 `model`、非 string、空/纯空白、非 UTF-8 JSON object、超 10 MiB 分别回 400/413，并不向 tng 写任何请求；unsupported path 不注入模型。— verify：Rust 集成测试断言错误码与 upstream 未被访问
- [x] 1.4 删除/改写 `x-model` 相关 proxy 测试断言，改为“客户端伪造 x-model 不影响 path 与 body”。— verify：`cargo test -p tngui-core` 全绿

## 2. TNG ingress 配置契约

- [x] 2.1 更新 `frontend/src/formspec.ts`：`HEADER_PASSTHROUGH` 改为 `["authorization","x-api-key"]`；新增/替换 locked OHTTP 常量以包含 capi 固定 `path_rewrites`；`defaultModel()` 使用新锁定契约。— verify：前端序列化模型测试断言新 form model
- [x] 2.2 更新 `frontend/src/configmodel.ts` 的 ingress 序列化与导入回填：`mapping`/`http_proxy` 每条 ingress 均输出锁定 `ohttp.path_rewrites` 与 credential passthrough，且丢弃导入/回填中的 ingress `ohttp`；保留现有 `ohttp.tls` 派生与 `tngui_outward` 语义。— verify：前端序列化/导入/导出测试全绿
- [x] 2.3 更新前端 config-model 测试，删除三头 `x-model` 断言并新增固定 path rewrite 测试。— verify：`npm run test` 全绿

## 3. 文档与 UI 面描述

- [x] 3.1 更新 `docs/tngui-ui-guide.md`：模型身份说明改为 body.model → pre-TNG path；TNG ingress `ohttp` 描述改为锁定 path_rewrites + `authorization`/`x-api-key`，移除用户可感知的 `x-model` 语义。— verify：grep 到处 `x-model` 只保留删除/旧契约迁移说明，不作为当前鉴权方式
- [x] 3.2 更新根 `README.md`：当前 TNG 版本文字由 2.8.0 改为 `2.9.2`；补充 tngui 作为 pre-TNG proxy 的模型 path 直连要求。— verify：README 中 TNG 版本与 `TNG_VERSION` 一致，没有把 `x-model` 描述为当前模型身份
- [x] 3.3 检查推理视图与 ingress 编辑帮助文案，不出现“注入 x-model / x-model 鉴权”的当前态描述。— verify：全局前端 grep 与人工检查通过

## 4. 质量与验收

- [x] 4.1 核心运行回归：`cargo test -p tngui-core`。— verify：0 失败
- [x] 4.2 前端回归：`npm run test` 与 `npm run typecheck`。— verify：0 失败
- [x] 4.3 手动冒烟：启动 tng 后观察 tng-runtime.json 每条 ingress 含锁定 `ohttp.path_rewrites`；`POST /v1/chat/completions` 请求到达 TNG 前已为 `/models/{model}/v1/chat/completions`。— verify：日志/抓包或集成测试断言路径承载模型
