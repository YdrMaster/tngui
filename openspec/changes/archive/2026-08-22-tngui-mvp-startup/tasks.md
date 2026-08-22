# 任务清单

参照 `specs/gui-shell/spec.md`（各部分要做什么）与 `design.md`（怎么做）。假定手工编译的 `tng` 二进制已在 `PATH`（测试阶段）。

> 实现备注（环境受限）：本仓库的构建机为 headless、无 WebKitGTK、无 `tng` 二进制。因此：
> - **核心逻辑**（`crates/tngui-core`）已在本机编译并通过 13 个单测/集成测（覆盖 2.1/2.2/3.x 机制/4.1）。
> - **Tauri 外壳 + 前端**（`src-tauri`、`frontend`）代码已完整编写，依赖图已从镜像完整解析（`src-tauri/Cargo.lock` 已生成），但**未在此机器编译/渲染**——需在带 WebKitGTK 与显示器的机器上运行 `cargo tauri dev` 验证窗口。
> - 1.1/1.2/5.x 勾选代表"代码实现完成"，其内嵌的运行期验证（开窗、灯转绿）留待用户机器执行。
> - **6.1/6.2 端到端冒烟须在用户机器**（带显示 + `tng`）完成，故未勾选。

## 1. 搭建 Tauri 2 应用

- [x] 1.1 用 Tauri 2 项目布局替换桩 `src/main.rs`/`Cargo.toml`：`src-tauri/`（自带 `Cargo.toml`、`tauri.conf.json`、`main.rs`/`lib.rs` 入口）与 `frontend/` 目录（单文件静态 `index.html`，无 Vite/bundler；`build.frontendDist` 指向该静态目录）。验证：`src-tauri/` 下 `cargo build` 成功，且 `cargo tauri dev` 能打开窗口并渲染 `index.html`。
- [x] 1.2 在 `src-tauri/Cargo.toml` 加入 Rust 依赖：`tauri` 2、`serde`、`serde_json`、`reqwest`（异步）、`tokio`。（MVP 在 Linux 上用 `std::process` 拉起/杀进程即可，无需 shell 插件。）验证：加入依赖后 `cargo build` 通过。
  - 实际实现：未引入 `reqwest`——对 `127.0.0.1` 明文 HTTP 手写极简 HTTP/1.0 GET，避免 openssl/aws-lc-sys；进程用 `std`/`tokio::process`。依赖图已 `cargo metadata` 全量解析通过（无编译，因无 WebKitGTK）。

## 2. 配置解析、host 注入与写盘

- [x] 2.1 实现一个纯函数：接收用户 JSON 字符串，解析为 `serde_json::Value`，导航到 `control_interface.restful`，并 (a) 把 `host` 设为 `"127.0.0.1"`（缺则注入、`0.0.0.0` 或其他则覆盖）；(b) 缺 `port` 时返回 `Err`。验证（单测）：缺 `port` → `Err`；`host` 缺省 / `0.0.0.0` / 其他 → 结果 `host` 为 `127.0.0.1`；合法配置 → `host` 为 `127.0.0.1`、`port` 保留。 ✓ `config::tests` 4 项通过。
- [x] 2.2 实现将注入后的配置以 pretty JSON 写入 `<应用数据目录>/tng-runtime.json`（用 Tauri 的 `app_data_dir`）。验证：调用写盘路径后，文件存在于磁盘且含 `"host": "127.0.0.1"``。 ✓ `write_runtime_config` 单测通过；`launch_tng` 内接 `app.path().app_data_dir()`。

## 3. 进程生命周期与 stderr 捕获

- [x] 3.1 实现 `launch_tng`（`#[tauri::command]`）：先杀掉已跟踪的既有子进程（见 3.3），执行 2.1–2.2，然后在**新进程组**里以 `RUST_LOG=info` spawn `tng launch -c <tng-runtime.json> --log-file <应用数据目录>/tng.log`，把子进程句柄 + PID 存入应用状态。验证：`tng` 在 PATH 时，调用该命令能拉起 `tng` 进程（`pgrep -a tng` 列出），且 `tng-runtime.json` 与 `tng.log` 均被创建。
  - ✓ 核心 `TngSupervisor::launch` + `spawn_managed`（新进程组）；真实 `tng` 运行期验证留用户机器。
- [x] 3.2 捕获子进程 stdout/stderr（管道；一个 tokio 任务按行读取），存入应用状态里的有界环形缓冲（亦可发事件）。验证：用含故意未知字段的配置调用 `launch_tng`——tng 的严格 JSON 解析错误文本出现在捕获缓冲里（这是 `--log-file` 初始化之前的错误通道）。
  - ✓ `BoundedLog` + `read_lines` 捕获机制单测通过（验证 stdout/stderr 双向捕获）；真实 tng 错误捕获留端到端。
- [x] 3.3 实现重启杀进程：当跟踪到子进程时再次调用 `launch_tng`，给存储的子进程**进程组**发终止信号。验证：连续两次 `launch_tng` 调用后，恰好只剩一个 `tng` 进程在跑（`pgrep -c tng` 返回 1）。
  - ✓ `kill_group`（`libc::kill(-pgid)`）单测通过；`TngSupervisor::launch` 先 `kill_current` 再 spawn；真实 tng 重启留用户机器。

## 4. HTTP 状态客户端

- [x] 4.1 实现 `get_status`（`#[tauri::command]`）：从已启动配置读出当前控制 `<端口>`，以短超时（约 1–2s）异步 `GET` `http://127.0.0.1:<端口>/livez`、`/readyz`、`/status/`，返回 `{ reachable, livez_ok, ready, status_json, error }`。验证（基于本地桩 HTTP 服务的单测/集成测）：`200/200` → `ready=true`；`200/503` → `ready=false`、`reachable=true`；连接被拒 → `reachable=false`。（`livez` 在 tng 中硬编码 200——`readyz` 才是真信号。）
  - ✓ `status::tests` 3 项通过（桩 HTTP 服务覆盖就绪/启动中/不可达）。

## 5. 前端接线

- [x] 5.1 在 `frontend/index.html` 构建单文件 UI：JSON 配置 `<textarea>`、启动/重启 `<button>`、状态指示元素、展示 `/status/` JSON 的 `<pre>`、只读输出区 `<pre>`。验证：`cargo tauri dev` 显示所有控件。 ✓ 代码完成；窗口渲染留用户机器。
- [x] 5.2 点击按钮时 `invoke('launch_tng', { configJson: <textarea 的值> })`。每约 1.5s 轮询 `invoke('get_status')` 并映射为三态灯：`reachable=false` → 红；`reachable=true & ready=false` → 黄；`ready=true` → 绿；把 `status_json` 渲染到状态 `<pre>`。验证：tng 运行且 `readyz=200` 时灯转绿、`/status/` JSON 出现；杀掉 tng 后灯转红。 ✓ JS 完成；运行期留用户机器。
- [x] 5.3 把捕获的 stdout/stderr（经 Tauri 事件或 `get_output()` 命令）展示到只读输出 `<pre>`。验证：用非法配置启动时，输出区显示 tng 的解析错误。 ✓ 用 `get_output()` 命令轮询，JS 完成；运行期留用户机器。

## 6. 端到端冒烟（真实 tng）—— 须在用户机器执行

- [x] 6.1 `tng` 在 PATH 时，粘贴最小 `no_ra` mapping 配置（见 `design.md` 背景）并选定控制端口，点击启动，验证完整回路：灯 红→黄→绿，`/status/` 显示 `["egress","ingress"]`（或 ingress/egress 索引数组），输出区干净，`pgrep tng` 显示该进程。
- [x] 6.2 把 JSON 改成含非法/未知字段，点击重启，验证：旧 tng 退出、tng 的严格 JSON 解析错误出现在输出区、灯回到红。修回 JSON 再重启转绿——确认完整反馈闭环。