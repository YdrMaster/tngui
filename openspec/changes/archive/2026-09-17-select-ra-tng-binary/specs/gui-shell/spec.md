## MODIFIED Requirements

### Requirement: tng 二进制随软件分发并从资源目录发现

系统须（SHALL）随 GUI 分发并区分两套 tng 二进制，并在每次启动/重启 tng 时依据远程证明开关选择其一：

- **普通版（远程证明关闭时使用）** 作为随包资源与 GUI 一同分发，资源名为 `tng-nora`（Unix）/ `tng-nora.exe`（Windows）；启动/重启时从打包资源目录（Tauri `resource_dir`）解析后拉起；若资源目录中不存在该文件，则回退使用 `PATH` 上的 `tng`。
- **远程证明版（RA 版，任一条 ingress 开启远程证明时使用）** 直接保存在源仓库 `resources/` 目录内并随包分发，按平台命名：Windows x64 为 `tng.exe`、Linux x86_64 为 `tng-linux-x86_64`、Linux aarch64 为 `tng-linux-aarch64`、macOS aarch64 为 `tng-aarch64-apple-darwin`；启动/重启时从 `resource_dir` 解析对应文件后拉起，绝不（MUST NOT）回退到 `PATH` 或普通版。

**RA 判定**：启动/重启 tng 时，若最后生效配置中任一条 `add_ingress` 开启远程证明（该条 `no_ra` 非 `true`——含序列化为 `verify` 的条目），系统须（SHALL）使用 RA 版二进制；仅当全部 ingress 均 `no_ra=true`（或没有 ingress 条目）时使用普通版。当需要 RA 版而其在 `resource_dir` 中不存在（含无 RA 版产物的平台，如 macOS x86_64——该架构不再受支持）时，系统须（SHALL）拒绝本次启动并返回明确错误，绝不（MUST NOT）静默回退到普通版，且不得终止当前已在运行的原会话。

#### Scenario: 随包分发命中

- **WHEN** 已安装的 GUI（随包含普通版 `tng-nora` 或 Windows 的 `tng-nora.exe` 资源）在全部 ingress 均 `no_ra=true` 时触发启动/重启
- **THEN** 系统从 `resource_dir` 解析到普通版二进制并拉起，无需用户自行放置

#### Scenario: 开发态 PATH 兜底

- **WHEN** 开发态（随包资源中无 `tng-nora`，例如 `cargo run`）且 RA 全关时触发启动/重启
- **THEN** 系统回退使用 `PATH` 上的 `tng` 拉起

#### Scenario: 替换 tng 无需重编 GUI

- **WHEN** 用户替换 `resource_dir` 中的普通版或 RA 版二进制文件后触发启动/重启
- **THEN** GUI 拉起被替换后的对应二进制文件，无需重新编译 GUI

#### Scenario: 任一 ingress 开启 RA 时使用 RA 版

- **WHEN** 最后生效配置中任一条 ingress 开启远程证明（`no_ra` 非 `true`）时触发启动/重启
- **THEN** 系统按当前平台从 `resource_dir` 解析对应 RA 版二进制（`tng.exe` / `tng-linux-x86_64` / `tng-linux-aarch64` / `tng-aarch64-apple-darwin`）并拉起

#### Scenario: RA 版缺失拒绝启动且不回退

- **WHEN** 任一条 ingress 开启远程证明，而当前平台的 RA 版二进制在 `resource_dir` 中不存在（如 macOS x86_64，或文件被移除）
- **THEN** 本次启动被拒绝并返回明确错误，不拉起普通版、不回退 `PATH`，且不终止当前已在运行的原会话

#### Scenario: 切换 RA 开关重启后换用对应二进制

- **WHEN** 全部 ingress 为 `no_ra=true`（普通版运行中）时，用户开启任一条 ingress 的远程证明后保存/重启
- **THEN** 重启完成后的本次会话由 RA 版二进制承载；反向把全部 ingress 关闭远程证明并重启后，会话改由普通版承载
