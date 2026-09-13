## Context

见 `proposal.md - Why`。真实链路依据 cmaas-deploy `publish/docs/01-介绍.md` §6/§7 与 `docs/ra-config.md`（基于 TNG 源码与实测部署）：Seg1（客户端→网关）= OHTTP（RFC 9458）/ HPKE 消息级加密、单向 RA（客户端 verify 网关 attest）；Seg2（网关→引擎）= RA-TLS（TLS 1.3 + 远程证明）、双向互证。tngui 客户端配置即 `add_ingress` + `ohttp` + `verify`，走 OHTTP 形态。当前"安全说明"页把 Seg1 误标为 RATS-TLS，并把可信环境绑定到 Intel TDX、把 CPU-GPU 链路绑定到 PCIe IDE / TDX-IO。

## Goals / Non-Goals

**Goals:**
- 把密态推理视图对加密链路的展示文案对齐真实两段链路（Seg1=OHTTP/HPKE，Seg2=RA-TLS）。
- 把可信环境与 CPU-GPU 链路保护改为原理表述、去除具体技术名绑定。

**Non-Goals:**
- 不改推理发送逻辑、不改 tng 配置契约、不接后端。
- 不把占位的可信证据（证明 ID/时间/策略）改为真实数据。
- 不新增 ZMQ/KV-Event 旁路隧道图。
- 不改"与普通 TLS 对比"表与概览页 RA 状态卡。

## Decisions

- **D1 — Seg1 统一称 OHTTP/HPKE（消息级），不称 RATS-TLS。** 真实 REE 默认形态 seg1=OHTTP，tngui 客户端 `add_ingress` 即 OHTTP+verify。备选：同时说明"TEE 形态可用 RATS-TLS 直连"——否决，当前部署为 OHTTP，混述会再制造歧义。
- **D2 — Seg2 保持"双向证明"。** `ra-config.md` 实测配置与 `publish/01-介绍.md` §7 均为双向（README/architecture 写单向属文档内部不一致，以实际部署为准）。
- **D3 — 可信环境去技术绑定：** 表述为"可信执行环境 + 远程证明"，不写"硬件"、不写 Intel TDX/kata/HyperEnclave/TPM/AA/RVS 等具体名。理由：避免绑定会随部署形态变化的特定技术（用户要求）。
- **D4 — CPU-GPU 链路保留"PCIe 链路加密"原理、去掉"PCIe IDE / TDX-IO"具体名。** 用户确认确有 PCIe 链路加密，仅去品牌名，语义不动。
- **D5 — secureSteps 第3步与发送动画 phase 2 同步改为"OHTTP 加密并绑定网关证明后再发送"。** 客户端→网关走 OHTTP（RA 绑定在 OHTTP key-config），非 RATS-TLS 会话。

精确 before→after 字符串映射见 `tasks.md`。

## Risks / Trade-offs

- [占位可信证据（证明 ID/时间/策略）仍为静态 mock] → 本次不动（用户未要求）；后续可改为从控制面取真实值或不展示。
- [发送动画 phase 1"校验硬件证明"含"硬件"] → 保留：指远程证明的硬件证据，属通用概念、非特定技术名；如需一并去除再议。
- ["与普通 TLS 对比"表仍以 RATS-TLS 统称 Seg1] → 按用户第 2 条不动，存在轻度概念简化，可接受。
- [cmaas-deploy 文档对 seg2 方向（单向/双向）自身不一致] → 以实际部署配置 `ra-config.md`（双向）为准。

## Migration Plan

纯前端展示文案修正，无数据/接口迁移；改完执行前端构建验证渲染即可。回滚 = `git revert` 本次提交。

## Open Questions

无（关键点用户均已定夺）。
