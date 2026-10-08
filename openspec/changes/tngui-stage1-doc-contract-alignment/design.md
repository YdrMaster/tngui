# Design

## Context

`tngui` 的文档和 OpenSpec 当前混有三类内容：本地 GUI 行为、TNG 本机集成行为、以及少量跨组件语义。中心仓库的架构与契约已经把 capi、模型身份、OHTTP、RA 和可观测性定为权威；本设计只把 tngui 内部表述收敛到“client-side 图形实现”，不改变运行行为。

关键现状见 `README.md`、`docs/tngui-ui-guide.md`、`openspec/specs/gui-shell/spec.md` 和 `openspec/specs/ingress-state-home/spec.md`。中心约束来自 `trust-inference` 仓库的 architecture、components/tngui 与 contracts 文档；在当前 checkout 中可在 `trust-inference/docs/` 逻辑路径下核对，但不要求这些文件在 `tngui` 的安装、克隆或运行环境中位于 adjacent `../docs`。

## Goals / Non-Goals

**Goals:**

- 把 README 和 `docs/**` 改成以 tngui UI、诊断、client-side 反代、TNG 进程管理、配置和本地测试为主的实现说明。
- 对确需引用中心语义的位置，使用稳定的中心文档名称描述权威来源，不复制契约正文，也不写入以 `..` 为前提的长期链接。跨组件语义本身不在 tngui 重新定义。
- 修正域内明显错误：`body.model` 不被本地 trim/改写，`provider/model` 的模型段保留单一 path segment，`x-model` 不作为模型身份。
- 把 OHTTP key 和 RA 状态卡语义限定为本地快照观测；不描述认证、path 路由、rotation 裁决、凭据续期或远端健康裁决能力。
- 更新本地 OpenSpec 中已识别的过时要求引用，使 `gui-shell` 与 `ingress-state-home` 保留可验证场景但不再携带旧命名。

**Non-Goals:**

- 不实现反代、模型发现、授权、认证、OHTTP、RA 或 GUI 源码变更。
- 不修改 `trust-inference/docs/`、其他子模块、TNG 行为或 `trust-inference` 路线图。
- 不在 tngui 定义新的跨组件契约。
- 不新增历史版本页或迁移说明；文档重写发生在原有 README/docs 位置。
- 不因文档结构变化而删除测试、平台限制、分发、配置、诊断或 UI 交互说明。

## Decisions

### 1. 文档分层：本地行为优先，中心语义只引用

README 和 `docs/**` 中保留的内容必须是 tngui 自己可观察的行为。凡涉及“谁是授权/注册/route 权威”“path identity 如何由 capi/epp 验证”“OHTTP key 如何 rotation”“RA trust/RVS 角色如何裁决”，改为引用中心文档的稳定名称或“中心契约”总称；OpenSpec 只保留本地行为边界，不在规格正文里复制中心契约。

若审阅者需要定位源文件，使用 `trust-inference/docs/` 这个逻辑位置；本 checkout 中的实际位置当前是 `../docs`，这只是 worktree placement，不是文档 API。OpenSpec 工件不应把它规定为运行态/克隆态依赖。备选方案是在 tngui 再维护一份契约摘要；不采用，因为会形成第二套权威口径。

### 2. 模型身份收敛为本地路径生成语义

反代的 OpenSpec 保留本机行为：对支持的 OpenAI/Anthropic 请求解析 `body.model`，精确保留字符串并做单一路径 segment percent-encoding，不改写 body。`GET /v1/models` 作为本地模型发现例外继续描述直连目标的行为，但不称其定义全局模型注册、路由或授权。模型下拉清单只描述 UI 会话内状态。

该决定与中心《模型身份契约》对齐：不新增 alias、协议头、错误响应或路由规则。

### 3. 诊断卡描述为观测，不升级为能力边界

`ingress-state-home` 中的远端链路和远端证明状态卡继续使用现有 UI 标签和状态来源，但明确它们只反映本机 TNG 控制面返回的快照与保守日志信号。是否 key 可轮换、跨实例一致、RA 凭据当前有效或撤销成功，不由 tngui 判断。

备选方案是把状态卡改名为 `authz`、`route` 或“远端健康”；不采用，因为会超出当前字段来源且与中心可观测性契约的失败域混淆。

### 4. 未解决的跨组件事项保持 unresolved

直接模型发现是否允许绕过 OHTTP/RA、`capi origin` 的最终安全来源、OHTTP key/RA 字段映射，继续在变更文档中列为 unresolved。实现和文档不得通过新描述反向裁决这些问题。

## Risks / Trade-offs

- [模型 ID 老示例或测试 fixture 解释行为] → tasks 要求全量搜索 `model-a`、`provider/model`、`body.model`、`path_rewrites` 和 `x-model` 示例，确保示例和规格场景一致。
- [移除跨组件摘要后读者缺少上下文] → 在 README/docs 中提供本地边界页和中心文档名称，而不是复制摘要。
- [OpenSpec 状态语义仍以显示名为“已验证”] → 在同一 requirement 中把标签限定为“快照观测”，并保持禁止一站式健康表达。
- [文档改写丢失可测试 GUI 行为] → 采用逐节核对清单，保留 UI 标签、状态来源、SSE、停止/失败、缓存、端口、TNG 二进制和测试平台约束。

## Open Questions

- 非推理 `GET /v1/models` 直连例外是否与中心架构和安全边界兼容，需要中心裁决；当前只保留本地讲法和 `unresolved` 标记。
- `capi origin` 的权威来源、安全配置和可用性判定仍需中心明确；tngui 不自行定义跨组件字段。
- OHTTP key fingerprint/rotation/422 行为与 tngui 快照 UI 的映射需要中心与 TNG 状态观测共同明确。
- RA evidence age、refresh、revocation 状态与当前快照卡状态的映射需要中心明确。
- 中心可观测性 metric 和 tngui 诊断/导出物之间的关系延后到中心实现契约明确后再展开。
