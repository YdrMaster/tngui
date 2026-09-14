## 1. 架构流图 Seg1 正名

- [x] 1.1 在 `frontend/src/components/ArchitectureFlow.vue` 把段1 `<b>RATS-TLS 段 1</b>` 改为 `<b>OHTTP 段 1</b>`，段1副标题改为 `单向证明：客户端验证 Gateway TEE · OHTTP/HPKE 消息级加密`；段2 `RATS-TLS 段 2 / 双向证明` 不动。验证：构建后安全说明页架构流图段1显示"OHTTP 段 1"，段2保持"RATS-TLS 段 2"。

## 2. InferenceView 安全说明 tab 文案

- [x] 2.1 `frontend/src/views/InferenceView.vue` 安全说明 Hero 的 subTitle 由 `两段加密链路均通过 RATS-TLS 验证` 改为 `两段加密：Seg1 OHTTP + Seg2 RA-TLS，均经远程证明`。验证：Hero 副标题不再称两段均为 RATS-TLS。
- [x] 2.2 加密边界表中"客户端 TNG → Gateway TNG"行的说明由 `RATS-TLS 段 1 · 单向证明` 改为 `OHTTP/HPKE 段 1 · 单向证明`；"Gateway TNG → vLLM TNG"行（段2）不动。验证：边界表段1显示 OHTTP/HPKE、段2保持 RATS-TLS。
- [x] 2.3 可信证据字段：`硬件可信环境` 字段标签改为 `可信执行环境`，值 `<a-tag>Intel TDX</a-tag>` 改为 `<a-tag>远程证明（RA）</a-tag>`；`加密协议` 值由 `RATS-TLS / TLS 1.3` 改为 `Seg1 OHTTP/HPKE + Seg2 RA-TLS(TLS 1.3)`。验证：不再出现 Intel TDX 与"硬件可信环境"；加密协议含 Seg1 OHTTP。
- [x] 2.4 推理保护卡 `CPU-GPU 加密链路` 的 tag 由 `PCIe IDE / TDX-IO` 改为 `PCIe 链路加密`，description（"模型权重、KV cache 和中间激活值在 PCIe 总线上保持加密。"）保持不变。验证：tag 不再含 TDX-IO / PCIe IDE。

## 3. 建立加密通道步骤文案

- [x] 3.1 `frontend/src/data/secureSteps.ts` 中 key 为 `encrypt` 的 step description 由 `验证结果与 RATS-TLS 会话绑定后再发送请求。` 改为 `OHTTP 加密并绑定网关证明后再发送请求。`。验证：`grep -R "RATS-TLS" frontend/src/data/secureSteps.ts` 无命中。
- [x] 3.2 `frontend/src/views/InferenceView.vue` 发送进度动画 phase 2 文案由 `验证结果与 RATS-TLS 会话绑定后再发送。` 改为 `OHTTP 加密并绑定网关证明后再发送。`。验证：发送动画第3步显示 OHTTP 文案、不含 RATS-TLS。

## 4. 构建与回归核对

- [x] 4.1 在 `frontend/` 执行项目既定构建命令（如 `npm run build`），确认无类型/模板编译错误。验证：构建成功退出。
- [x] 4.2 静态核对密态推理"安全说明"tab 与"请求调试"发送动画，对照 `specs/gui-shell/spec.md` 的 5 个 Scenario：Seg1=OHTTP/HPKE 单向、Seg2=RA-TLS 双向、可信环境无 Intel TDX 且无"硬件可信环境"、CPU-GPU tag 为"PCIe 链路加密"、建立加密通道步骤无"RATS-TLS 会话绑定"；"与普通 TLS 对比"表及其它未列文案保持不变。验证：5 个 Scenario 全部满足（源码 grep 核验通过；建议用户在运行态做最终可视确认）。
