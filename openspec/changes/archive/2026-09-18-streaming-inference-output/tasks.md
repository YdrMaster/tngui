# Tasks

## 1. tngui-core 增量协议解析

- [x] 1.1 在 `tngui-core/src/inference.rs` 新增增量 dechunk 状态机（消费任意分片字节、产出完成的 chunk 数据、保留残余缓冲、终帧与异常处理），并用字节级拆包用例验证：多帧帧体跨/跨尾 `CRLF`、尺寸行分片、终帧+trailer、整段拆半。验证：新增单测进入 `cargo test -p tngui-core` 通过。
- [x] 1.2 新增 SSE 事件增量解析（`data:` 行、空行分隔事件、容忍 `\r\n` 行尾、忽略注释行、事件跨网络分片缓冲），并验证跳过无 `delta.content` 事件、`data: [DONE]` 识别。验证：新增单测进入 `cargo test -p tngui-core` 通过。

## 2. 流式推理函数与 core 回归

- [x] 2.1 实现 `send_inference_stream`（body 含 `"stream": true`，HTTP/1.1 + `Connection: close`，2xx+`text/event-stream` 走增量 dechunk+SSE、每节 content 回调 delta，`[DONE]` 即成功返回；非 chunked/非 SSE 2xx 与全量错误路径缓冲进既有诊断），并通过 fake 上游测试验证：成功流逐 delta 顺序回调、`[DONE]` 正常结束、无 content 事件不回调。验证：`cargo test -p tngui-core inference` 通过。
- [x] 2.2 覆盖失败语义测试：连接失败、非 2xx（网关 502 JSON）、2xx 非 SSE（WAF HTML）、SSE data JSON 解析失败、`[DONE]` 前 EOF 断流、10 MiB 上限；断言诊断含脱敏请求（无明文 Bearer）与响应原文摘要，断流诊断标注未收到 `[DONE]`。验证：`cargo test -p tngui-core inference` 通过。
- [x] 2.3 移除旧非流式 `send_inference` core 函数并迁移/删除对应旧断言（`x-model` 不注入断言改由流式测试承载），保持 `pub use` 导出面干净。验证：`cargo test -p tngui-core` 全通过，`send_inference` 无残留引用（`grep` 核对）。

## 3. Tauri 命令层

- [x] 3.1 在 `src/lib.rs` 新增 `send_inference_stream(port, model, api_key, prompt, on_delta: Channel<String>)` 命令并注册到 `invoke_handler`：每个 content delta 推送 Channel、完整结束 `Ok(())`、失败 `Err(诊断)`。验证：`cargo test`（workspace）通过且新命令在 `generate_handler!` 列表。
- [x] 3.2 删除旧 `send_inference` Tauri 命令与注册项。验证：全仓 `grep -rn "send_inference\b"` 仅剩新命令/新契约相关命名，`cargo test` 通过。

## 4. 前端接入

- [x] 4.1 在 `frontend/src/tauri.ts` 新增 `sendInferenceStream(port, model, apiKey, prompt, onDelta)` 封装（`Channel<String>`，Tauri 参数名映射 `on_delta`），并更新 `frontend/src/tauri.test.ts` 断言命令名与参数形状（含 `stream` 由后端负责、调用层无 `x-model`）。验证：`cd frontend && npx vitest run src/tauri.test.ts` 通过。
- [x] 4.2 改造 `InferenceView.vue::onSend` 为流式状态机：发送中沿用阶段转场；首个 delta 冻结阶段卡并切换为渐进文本（状态 200 OK、生成中标识）；Channel 消息追加 `output`；resolve 完成态 / reject 失败态且保留已到达文本 + 调试详情；重发清空。响应面板随追加自动滚动跟随。验证：手动检查 + 下一组组件测试覆盖。
- [x] 4.3 组件测试（`InferenceView.component.test.ts`）：mock Channel，断言命令名/参数、首个 delta 前阶段卡渲染、首个 delta 后阶段冻结与文本渐进追加、多 delta 按序拼接、resolve 后完成态、reject 时部分文本保留 + 失败诊断展示 + Authorization 不出现明文。验证：`cd frontend && npx vitest run src/views/InferenceView.component.test.ts` 通过。

## 5. 收尾与全量回归

- [x] 5.1 cURL 示例与文本核对：`InferenceView.vue` 的 cURL 示例加上 `"stream": true` 行，并确认不出现与新链路矛盾的“非流式”描述。验证：`cd frontend && npx vitest run src/views/InferenceView.component.test.ts` + 目测核对示例 JSON。
- [x] 5.2 全量回归与格式门禁：`cargo fmt --all -- --check`、`cargo test`（workspace）、`cd frontend && npm run build`、`cd frontend && npm test` 全部通过。
- [x] 5.3 运行 `openspec validate streaming-inference-output --strict` 通过，且按 `design.md` 的风险清单抽查关键行为（SSE 分片、断流、WAF 非 SSE 2xx）有对应测试用例。
