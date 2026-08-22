## Purpose

渲染一个最小化 GUI，依据用户编写的 JSON 配置启动并重启 tng 进程，展示 tng 只读控制面的状态，且不链接任何 tng 代码。

## ADDED Requirements

### Requirement: 带配置编辑器与启动控制的 GUI 窗口

系统须（SHALL）渲染一个桌面 GUI 窗口，其中包含一个文本框供用户编写完整 TNG JSON 配置，以及一个用于启动或重启 tng 进程的单一控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在文本框输入合法的 TNG JSON 配置并触发启动/重启控件
- **THEN** 系统将该配置写入文件并以该配置文件拉起 `tng launch`

#### Scenario: 重启时先终止既有进程

- **WHEN** GUI 启动的 tng 进程已在运行，且用户触发启动/重启控件
- **THEN** 系统在以当前配置拉起新进程之前先终止既有 tng 子进程

### Requirement: 控制面 host 强制走回环地址

系统须（SHALL）将传给 tng 的配置中的 `control_interface.restful.host` 设为 `127.0.0.1`，无论用户如何编写，因为 tng 控制面无鉴权，缺省时会绑定 `0.0.0.0`。

#### Scenario: 用户缺省或写非回环 host

- **WHEN** 用户编写的配置中 `control_interface.restful.host` 缺省或被设为 `127.0.0.1` 以外的值
- **THEN** 传给 tng 的配置将控制面绑定到 `127.0.0.1`

### Requirement: 缺失控制端口时拒绝启动

若用户编写的配置缺少 `control_interface.restful.port`，系统须（SHALL）拒绝启动 tng 并显示明确提示，因为状态客户端无端口则无法轮询控制面。

#### Scenario: 配置缺少 control_interface.restful.port

- **WHEN** 用户以不含 `control_interface.restful.port` 的配置触发启动/重启
- **THEN** 系统不拉起 tng，并在界面中展示说明性错误

### Requirement: 从控制面只读 tng 状态

系统须（SHALL）周期性轮询 `127.0.0.1:<端口>` 上的 `GET /livez`、`GET /readyz`、`GET /status/`，并展示三态状态指示：不可达、启动中、就绪。

#### Scenario: tng 不可达

- **WHEN** 对控制端口的轮询连接失败
- **THEN** 状态指示显示"不可达"态

#### Scenario: tng 启动中

- **WHEN** `/livez` 返回成功且 `/readyz` 返回 503
- **THEN** 状态指示显示"启动中"态

#### Scenario: tng 就绪

- **WHEN** `/readyz` 返回 200
- **THEN** 状态指示显示"就绪"态

#### Scenario: 展示状态树

- **WHEN** `/status/` 返回 JSON body
- **THEN** 系统在状态面板中渲染该 JSON body

### Requirement: 以只读方式呈现 tng 进程输出

系统须（SHALL）捕获所拉起 tng 进程的 stdout 与 stderr 并在只读区展示，使用户能看到配置被拒的错误——这类错误发生在 tng 的配置解析阶段，早于日志文件初始化。

#### Scenario: tng 拒绝严格 JSON

- **WHEN** 用户配置违反 tng 的严格 JSON 解析，tng 非零退出并把错误打到 stderr
- **THEN** 该错误文本出现在只读输出区

### Requirement: 对 tng 的松耦合

系统须（SHALL）仅通过 (A) 拉起 `tng` CLI、(B) 对只读控制面的 HTTP `GET` 请求、(C) 捕获进程 stdout/stderr 与 tng 交互。系统绝不（MUST NOT）链接、import 或编译任何 TNG Rust crate。

#### Scenario: tng 独立升级

- **WHEN** `tng` 二进制被替换为仍遵循启动 CLI 参数与只读 REST 路由的更新构建
- **THEN** GUI 无需重新编译即可继续工作