## 背景

现状：GUI 在 `src-tauri/src/lib.rs` 里 `TngSupervisor::new("tng", 4000)`，`tngui-core` 的 `build_command` 用 `Command::new(&self.bin)` ⇒ **走 PATH**（D4：测试期手工编译放 PATH）。`tauri.conf.json` 现为 `bundle.active=false`（MVP 为省 icon 关闭）。`tngui-core`/前端/三契约均与本次无关。

TNG 侧事实（agent 已核验 `inclavare-containers/TNG`）：
- TNG 自己的 `.github/workflows/build-binary.yml` 在 tag `v*.*.*` 触发，**已发布 5 目标 release 产物**：`aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`、`x86_64-pc-windows-gnu`。
- 资产命名（`build-binary.yml` compress 步）：Windows 出 `tng-<ver>.x86_64-pc-windows-gnu.zip`（内含裸 `tng.exe`）；Linux/macOS 出 `tng-<ver>.<target>.tar.gz`（内含 `usr/.../tng`）。下载 URL：`https://github.com/inclavare-containers/TNG/releases/download/v<ver>/<asset>`。
- 自行编译（X）需扛 `aws-lc-sys`(cmake)/`protoc`/`libsqlite3-sys` + 5 个 `code.alipay.com` 私有 git deps（内嵌 token，外部 CI 易断）。**下载官方产物（Y）把这些全留给 TNG 自己 CI**，我们只下载放包。

动机见 `proposal.md`。

## 目标 / 非目标

**目标：**
- tng 随 GUI 打包分发，运行时从随包资源目录发现（开发态 PATH 兜底）。
- tag 触发的 CI 自动从 TNG 官方 release 取对应平台 tng，组装进 5 目标 GUI release。

**非目标：**
- windows-arm64（`aarch64-pc-windows-msvc`）——TNG 无官方 win-arm64 产物；列为后续。
- tng 自行编译（X）；macOS 公证/签名（codesign/notarize）——本期不做（见风险）。
- 持久化/多 profile、tng-log tail 等既有非目标延续。

## 决策

### 1. 走 Tauri `resources` 随包分发（而非 externalBin/手动同目录）
`bundle.resources` 是 Tauri 原生机制，绕开 `externalBin`+`tauri-plugin-shell`（MVP 本就用 `tokio::process` 直 spawn，不引 shell 插件），位置按平台惯例（macOS 落 `Contents/Resources`，Win/Linux 落安装目录）。`tauri.conf.json`: `bundle.resources = ["resources/tng*"]`（glob 兼容 `tng`/`tng.exe`）。
- *备选*：`externalBin` sidecar（要 shell 插件 + 按 triple 命名）；手动复制到 exe 同目录（更手工）。均不如 resources 惯例。

### 2. 运行时解析：`resource_dir` → PATH 兜底（在 Tauri 外壳，不在 core）
逻辑放 `src-tauri/src/lib.rs` 的 `run()`/`AppState` 初始化处（有 app 上下文）：
```
候选1 = app.path().resource_dir()? / (cfg!(windows) ? "tng.exe" : "tng")
候选2 = "tng"  // PATH 兜底（开发态）
tng_path = 候选1 存在 ? 候选1 : 候选2
TngSupervisor::new(tng_path, 4000)
```
`tngui-core` 不动（本就"给什么路径 spawn 什么"）。`std::env::current_exe` 也可行，但 `resource_dir` 与 resources 打包机制一致、跨平台惯例正. PATH 兜底保开发态（`cargo run` 时 exe 在 `target/debug`，资源里无 tng）。

### 3. 重开 `bundle.active` 并补图标
正式 release 需 bundling。`bundle.active=true`，`icon` 列出各平台图标（已有 `icons/icon.ico`；按 Tauri 约定补 `png` 给 mac/linux + `icns`/`png`）。MVP 当初为省 icon 关掉，现开。

### 4. CI 用下载官方产物（Y），不自编（X）
每目标从 TNG 官方 release 下载对应 tng → 解包 → 放 `src-tauri/resources/` → `tauri-action` 打 GUI 上传。把 aws-lc-sys/protoc/私有 token 的重活留给 TNG 自己的 CI。

### 5. 5 目标 matrix（win-arm64 非目标）
GUI 目标 → TNG 资产映射：

| GUI 目标 | runner | TNG 资产 target | 资产格式 | tng 落位 |
|---|---|---|---|---|
| `x86_64-pc-windows-msvc` | windows-latest | `x86_64-pc-windows-gnu` | `.zip`(裸 `tng.exe`) | `src-tauri/resources/tng.exe` |
| `x86_64-unknown-linux-gnu` | ubuntu-22.04(native) | `x86_64-unknown-linux-gnu` | `.tar.gz`(`usr/.../tng`) | `src-tauri/resources/tng` |
| `aarch64-unknown-linux-gnu` | ubuntu-22.04(交叉) | `aarch64-unknown-linux-gnu` | `.tar.gz` | `src-tauri/resources/tng` |
| `x86_64-apple-darwin` | macos-latest | `x86_64-apple-darwin` | `.tar.gz` | `src-tauri/resources/tng` |
| `aarch64-apple-darwin` | macos-latest | `aarch64-apple-darwin` | `.tar.gz` | `src-tauri/resources/tng` |

Windows-x64 用 gnu 版 tng.exe：Windows 可执行与 GUI 的 msvc 工具链无关（独立进程，gnu 版 Rust 默认静态链 mingw 运行时，自包含），可正常跑。

### 6. runner 选路与 GUI 构建（借 clash-verge `release.yml` 骨架）
- windows/mac：原生 runner；linux-x64 原生；linux-arm64 用 apt 多架构 + `gcc-aarch64-linux-gnu` + `PKG_CONFIG_PATH` 交叉（仿 clash-verge `release-for-linux-arm`）。
- 各 runner 装 Tauri 系统依赖（ubuntu: `webkit2gtk-4.1-dev` 等；mac/win 自带 WebView2/WebKit）。
- `tauri-action` 打包并上传到 release。

### 7. 版本钉法
- GUI 版本 = 触发的 tag `v*.*.*`。
- tng 版本 = workflow 里的 `TNG_VERSION`（钉 TNG tag，如 `2.8.0`），**与 GUI 版本解耦**。可在仓库根放一个 `TNG_VERSION` 文件或 workflow env 集中管理，升 tng = 改这一处。
- 下载用硬编码 tag（非 latest），保证可复现。

### 8. resources 放置时机
CI 每目标：下载 TNG 资产 → 解包定位 `tng`/`tng.exe` → 复制到 `src-tauri/resources/tng`/`.exe` → `tauri-action` 构建（其把 resources 打进包）→ 上传。`src-tauri/resources/` 在 `.gitignore` 里（CI 填，不入库）。

## 风险 / 取舍

- **[win-arm64 缺口]** → 本期不发；后续要么等 TNG 上游加 win-arm64，要么单开一个 X 自编 job（agent 标 aws-lc-sys win-arm64 最高风险）。文档注明。
- **[TNG 资产命名漂移/可达性]** → TNG 改 release 命名或资产不可达会断 CI；缓解：CI 失败快失败、资源 URL/TNG_VERSION 集中可改；必要时可切 X（agent 给了 zigbuild 配方）。
- **[tar.gz 内部路径]** → Linux/mac 资产是 `usr/.../tng`，确切子路径实现时从 `zigbuild.yml` 确认；解包用 glob/find 定位 `tng`，不硬编码。
- **[macOS 签名/公证]** → 本期不做（裸 dmg 可装但 Gatekeeper 会拦）；后续才上 Apple 证书（仿 clash-verge 的 APPLE_* secrets）。记为后续。
- **[gnu tng 于 msvc GUI]** → 已验自包含可跑；若极端情况下缺 DLL，回退：为 win-x64 也自编 msvc 版 tng（拉高成本，非本期）。
- **[包体积]** → 每平台包 +一个 tng 二进制（~数十 MB），可接受。
- **[开发态仍需 PATH tng]** → 兜底保留；开发者本机放 tng 到 PATH 即可 `cargo run`。

## 迁移计划

无既有终端用户（pre-release）。开发态靠 PATH 兜底不破。CI 上线后首个 tag 产生 5 目标安装包。

## 待决问题

- macOS 是否本期就配签名/公证（需要 Apple 开发者凭据）？倾向**本期不做**，发未签名 dmg 并在 release 说明里提示 Gatekeeper 处理。
- `TNG_VERSION` 放仓库根文件还是 workflow env？倾向**仓库根 `TNG_VERSION` 文件**（一处改、可被其他脚本读）。
- linux-arm64 是否也可用 native arm runner（GitHub 已有 `ubuntu-24.04-arm`）免交叉？可调研；倾向先沿用 clash-verge 交叉法保稳，后续切 native arm runner 提速。