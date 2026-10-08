# Proposal

## Why

本变更是 `tngui` 本地文档与本地 OpenSpec 的清理阶段，不是组件实现阶段。`trust-inference` 仓库中的中心 docs 是模型身份、OHTTP、RA、可观测性和授权边界的权威；当前 checkout 中它不是 `tngui` 可长期假设的 adjacent 路径，而 `tngui` 目前仍有少量跨组件契约表述、旧命名和可能过强的能力描述，容易让维护者把 client-side GUI 行为误读为服务端授权、全局模型注册或路由权威。

## What Changes

- 将 `README.md` 与 `docs/**` 收敛为 `tngui` 本地实现与 GUI 使用说明：保留 UI、`tngui` 反代、诊断面板、TNG 进程管理、本地测试和交互行为描述。
- 不把中心方案仓库路径写成长期文档依赖；README/docs 中的语义引用使用中心文档的稳定名称，在当前 checkout 语境下按 `trust-inference/docs/` 定位；本 checkout 中该目录当前位于 `../docs`，但该相对位置不是契约名称的一部分。
- 对模型选择、模型 list、请求体生成与模型 path 生成，明确它们是 `tngui`/client-side `pre-tng-proxy` 的本机实现行为，并通过 `trust-inference` 中心文档名称指明权威来源；不复制中心契约正文，也不绑定 adjacent 路径。
- 修正或移除跨组件重复表述，例如把 “capi path 模型鉴权契约” 这类中心侧语义收敛为引用和触发条件说明。
- 清理 OpenSpec 中旧命名的 `x-model`、过时组件链路引用、以及可能把 OHTTP key 或 RA 状态误写成认证、路由或远端健康能力的文字。
- 仅修改 `README.md`、`docs/**`、`openspec/specs/**`；不修改组件源码、`trust-inference` 仓库或其他子模块。
- 不新增历史版本页、迁移说明、migration/spec 版本叙述，也不引入新的跨组件契约裁决。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `gui-shell`: 只调整与模型身份、`/v1/models` 本地模型发现描述、`x-model` 旧命名和过时跨组件引用相关的 requirement 表述；保留推理页交互、SSE、进程内状态、TNG 配置、RA 开关和本地反代实现行为。
- `ingress-state-home`: 明确远端链路与远端证明状态卡是本地只读诊断展示，不声明 route、authorization、OHTTP key rotation 或 RA 生命周期裁决能力；保留四卡布局、状态判定来源、导出和禁止一站式健康表达的 UI 行为。

## 审查结论与保留项

### 主要冲突/模糊点

1. 模型身份一致性：`gui-shell` 中反代对 `body.model` 做本地 trim 后生成 path，但中心和本地 UI 说明都要求服务端返回的模型 ID 原样作为请求身份；trim 后的 outer path body 匹配语义需要按中心《模型身份契约》收敛，尤其是 `provider/model` 的单一 path segment percent-encoding。
2. 模型发现链路：README 与 `gui-shell` 描述 `GET /v1/models` 直连 “capi origin”，且不经 OHTTP/RA。该行为是本地测试/接入能力，但当前措辞可能造成 tngui 决定全局模型发现路由的误解。
3. 旧命名和引用：`gui-shell` 仍存在引用“注入 `x-model` 头”的要求标题或旁引；中心契约明确 `x-model` 不属于模型身份。
4. 跨组件权限表述：本地文字中 “capi path 模型鉴权契约” 重复了中心契约术语，容易被读成 `tngui` 定义授权或拥有全局注册/路由语义。
5. OHTTP/RA 诊断能力边界：状态卡依据本地快照显示 `server_public_key` / `server_attestation` 的存在性，不能被描述为 OHTTP key 的路由裁决、rotation 生命周期管理、RA 认证能力或整链远端健康判定。
6. 安全链路文案旧口径：`docs/tngui-ui-guide.md` 中早期 “RATS-TLS 段 1” 的说明与本地 OpenSpec 已有的 OHTTP/HPKE 修正冲突，需要移除旧口径。

### 需要保留的 tngui 本地细节

- 桌面外壳、四卡/三卡状态呈现、原始状态数据、进程日志和证明报告导出。
- `tng launch` 生命周期、回环管控端口、单 ingress 结构化编辑、配置锁定、缓存和双套 TNG 分发行为。
- 密态推理调试页的会话内聊天状态、模型下拉清单、SSE 输出、停止/失败诊断、API Key 呈现和不可跨会话持久化的模型状态。
- 反代与 TNG 的松耦合实现边界、注入端口、OHTTP 配置锁定、RA 开关、RVS 地址注入和本地 UI 文案。
- Ant Codespace 测试环境、前端/Rust 测试命令和已知平台限制。

### Unresolved：需要中心裁决

以下事项不自行发明新契约，先在 tngui 内部标注为中心语义引用或 `unresolved`：

- 非推理精确 `GET /v1/models` 例外路径是否允许绕过 `tng-ingress`/OHTTP/RA，以及该例外携带业务认证头的最终安全边界；权威文件是 `trust-inference` 仓库中的 center model-identity、authz-and-credentials 与 architecture 文档；tngui 内不下发这些文件，也不假设可通过固定 adjacent 路径访问它们。
- “当前 ingress 对应 capi origin” 的最终字段来源、放置位置和可用性判定。
- OHTTP key 的 fingerprint、rotation、refresh failure、422 行为与 tngui 状态卡字段的完整显示映射；当前不新增认证或路由能力。
- RA evidence age、refresh interval、revocation 状态与当前 `server_attestation` 快照的状态映射；当前只描述快照观测，不宣称凭据仍然有效。
- 中心可观测性 metric 与 tngui 只读诊断/导出的对应关系；当前不实现 metric collector。

## Impact

- 影响范围限定为 `tngui` 的 README、本地 docs 和 OpenSpec requirement 文案；无源码变更、无 API/schema 变更、无依赖更新。
- 本文产生的行为主要是文档与本地 OpenSpec 语义澄清；后续实现阶段不在本变更内执行。
