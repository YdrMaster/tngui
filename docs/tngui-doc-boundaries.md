# tngui 本地文档边界

本页说明 tngui 仓库自身文档的分层口径。tngui 文档自包含：本仓库文档和 OpenSpec 以 tngui 自身可观察行为与本地边界为准，不引用、不依赖其他仓库的文档作为语义来源。

## 权威边界

- `tngui` 定义本仓库的 UI、client-side pre-TNG 反向代理、TNG 子进程集成、只读诊断、配置编辑和测试说明。
- tngui 不定义服务端授权、全局模型注册、远端路由、OHTTP/HPKE 协议、可信执行或远端证明生命周期——这些是外部 TNG 系统行为，tngui 只写本地配置并把观测结果展示给用户。
- 本仓库文档不复制或改写 TNG 端协议正文；涉及外部系统语义时，只描述 tngui 与其交接的本地配置输入和观测输出。

## 本地实现细节保留范围

以下内容保留在 tngui 内部文档和 OpenSpec 中：

- 桌面外壳（概览 / 密态推理 / 设置 三视图）交互、模型下拉、SSE 渲染、多轮上下文、失败诊断。
- `tng launch` 生命周期、回环注入端口、唯一 ingress 配置、锁定 OHTTP 形态、RA 开关、设置缓存。
- tngui 本机反向代理：对 `POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/responses` 做 model path 注入、按本地配置向请求体顶层注入 `cache_salt`，其余 body 与请求头透传；反代不决定远端授权或路由。
- 精确 `GET /v1/models` 本地模型发现例外：按当前 ingress 结构派生 capi origin、不走 tng ingress、失败不伪装为空清单；tngui 自身发起的模型清单请求不携带业务凭证头。
- 反代会话内的只读诊断快照：固定类别计数与本机 UI 状态；不持久化、不上报。
- TNG 控制面只读状态、进程日志、OHTTP/RA 快照卡、证明报告导出。
- Ant Codespace 测试、双套 TNG 分发与平台限制。

## 本地边界要点

- 反代模型 path 注入：`body.model` 是唯一模型身份输入；tngui 不 trim、不转换大小写、不删空格；`provider/model` 编码为 `provider%2Fmodel`；`x-model` 不作为模型身份。
- 反代支持的三个模型推理端点是 `POST /v1/chat/completions`、`POST /v1/messages` 和 `POST /v1/responses`。`/v1/responses` 在 tngui 当前边界中是无状态、自包含请求形态：不引入本地会话或后台任务；多轮上下文由调用方完整携带。
- 精确 `GET /v1/models` 直连是本地模型发现例外而非授权链路：capi origin 从当前 ingress 远端目标结构派生，映射形态派生 HTTP origin、域名代理形态按 `ohttp.tls` 与 `dst_filters[0].domain[:port]` 派生 HTTP/HTTPS origin。直连分支的本地请求头规则是确定的：本地剔除 hop-by-hop 头、`host`、`content-length` 与 `x-model`；若请求中已有 `Authorization` 或 `x-api-key`，按原样透传到 capi origin。tngui 不新增业务凭证，不校验业务凭证语义，也不剥离业务凭证；透传凭证头不表示 tngui 参与授权，剥离或校验授权凭证由服务端授权边界处理。发现失败返回明确失败响应而非空清单。
- OHTTP key 和 RA 状态卡只描述本机 TNG 控制面快照或保守日志信号，不代表远端网关可用性、远端模型健康、远端授权、TNG key rotation 或跨实例 key 一致性，也不判定 RA evidence age、revocation 或凭据当前是否仍有效。
- 缓存盐：`cache_salt` 由调用侧（tngui 本机）持有并写入请求体顶层，只在本机反代转发前注入。盐模式（关闭/固定/自动）与覆盖开关是本地设置，随设置缓存持久化，但不进 tng 配置。盐不写入请求头、日志、错误详情或诊断快照；自动模式的当前随机盐只存在于进程内存。盐不构成准入条件，无盐请求照常转发。
- 反代诊断快照是本机进程内存内的固定类别计数，不携带模型名、prompt、business payload 或 attestation token；身份通过/身份拒绝计数的语义是请求体中是否解析出可用模型身份，与认证、授权、凭证有效性或远端可访问性无关；计数是本地物理观察，不构成模型授权结果、远端模型健康、TNG key rotation 或跨实例 key 一致性判断。
