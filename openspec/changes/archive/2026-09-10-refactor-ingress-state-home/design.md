## Context

- 功能准绳是 `TNG/docs/tngui_ingress_state_change_notes.md`，视觉准绳是 `TNG/design/tngui-ingress-state-preview.html`；调查文档和状态模型只用于确认信号来源，不应全部搬进首页。
- 现有 `Overview.vue` 使用"本地网关 / XMPP 控制信道 / 本地访问"三卡、主横幅和 RA 占位；"本地访问可用"实际来自入口配置与控制面状态，不能代表业务可达。
- `get_status` 目前返回 `reachable`、`readyz` 与 `/status/` 根树，未读取 `/status/ingress/{id}/ohttp/keys`；远端链路当前用 stdout `encrypted=true` 推导。
- TNG keys 接口可直接提供 `url`、`server_public_key`、`server_attestation` 快照，但不提供 cache age、next refresh、失败计数等生命周期元数据。

## Goals / Non-Goals

**Goals:**

- 建立"运行 / 入口配置 / 远端链路 / 远端证明"四个独立状态源，避免跨状态误读。
- 扩展只读状态采集，保留原始 keys 数据以支持状态判定和调试。
- 用一个纯函数层把观测事实映射为首页互斥状态，便于单测。
- 按 HTML 设计稿实现视觉结构、文案、色点和副标题。

**Non-Goals:**

- 不改 TNG 配置编辑器、密态推理请求流程、进程启停契约或控制面安全收口规则。
- 不实现完整可观测系统、失败历史、metrics 面板、trace 面板或一站式远端健康评分。
- 不通过发起业务请求探测远端可达性。
- 不解析 JWT 内容或直接使用 JWT `exp` 作为待刷新判定依据，除非后续证据模型明确允许。

## Decisions

### 1. 扩展现有 `get_status`，不新增多个高频命令

`fetch_status` 在已有 `/livez`、`/readyz`、`/status/` 之外，读取 `/status/ingress/{id}/ohttp/keys` 并返回统一 `StatusReport`。这样保持现有 1.5–2 秒轮询节奏，前端仍调用一个 Tauri 命令。

- Discovery: `GET /status/` 可能返回 `["egress","ingress"]`；当含 `ingress` 时继续 `GET /status/ingress/` 得到 id 列表。实现时优先取第一个 ingress id，也可把首个 keys 响应作为首页摘要。
- 失败容忍：任一后续接口 404、非 JSON、超时或为空都保留探针结果，并把远端观测标注为不可用，而不是让整个状态查询失败。
- Alternative: 多个 Tauri 命令按需查询。该方式会让远端状态更新频率和原始面板更新时间不一致，暂不采用。

### 2. 后端保留原始快照，前端做语义归约

`StatusReport` 增加：

- `ingress_keys_error: Option<String>`
- `ingress_keys: Value`
- `ingress_ids: Value` 或简化后的 ingress id 快照
- `process_error: Option<String>`（可选，由外壳根据进程状态或捕获日志标注）

前端 `deriveIngressStates()` 只接受这些只读观测，不直接从普通 `info`/`success`/`debug` 日志匹配文案。首轮映射规则：

- 远端链路：`server_public_key` 存在 → 已建联；无 keys 数据 → 未初始化；`ingress_keys_error` 或明确失败日志信号 → 失败。
- 远端证明：`server_attestation` 存在 → 已验证；无 keys 数据 → 未获取；明确校验/刷新/取证失败信号 → 失败；暂不引入"待刷新"，除非后续有可信接近过期信号。
- 运行：进程异常或明确服务失败 → 错误；`readyz` 成功 → 运行；不可达/未运行 → 关停。

"待刷新"必须保留为显式枚举和 UI 状态，不能因为暂无信号而删除。

### 3. 失败信号只做保守识别

日志匹配仅限当前 TNG 已知的结构性错误事件，例如 cached value 更新失败、key config / RA verification 失败、进程异常退出。不得把普通 info/debug 内容、入口 access log 中 `attested=false`，或"未校验"字样当作失败。

- Alternative: 采集全部 WARN/ERROR。此策略容易把无关错误渲染为远端链路失败，首轮不采用。
- Alternative: 主动发起推理/隧道请求验证。违反首页只读观测目标，不采用。

### 4. UI 直接按设计稿重建四卡

- 桌面宽度用四列，窄容器退化为两列；卡片顺序固定。
- 使用共享状态卡组件渲染 `state: ok | warn | err | neutral`、标题、文案和副标题；色点用设计稿颜色：`#52c41a`、`#faad14`、`#ff4d4f`、`#8c8c8c`。
- 入口信息卡从共享配置模型的第一个 ingress 提取：
  - mapping：第一条 rule 的 `in.host`（缺省 `127.0.0.1`）和 `in.port`；
  - http_proxy / socks5：`proxy_listen.host` 和 `proxy_listen.port`；
  - netfilter / hook：按各自 listen/capture 字段确定可用摘要，无法确定时显示 `——`。
- 入口模式使用用户可读中文标签（映射 / 代理 / 钩子等），不展示 JSON 字段名。
- 保留原始状态数据与进程日志底部面板；移除主横幅、入口复制按钮和不必要的引导 Alert。

### 5. 全局侧栏摘要同步收敛

`App.vue` 的侧栏运行摘要复用同一运行状态判定，不再显示 XMPP"已连接/已断开"。文案只表示本地进程/控制面状态。

## Risks / Trade-offs

- [keys 接口失败或格式变化导致远端状态不可知] → 保守显示未初始化/未获取，并把错误留在原始状态数据面板，不编造"失败"。
- [日志关键词匹配可能过宽或过窄] → 只匹配结构性事件，配套单测固定信号；新增匹配必须评审。
- [暂无可信接近过期信号，"待刷新"不可达] → 保留枚举、组件分支和测试场景，后续信号可用时只补映射。
- [多 ingress 配置下单卡会掩盖其他入口差异] → 首页按设计稿只做一张摘要卡；原始 keys 数据保留所有响应，不在首页新增逐 ingress 卡。
- [`/status/ingress/` 较新版本的响应格式变化] → 采集层做类型守卫并测试空态、数组、对象和非法 JSON。

## Migration Plan

1. 扩展 status 采集与类型。
2. 增加纯状态映射与测试。
3. 重建 Overview 四卡与调试面板。
4. 更新 App.vue 侧栏摘要。
5. 运行前端 build/test 和 Rust 测试；如视觉偏差，逐项对照 HTML 设计稿修正。
6. 回滚：还原 Overview、状态映射、`StatusReport` 字段和相关测试即可；新增字段向后兼容旧 UI。
