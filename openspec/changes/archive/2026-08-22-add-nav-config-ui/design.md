## 背景

当前状态（MVP 已归档）：`frontend/index.html` 是单文件 vanilla HTML/JS，单页堆了配置 textarea + 启动/重启按钮 + 三态灯 + `/status/` + 输出区；后端三命令 `launch_tng(config_json)` / `get_status` / `get_output` 与 `tngui-core`（`prepare_config` 强制 127.0.0.1 + 要求 port、`control_port`、`write_runtime_config`、`TngSupervisor`、`fetch_status`、`BoundedLog`）。松耦合三契约不变。

TNG 配置字段模型已从源码摸清（驱动 form-spec 设计的关键事实）：
- **ingress/egress 模式是外挂 tag**：每条 entry 用单键（`mapping`/`http_proxy`/`socks5`/`netfilter`/`hook`；egress 无 `http_proxy`/`socks5`）包住对象，不是内部 `tag="mode"`。`mapping_udp` 受 feature 门控 → UI 隐藏。
- **RA 平铺且带注入默认**：`no_ra`（默认 false）+ 可选 `attest`/`verify`；`model`/`aa_provider`/`as_provider`/`aa_type`/`as_type` 缺省时由 tng 注入默认值。
- **严格性不均**：部分结构（RA 提供者子结构、mapping `RuleEndpoint`、http_proxy/socks5/netfilter 模式结构、`MetricExporterType`、`KeyArgs`）**无** `deny_unknown_fields`（拼错被静默忽略）；顶层/`Endpoint`/控制面/可观测性 common 等有。→ 表单做基础必填校验，完整严格校验仍交给 tng，拒启经 `get_output` 显示。
- `Endpoint{host:Option,port:u16}`、mapping `RuleEndpoint{host:Option<Ipv4Addr>,port,port_end?}`（`in.host` 可省、`out.host` 必填）。
- ohttp：ingress 侧（路径重写/TLS 外层）与 egress 侧（`key.source` = self_generated{rotation_interval 默认 300}/file{path}/peer_shared{...}、cors、header_passthrough）是两套不同结构。

动机见 `proposal.md`。

## 目标 / 非目标

**目标：**
- UI 演进为"导航 + 首页（纯监视）+ 配置页（结构化 + 启停 + 导入导出）"。
- 结构化控件覆盖常用路径（control port、ingress/egress 模式与字段、`no_ra`），原始 JSON 视图兜底其余（含 RA attest/verify）。
- 复用全部既有后端契约与核心逻辑，零 TNG 链接。

**非目标：**
- 不持久化、不做多 profile（每次默认模板开局）。
- 不结构化 RA 的 attest/verify 全字段（仅 `no_ra` 开关）。
- 不做 `tng.log` tail（首页日志仍是 `get_output` 即 stdout/stderr）。
- 不做系统代理、metrics 面板、特权/透明代理模式向导。

## 决策

### 1. 前端栈：Vue 3 + Vite + Ant Design Vue（D2）
结构化配置表单（模式选择器、列表增删、条件字段、双向同步）是框架主场。Vue 3 SFC + Ant Design Vue（`a-form`/`a-select`/`a-list`/`a-input-number`/`a-switch` 等）能让表单与校验清爽。代价是引入 pnpm + Vite 构建链与 node 工具——MVP 的"单文件无构建"在此规模已不划算。
- `frontend/` 改为 Vite 工程：`package.json`、`vite.config.ts`、`src/main.ts`、`src/App.vue`、`src/views/{Home,Config}.vue`、`src/components/...`、`src/formspec.ts`（form-spec）、`src/store.ts`（配置模型 + 同步）。
- `tauri.conf.json`：`build.devUrl = http://localhost:5173`、`beforeDevCommand = pnpm dev`、`beforeBuildCommand = pnpm build`、`frontendDist = ../frontend/dist`。
- `withGlobalTauri` 可关掉——改用 `@tauri-apps/api`（npm 包）`invoke`，配合 Vite 更标准。

### 2. form-spec 手写，驱动结构化控件（D1a）
`src/formspec.ts` 是单一数据源：声明每一节/字段（key 路径、类型、label、默认、必填、仅在特定模式下可见）。它**不**从 tng 的 `schemars` 生成（松耦合硬约束），由人据 TNG 源码维护。覆盖范围：control port、ingress/egress 各模式字段、`no_ra`。未覆盖的（RA attest/verify、ohttp 高级、metric/trace 细节、罕见模式）走原始 JSON 视图。
- 模型形态：一个普通 TS 对象（TNG 配置的子集表示），与 JSON 之间有 `serialize(model)→JSON` / `parse(json)→model`；结构化控件绑定 model 路径，原始 JSON 视图绑定 `serialize(model)`。
- **模式判别落地**：ingress/egress 条目结构化为 `{ mode, fields, no_ra, advanced }`；`serialize` 时产出外挂 tag `{ [mode]: fields, no_ra, ... }`。切换模式时丢弃旧 `fields`、按新模式重置默认（**风险：丢用户输入**，见风险节）。

### 3. 导入导出经 tauri-plugin-dialog + Rust（D4）
原生 open/save 对话框，路径由 Rust 读写文件（贴合"文件 IO 走 Rust"）：
- 新增命令 `import_config(path: String) -> Result<String, String>`：读文件返回 JSON 字符串；前端拿到后 `parse`→回填 model + 原始 JSON。
- 新增命令 `export_config(path: String, json: String) -> Result<(), String>`：把 pretty JSON 写入路径。
- 对话框本体用 `tauri-plugin-dialog` 的 JS API（`@tauri-apps/plugin-dialog` 的 `open`/`save`）由前端调；取到路径后再 invoke 上述读写命令。capability 授权 `dialog:default`（或 `dialog:allow-open`/`allow-save`）。
- 解析/写入失败 → 透出错误（不破坏当前配置）。

### 4. 默认模板开局，不持久化（D4）
`formspec.ts` 内置一份默认 model（含 `control_interface.restful.port`（如 50000）+ 一条 `no_ra` mapping ingress 示例）。GUI 启动即载入，不读写本地存储；关闭即丢。导入是覆盖起点的唯一通道。

### 5. 首页纯监视拆分
首页组件只调 `get_status`/`get_output`（沿用 1.5s 轮询），渲染三态灯 + `/status/` JSON + 输出区。配置 textarea 与启停按钮移到配置页。无新后端命令。

### 6. 启动/重启复用 launch_tng
配置页"启动/重启"= `serialize(model)` → `invoke('launch_tng', { configJson })`。`launch_tng` → `prepare_config`（强制 127.0.0.1 + 要求 port）→ `write_runtime_config` → `TngSupervisor::launch`（已含 kill-then-spawn）。后端零改动。

## 风险 / 取舍

- **[form-spec 与 tng 漂移]** → 手写 spec 在 tng 加字段时会滞后；缓解：原始 JSON 视图始终可编辑全量字段；spec 顶部注明对应 tng 版本。
- **[严格性不均致静默错误]** → 无 `deny_unknown_fields` 的节拼错被 tng 静默忽略；缓解：表单对必填项做前端校验，重大错误仍由 tng stderr 经 `get_output` 回显。
- **[切换模式丢用户输入]** → 切模式即重置 fields；缓解：切换前若 fields 已被改动，弹确认（AntDV `Modal.confirm`）。
- **[Vite 构建环境]** → 本机构建机 headless 无法整体编译 Tauri，但 `pnpm install`/`vite build` 可在 node 环境单独验前端；Tauri 整体编译仍须在带 WebKitGTK/WebView2 的机器。
- **[AntDV 包体积]** → 按需引入（`unplugin-vue-components` + `Components` resolver）控制 bundle 体积。
- **[dialog 模态/取消]** → 用户在原生对话框取消 → 前端拿到 `null`，不报错、不改变配置。
- **[模型↔JSON 非对称]** → 结构化 model 是 tng 配置子集；原始 JSON 编辑可能填入 model 不认的字段（如 RA attest）→ `parse` 时"已知字段回填表单、未知字段原样保留在 model 的 `extra` 容器"以免往返丢字段。**这是 form-spec 设计的关键点。**

## 迁移计划

前端从单文件 `index.html` 迁到 Vite 工程；旧文件删除。`src-tauri` 加 dialog 插件与两命令。后端契约与 core 不动。无数据迁移（本就不持久化）。回滚=还原 `frontend/` 单文件 + 撤销 plugin/命令。

## 待决问题

- **默认控制端口值**：内置模板用 50000 固定，还是启动时由 GUI 选空闲端口占位？倾向固定 50000（与 MVP 模板一致，简单）；冲突由 tng stderr 反馈。
- **AntDV 版本**：用 4.x（Vue 3）最新稳定；构建时锁定。
- **"高级/折叠区"粒度**：每条 ingress/egress 内的 ohttp/rats_tls/quic/web_page_inject 是逐条折叠还是全局高级开关？倾向逐条折叠（`a-collapse`）。