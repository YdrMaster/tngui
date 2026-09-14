## Why

密态推理视图的"安全说明"页对加密链路的描述与 cmaas-deploy 真实链路不一致：它把两段链路都标成 RATS-TLS，并称"两段加密链路均通过 RATS-TLS 验证"。但真实链路里，Seg1（客户端→网关）是 OHTTP（RFC 9458）/ HPKE 消息级加密，只有 Seg2（网关→引擎）才是 RA-TLS（TLS 1.3 + 远程证明）。同时该页把可信环境绑定到具体技术名（Intel TDX）与具体链路协议（PCIe IDE / TDX-IO），既不准确也会随部署形态变化而过时。需把文案对齐真实链路，并把信任根与链路保护改为原理表述、不绑定特定技术。

## What Changes

- 把 Seg1 的协议标签从"RATS-TLS 段 1"改为"OHTTP 段 1 / OHTTP/HPKE 消息级加密"（架构流图、加密边界表、Hero 副标题、可信证据"加密协议"字段均同步）；Seg2"RATS-TLS 段 2 · 双向证明"保持不变。
- 把安全说明中"硬件可信环境: Intel TDX"等具体技术名改为原理表述"可信执行环境 + 远程证明"，不写"硬件"、不绑定具体 TEE/证明后端技术名。
- 把"CPU-GPU 加密链路"标签里的具体协议名"PCIe IDE / TDX-IO"去掉，保留"PCIe 链路加密"的原理语义（确有 PCIe 链路加密，仅去品牌名）。
- 把 secureSteps 第3步与密态推理发送动画里"RATS-TLS 会话绑定"的误称，改为"OHTTP 加密并绑定网关证明"。

## Capabilities

### New Capabilities
<!-- 无新增能力 -->

### Modified Capabilities
- `gui-shell`: 新增一条要求——密态推理"安全说明"页须按真实两段链路准确描述协议（Seg1=OHTTP/HPKE 消息级 + 单向 RA；Seg2=RA-TLS、TLS 1.3 + 远程证明、双向 RA），不得把 Seg1 标为 RATS-TLS；可信环境与链路保护以原理表述、不绑定具体技术名。

## Impact

- `frontend/src/components/ArchitectureFlow.vue`：段1标签与副标题文案。
- `frontend/src/views/InferenceView.vue`：安全说明 tab 的 Hero 副标题、加密边界表、可信证据字段（硬件可信环境→可信执行环境、加密协议）、CPU-GPU 链路标签；请求调试 tab 发送动画 phase 2 文案。
- `frontend/src/data/secureSteps.ts`：第3步 description 文案。
- 不涉及后端、不涉及 tng 配置契约、不影响推理发送逻辑；纯展示文案与标签修正。
