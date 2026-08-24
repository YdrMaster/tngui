## ADDED Requirements

### Requirement: tng 二进制随软件分发并从资源目录发现

系统须（SHALL）将 `tng` 二进制作为随包资源与 GUI 一同分发，并在启动/重启 tng 时从打包资源目录（Tauri `resource_dir`）解析对应平台的可执行名（Unix 为 `tng`、Windows 为 `tng.exe`）后拉起；若资源目录中不存在 `tng`，则回退使用 `PATH` 上的 `tng`。

#### Scenario: 随包分发命中

- **WHEN** 已安装的 GUI（随包含 `tng` 资源）触发启动/重启
- **THEN** 系统从 `resource_dir` 解析到 `tng`（或 Windows 的 `tng.exe`）并拉起，无需用户自行放置 `tng`

#### Scenario: 开发态 PATH 兜底

- **WHEN** 开发态（随包资源中无 `tng`，例如 `cargo run`）触发启动/重启
- **THEN** 系统回退使用 `PATH` 上的 `tng` 拉起

#### Scenario: 替换 tng 无需重编 GUI

- **WHEN** 用户替换 `resource_dir` 中的 `tng` 文件后触发启动/重启
- **THEN** GUI 拉起的是被替换后的 `tng`，无需重新编译 GUI