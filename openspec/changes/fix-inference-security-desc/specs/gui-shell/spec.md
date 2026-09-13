## ADDED Requirements

### Requirement: 密态推理视图准确描述加密链路

密态推理视图对加密链路与"建立加密通道"步骤的描述 SHALL 与真实链路一致：Seg1（客户端→网关）为 OHTTP（RFC 9458）/ HPKE 消息级加密、单向远程证明（客户端验证网关）；Seg2（网关→引擎）为 RA-TLS（TLS 1.3 + 远程证明）、双向互证。系统 MUST NOT 把 Seg1 标为 RATS-TLS 或 RA-TLS，也不得在"建立加密通道"步骤说明中称"RATS-TLS 会话绑定"。可信环境与 CPU-GPU 链路保护 SHALL 以原理表述、不绑定具体技术名：可信环境以"可信执行环境 + 远程证明"表述，不写具体 TEE/硬件/证明后端技术名、不以"硬件可信环境"作为字段名；CPU-GPU 链路以"PCIe 链路加密"原理表述，不写具体协议名（不写 TDX-IO、PCIe IDE）。

#### Scenario: Seg1 标为 OHTTP/HPKE 消息级加密

- **WHEN** 渲染安全说明页的两段加密链路描述（架构流图、加密边界、链路总览与可信证据的加密协议字段）
- **THEN** Seg1 标为 OHTTP/HPKE 消息级加密、单向远程证明（客户端验证网关），不出现"RATS-TLS 段 1"或把 Seg1 称为 RATS-TLS/RA-TLS

#### Scenario: Seg2 保持 RA-TLS 双向互证

- **WHEN** 渲染 Seg2（网关→引擎）的链路描述
- **THEN** 标为 RA-TLS（TLS 1.3 + 远程证明）、双向互证

#### Scenario: 可信环境以原理表述且不绑定具体技术

- **WHEN** 渲染安全说明页的可信环境/信任根描述
- **THEN** 以"可信执行环境 + 远程证明"原理表述，不出现具体 TEE/硬件/证明后端技术名（不写 Intel TDX 等），且不以"硬件可信环境"作为字段名

#### Scenario: CPU-GPU 链路以原理表述去品牌名

- **WHEN** 渲染 CPU-GPU 链路保护描述
- **THEN** 以"PCIe 链路加密"原理表述并保留"链路上加密"语义，不出现具体协议/技术名（不写 TDX-IO、PCIe IDE）

#### Scenario: 建立加密通道步骤不误称 RATS-TLS

- **WHEN** 渲染密态推理发送流程"建立加密通道"步骤的说明文案（步骤数据与发送进度动画）
- **THEN** 文案表述为以 OHTTP 加密并绑定网关证明后再发送，不出现"RATS-TLS 会话绑定"
