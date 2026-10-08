# Tasks

## 1. 模型身份与反代测试

- [x] 1.1 移除 `body.model` 的本地 trim，保留空白字符串的原样字节与 single-segment percent-encoding；更新 `tngui-core` 代理测试断言 `" model-a "` 生成 `/models/%20model-a%20/...` 且 body 原样。
- [x] 1.2 核对精确 `POST /v1/chat/completions`、精确 `POST /v1/messages`、精确 `GET /v1/models` 与 `x-model` 语义测试；运行 `cargo test -p tngui-core proxy::` 通过。

## 2. 本地诊断快照

- [x] 2.1 在 `tngui-core/src/proxy.rs` 新增随 `ProxyHandle` 存在的共享诊断结构，记录固定类别计数，并验证身份、过大、发现与上游失败分支；运行核心 proxy 诊断测试。
- [x] 2.2 通过 `src/lib.rs` 暴露当前反代会话诊断快照命令，未启动返回保守零值；运行 Rust 编译/命令测试。
- [x] 2.3 在 `frontend/src/tauri.ts` 定义快照类型并绑定新命令；运行 TypeScript typecheck。

## 3. 诊断 UI

- [x] 3.1 在密态推理视图渲染只读反代诊断状态和固定类别计数，确认不展示敏感数据、不代表授权成功；运行/更新组件测试。
- [x] 3.2 确认 tng 重启轮询取到最新会话快照并重置计数；运行组件或集成级测试验证。

## 4. 完整验证

- [x] 4.1 在 `frontend/` 运行 `npm test` 与 `npm run typecheck`，两者均通过。
- [x] 4.2 在仓库根运行 Rust workspace tests，确认通过；修复或记录环境性失败原因。
- [x] 4.3 运行 `openspec validate stage2-local-proxy-contract --strict`，确认 delta 格式完整。

## Workflow follow-up

- [x] Sync the gui-shell delta into the main spec after implementation review.
- [x] Archive `stage2-local-proxy-contract` after tasks and validations pass.
