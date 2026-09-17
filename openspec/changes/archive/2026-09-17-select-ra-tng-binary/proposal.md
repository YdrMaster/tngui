## Why

远程证明场景需要使用另一套 tng 程序：开启与不开启远程证明必须用**不同的二进制**启动。当前 GUI 只在 App 启动期解析单套 `tng`（`resource_dir` → PATH 兜底）并固化进 `TngSupervisor`，RA 开关（逐条 ingress 的 `no_ra=false`/`verify`）只随配置透传、不影响所启动的二进制——"开启远程证明"因此失去真实语义。RA 版程序现已直接放入 `resources/`（4 平台，macOS x64 不再支持），需要建立按 RA 开关选择二进制的分发与启动机制。

## What Changes

- **双二进制分发与命名（方案 A）**：
  - **RA 关**：维持现状——CI 按 `TNG_VERSION` 从 TNG 官方 release 下载普通版 tng，但放置名改为 `resources/tng-nora`（Unix）/`resources/tng-nora.exe`（Windows），以避开 RA 版 Windows 二进制 `tng.exe` 的撞名；找不到时保留 PATH 上的 `tng` 兜底（开发态）。
  - **RA 开**：使用直接入库的 RA 版二进制，按平台映射——Windows x64 → `tng.exe`、Linux x86_64 → `tng-linux-x86_64`、Linux aarch64 → `tng-linux-aarch64`、macOS aarch64 → `tng-aarch64-apple-darwin`。
- **RA 判定在启动时收口**：`prepare_launch` 基于最终 runtime 配置返回 `ra_required`——任一条 `add_ingress` 开启 RA（`no_ra` 非 `true`；与前端序列化语义一致）即须用 RA 版二进制。设置页保存/重启后自然切换二进制。
- **RA 版缺失须拒绝启动并报明确错误，绝不**（MUST NOT）静默回退到普通版：否则 UI 显示 RA 开启但实际未跑 RA，属安全语义错误。macOS x86_64 无 RA 版二进制，该平台 RA 启用时同样明确报错。
- **4 个 RA 二进制真正入库**：`.gitignore` 增加对应例外；`resources/tng.placeholder` 占位机制退役（glob `resources/tng*` 现由真实文件满足）。
- **发布目标 5 → 4**：移除 macOS x86_64（该架构不再支持）；CI 每目标打包含"普通版 + 本平台 RA 版"两个二进制，构建前移除其他平台的 RA 二进制，避免安装包携带约 140MB 死重。

## Capabilities

### New Capabilities
（无——不新增能力目录）

### Modified Capabilities
- `gui-shell`：MODIFIED 需求"tng 二进制随软件分发并从资源目录发现"——从单套 `tng` 扩展为**双二进制按 RA 开关选择**：RA 关用普通版（`tng-nora`，含 PATH 兜底），RA 开用入库 RA 版（平台映射名、无 PATH 兜底），RA 版缺失时报错拒绝启动且不回退。

## Impact

- **外壳**：`src/lib.rs`——`resolve_tng_path` 泛化为双二进制解析（两张平台映射表，普通版保留 PATH 兜底、RA 版不回退）；`AppState` 持双路径；`launch_tng` 在杀死现有会话**之前**预检 RA 二进制可用性，再把判定传给 supervisor。
- **核心**：`tngui-core/src/config.rs`——`prepare_launch` 返回 `ra_required`（基于最终 runtime 配置），新增判定单测；`tngui-core/src/process.rs`——`TngSupervisor` 持双 bin、`launch` 按判定选 bin，`ensure_executable`/`build_command` 对选定 bin 生效（RA 二进制入库无执行位，启动期补 chmod），补两套 bin 的单测。
- **分发**：`.gitignore`（RA 4 文件例外、移除 placeholder 例外）；`resources/`（占位符退役、RA 二进制纳入版本控制）；`tauri.conf.json` glob 不变。
- **CI**：`.github/workflows/ci.yaml`——release matrix 移除 macOS x86_64、普通版下载改放 `tng-nora`/`tng-nora.exe`、每目标构建前移除其他平台 RA 二进制、release 文案同步（4 目标）。
- **文档**：`README.md` 分发章节与发布目标表同步双二进制说明。
- **非目标**：不改 `no_ra`/`verify` 的配置语义与 UI、不改推理发送与反代、不做 RA 过程的真实状态展示（仍是规范中的占位）、不改 `TNG_VERSION` 钉定机制；RA 版来源/版本追溯（如 `TNG_RA_VERSION` 文件）暂不引入、后续需要另立变更。
