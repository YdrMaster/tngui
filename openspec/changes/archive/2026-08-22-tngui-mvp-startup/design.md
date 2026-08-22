## 背景

仓库目前是空白的 Rust 2024 二进制（`Cargo.toml` + `src/main.rs` 桩）——这是第一份真正代码。tng 运行时契约已对照 TNG 源码（`/home/admin/yangderui.ydr/Confidential-AI/TNG`）核验，是下述所有决策的地基：

- **CLI**：`tng launch -c/--config-file <路径>`（或 `--config-content`）；`--log-file <文件>` 是全局 flag；无 `--log-level`（日志级别走 `RUST_LOG`）；`admin_bind` 已废弃忽略。
- **REST 控制面**：只有 4 条 `GET` 路由——`/livez`、`/readyz`、`/status/`、`/status/{path}`——**无鉴权、无写端点**。
- **就绪信号**：`livez` 硬编码返回 200（弱）；`readyz` 通过一个 `tokio::watch` 在所有服务就绪后翻为 200（强，是真正的就绪信号）。
- **`/status/` 形状**：根返回 `["egress","ingress"]`（或 `[]`）；更深路径走 子树/值 树遍历。
- **control_interface 配置**：`restful` flatten 了 `Endpoint { host: Option<String>, port: u16 }`；`host` 缺省时默认 **`0.0.0.0`**；`port` 必填；无 `token` 字段；带 `deny_unknown_fields`。
- **配置严格性**：`TngConfig` 及子结构带 `#[serde(deny_unknown_fields)]`；拼错或未知字段会在 `main.rs` 解析阶段失败——早于 `--log-file` 日志初始化——tng 非零退出并把错误打到 stderr。

动机见 `proposal.md`；三契约松耦合设想与 clash-verge 参考模式见 `tng-gui-design.md` §3–§5。

## 目标 / 非目标

**目标：**
- 以一条薄垂直切片验证三条契约（A：CLI 拉起、B：REST 读、C：stderr 捕获）——证明 GUI 能在不链接任何 tng 代码的前提下驱动 tng。
- 打下 **Rust 后端地基**（解析→注入→写盘→拉起→轮询→错误反馈），这块在后续阶段基本完整保留，与前端最终长成什么样无关。
- 最小 Tauri 2 外壳 + 单文件前端——为 3 个控件的 UI 把仪式成本压到最低。

**非目标（设计层面，超出 proposal 范围）：**
- 不做 React/Vite、Monaco、JSON Schema 表单或配置模板——那是下一轮"配置生成"的事。
- 不做 `tauri-plugin-mihomo` 式的实时 REST/WS 插件、`/metrics`、日志环形缓冲/订阅——TNG 控制面太弱，不值得。
- 不做 sidecar/`externalBin` prebuild 打包、自动更新、安装器。
- 不做系统代理开关、`tng exec`/TUN/特权服务路径。
- 不做生产级跨平台加固（Windows Job Object、Unix `umask 0o077`、服务提权）——见决策 8。
- 不改 TNG 内核。

## 决策

### 1. Tauri 2 + 单文件 HTML/JS 前端（D1）
UI 就是一个文本框、一个按钮、一个状态灯、一个输出区。MVP 的风险和价值都在 **Rust 侧契约**，跟前端用什么几乎无关。原生 HTML/JS 现在把工具链仪式降到最低；React/Vite/Monaco 留给配置编辑器阶段，那时换前端不碰 Rust `#[tauri::command]` 层。
- *备选*：(a) 现在就 Tauri2+React——无后续迁移，但为 3 个控件上 Vite 偏重；(b) 纯 Rust GUI（egui/slint）——构建最简，但背离 clash-verge 路线、未来 Monaco/schema 表单难做（大概率重写）。

### 2. 用户写全量 JSON；GUI 只强制 host=127.0.0.1（D2）
文本框里是完整 TNG JSON 配置，含 `control_interface.restful` 与**用户自选端口**。后端唯一的改动是安全收口——把 `host` 设成 `127.0.0.1`（缺则注入、`0.0.0.0`/其他则覆盖）——外加预检：缺 `restful.port` 则拒绝。MVP 保持透明：用户掌控网关配置，能看到实际启动了什么。
- *备选*：GUI 自动注入 `control_interface.restful` 并用 bind-`127.0.0.1:0` 选空闲端口。更省事（无端口冲突）但向用户藏起了控制面、还多了端口发现逻辑——留到下一轮"配置生成"。

### 3. 捕获子进程 stderr/stdout，只读（D3）
严格 JSON 解析失败发生在 `--log-file` 初始化之前，所以 **stderr 是唯一能告诉用户"第几行哪个字段错"的通道**。spawn 时顺带捕获 stdout/stderr 近乎零成本。`--log-file <应用数据目录>/tng.log` 仍会传，让运行时日志落盘（可查、可重启），但 UI 里实时显示的是 stderr/stdout。
- *备选*：只 tail `--log-file`——完全抓不到解析错误；完整契约 C 的环形缓冲+订阅——留给后续更丰富的日志面板。

### 4. tng 从 PATH 解析（D4）
测试阶段：tng 二进制由 TNG 源码手工编译、放进 `PATH`。后端直接 spawn `tng`。不做 Tauri `externalBin`/sidecar、不做 prebuild 下载矩阵。
- *备选*：clash-verge 的 `externalBin` sidecar + 按 target triple prebuild——留到打包阶段。

### 5. 状态客户端放在 Rust 后端；前端轮询命令
后端持有（用户自选的）端口，在 Tauri tokio 运行时里用异步 `reqwest` 打 `GET /livez|/readyz|/status/`；前端每约 1.5s 轮询 `get_status()` 命令。这样避开 webview 对 `127.0.0.1` 的 CORS / 混合内容问题，端口知识也留在服务侧。
- *备选*：前端直接 `fetch`——CORS/端口发现有摩擦；后端 `emit` 事件推送——略好但接线更多，暂缓。

### 6. 三态灯以 livez + readyz 为据
已核验：`livez` 硬编码 200（区分不了"活着"与"半死"）；`readyz` 才是真正就绪信号。状态：连不上 → **不可达**（红）；`livez` 通过 ∧ `readyz` 503 → **启动中**（黄）；`readyz` 200 → **就绪**（绿）。
- *备选*：只看 `/livez`——分不清启动中与已挂。

### 7. 单个幂等 启动/重启 按钮；无 Stop 按钮
一个控件：若已有 tng 子进程则先杀掉，再用当前 JSON 重启。子进程 PID/句柄存后端状态。贴合用户"一个按钮搞定启动或重启"。
- *备选*：独立的 start/stop/restart——暂缓；日后加不破契约。

### 8. MVP 先打 Linux 开发机；跨平台加固后做
环境是 Linux（alios7）。`std::process` spawn + kill 对 MVP 足够。clash-verge 的生产模式——Windows Job Object（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）、Unix `umask 0o077`、特权模式服务提权——是真问题，但属打包/生产关切，不是 MVP 契约关切。
- *取舍*：现在能在 Linux 开发机上跑起来的 MVP，胜过几周后才跨平台正确的外壳。打包阶段再回归跨平台。

## 风险 / 取舍

- **[用户自选端口已被占用]** → tng 绑定失败，表现为 stderr + 不可达红灯。MVP 可接受；下一轮自动选端口（D2 备选）可消除。
- **[杀进程可能因 tng fork 出孙进程而泄漏]** → 对 `tng launch`（非 `exec`）而言子进程就是网关进程。缓解：在新进程组里拉起，重启时给整组发信号（实现时定，倾向组杀）。`tng exec` 不在范围内。
- **[控制面无鉴权]** → 强制 `127.0.0.1` 已缓解，仅限回环。残留：本机其他用户仍可触达。测试/开发 MVP 可接受；生产需 token 或 Unix socket 模式（TNG §7 additive，不在范围内）。
- **[严格 JSON：拼错看起来像静默失败]** → stderr 捕获会显示 tng 的精确字段错误，已缓解。
- **[某服务始终未就绪，`readyz` 一直 503]** → 灯停在黄色；用户看 stderr 找线索。可接受——状态是展示面，不是控制面。
- **[原生 JS 前端在 React 到来时会被弃用]** → 认了；Rust 后端 + IPC 命令面是留存地基，与前端无关。
- **[约 1.5s 轮询可能错过快速状态跳变]** → 对状态展示可接受；这不是控制面。

## 迁移计划

全新项目：把桩 `Cargo.toml`/`src/main.rs` 重构为 Tauri 2 应用（`src-tauri/` + 前端资源）。无既有用户或数据，故无回滚或数据迁移顾虑。桩 `src/main.rs` 被替换。

## 待决问题

- **应用数据目录**：`tng-runtime.json` / `tng.log` 用 Tauri 默认 `app_data_dir()` 还是显式 XDG 路径。可延后——倾向 Tauri 默认；在 tasks 里落定。
- **重启杀的粒度**：只杀子进程 PID 还是杀整个进程组。可延后——倾向进程组；实现时确认。
- **轮询间隔**：约 1.5s 是占位值；待观察到冷启动耗时后在实现阶段微调。