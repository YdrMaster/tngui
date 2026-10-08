# tngui 本地文档边界

本页说明本仓库文档的分层口径，并记录本次文档契约对齐审查的结论。跨组件语义不从 tngui 重新定义。

## 权威边界

- `tngui` 只定义本仓库的 UI、client-side `pre-tng-proxy` 回合反代、TNG 子进程集成、只读诊断、配置编辑和测试说明。
- `trust-inference` 仓库的中心 docs 是模型身份、authorization、OHTTP、RA 和可观测性语义的权威。tngui 是独立仓库，不假设中心 docs 以 particular adjacent relative path 可访问。
- 需要查看中心语义时，按 `trust-inference` 的中心文档名称追溯：architecture、component-boundary、model-identity、authz-and-credentials、tng-ohttp-key、remote-attestation、observability。
- 本仓库文档不得宣称 capi、tngui 或其他组件拥有哪个权威。本文不复制中心契约正文。

## 本地实现细节保留范围

以下内容保留在 tngui 内部文档和 OpenSpec 中：

- 桌面外壳、概览/设置/密态推理调试页交互。
- `tng launch` 生命周期、回环注入端口、单 ingress 配置、锁定 OHTTP 配置、RA 开关、设置缓存。
- tngui 本机反代、`GET /v1/models` 本地模型发现例外、模型下拉、SSE 渲染、多轮上下文、失败诊断。
- TNG 控制面只读状态、进程日志、OHTTP/RA 快照卡、证明报告导出。
- Ant Codespace 测试、双套 TNG 分发与平台限制。

## 域内不对齐修正

- `body.model` 是反代生成模型 path 的输入。tngui 不对模型 ID 做 trim、大小写转换或其他本地格式化；path 是一个 URI path segment，`provider/model` 会编码为 `provider%2Fmodel`。
- `x-model` 不作为模型身份。
- `GET /v1/models` 是 tngui 的本地模型发现例外，不是 tngui 定义的全局模型目录、注册或路由语义。
- OHTTP key 和 RA 状态卡只显示本机 TNG 控制面快照或保守日志信号，不判定 authorization、route、rotation、RA evidence age 或撤销。

## Unresolved

以下问题保留给中心契约裁决，不在 tngui 内发明补丁：

- 精确 `GET /v1/models` 本地直连例外是否允许绕过 `tng-ingress`/OHTTP/RA，以及业务认证头在该例外中的最终安全边界。
- “当前 ingress 对应 capi origin”的权威来源、安全配置和可用性判定。
- OHTTP key fingerprint、rotation、refresh failure、422 行为与 tngui 状态卡字段的完整显示映射。
- RA evidence age、refresh interval、revocation 状态与当前 `server_attestation` 快照卡的状态映射。
- 中心可观测性 metric 与 tngui 只读诊断/导出的对应关系。
