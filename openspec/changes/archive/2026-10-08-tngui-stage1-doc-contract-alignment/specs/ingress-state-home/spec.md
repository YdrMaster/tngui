# Spec Delta

## MODIFIED Requirements

### Requirement: 远端链路状态模型

系统须（SHALL）把远端链路收敛为互斥的未初始化 / 已建联 / 失败三态：尚无成功的远端密钥配置时显示灰色"未初始化"；状态接口返回可观测的 OHTTP key 配置时显示绿色"已建联"；状态接口或日志报告密钥配置或隧道失败时显示红色"失败"。系统不得把就绪探针或本地入口信息用作远端链路证据。

#### Scenario: 尚无远端密钥

- **WHEN** ingress OHTTP keys 状态没有可用的远端公钥
- **THEN** 远端链路卡显示灰色"未初始化"

#### Scenario: 已有远端公钥

- **WHEN** ingress OHTTP keys 状态包含远端公钥
- **THEN** 远端链路卡显示绿色"已建联"

#### Scenario: 远端链路失败

- **WHEN** 只读状态或进程日志报告密钥配置或隧道失败
- **THEN** 远端链路卡显示红色"失败"


“已建联”只表示本地观察到可用于 OHTTP 封装的 key 配置快照；该状态不授予或证明模型 authorization、route、key rotation 或跨实例 private-key 一致性。

### Requirement: 远端证明状态模型

系统须（SHALL）把远端证明收敛为互斥的未获取 / 已验证 / 待刷新 / 失败四态：无缓存校验凭据时显示灰色"未获取"；状态接口返回缓存的校验凭据快照时显示绿色"已验证"；凭据接近过期时显示橙色"待刷新"；日志报告校验、刷新或取证失败时显示红色"失败"。系统不得把就绪探针、本地可达性或 OHTTP access log 中固定为 false 的 `attested` 字段当作远端证明状态。

#### Scenario: 无缓存凭据

- **WHEN** ingress OHTTP keys 状态没有缓存的校验凭据
- **THEN** 远端证明卡显示灰色"未获取"

#### Scenario: 凭据已验证

- **WHEN** ingress OHTTP keys 状态包含已验证并缓存的校验凭据
- **THEN** 远端证明卡显示绿色"已验证"

#### Scenario: 凭据待刷新

- **WHEN** 可用证据显示校验凭据接近过期
- **THEN** 远端证明卡显示橙色"待刷新"

#### Scenario: 凭据失败

- **WHEN** 进程日志或状态接口报告校验、刷新或取证失败
- **THEN** 远端证明卡显示红色"失败"


“已验证”只表示本地观察到一次验证后的校验凭据快照或非空 `server_attestation`；该状态不声称凭据当前仍然有效、未被撤销、刷新成功，也不表示远端证明或整条密态推理链路已通过中心 RA 生命周期裁决。

