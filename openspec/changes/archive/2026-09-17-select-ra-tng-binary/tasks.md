## 1. 核心层（tngui-core）

- [x] 1.1 `tngui-core/src/config.rs`：`prepare_launch` 返回 `(Value, routes, ra_required)`，判定规则为“任一条 `add_ingress` 条目 `no_ra` 非 `true` 即开”（`add_ingress` 缺失/空 → false），兼容 `verify`/`no_ra` 序列化与双缺省原始 JSON；补单测覆盖：单条 `no_ra=true`、单条 `verify`、字段双缺省、多条混合（RA 开+关并联）、无/空 `add_ingress`，`cargo test -p tngui-core config::` 通过
- [x] 1.2 `tngui-core/src/process.rs`：`TngSupervisor::new(bin_nora, bin_ra: Option<String>, log_cap)` 双 bin、`launch(config, ra_required)` 按判定选 bin、`build_command`/`ensure_executable` 作用于选定 bin；补单测：`ra_required=true` 且 `bin_ra=None` 时 `launch` 返回明确错误、普通版仍可 launch，`cargo test -p tngui-core process::` 通过

## 2. 外壳（src/lib.rs）

- [x] 2.1 把 `resolve_tng_path` 泛化为 `resolve_resource_bin(app, name)`（平铺 + 一层子目录），普通版名 `tng-nora`/`tng-nora.exe`（未命中回退 PATH 上的 `tng`）、RA 版 `cfg` 平台映射（`tng.exe`/`tng-linux-x86_64`/`tng-linux-aarch64`/`tng-aarch64-apple-darwin`，`macos x86_64` → `None` 不回退），setup 时存双路径入 `AppState`；`cargo build` 通过
- [x] 2.2 `launch_tng`：接收 `prepare_launch` 的 `ra_required`，在**停反代/杀旧进程之前**预检 `ra_required && bin_ra.is_none()` → 返回明确错误且不动现有会话，再把判定传给 `sup.launch(&runtime, ra_required)`；补/调整相关单测并 `cargo test` 通过

## 3. 分发与仓库

- [x] 3.1 `.gitignore` 放行 4 个 RA 二进制（`!/resources/tng.exe`、`!/resources/tng-linux-x86_64`、`!/resources/tng-linux-aarch64`、`!/resources/tng-aarch64-apple-darwin`）并移除 `!/resources/tng.placeholder`；执行 `git add resources/` 确认 4 个 RA 二进制全部变为待提交跟踪、`tng.placeholder` 删除入暂存、`git check-ignore` 对 4 文件均不再忽略
- [x] 3.2 确认 `tauri.conf.json` 不动（glob `resources/tng*` 覆盖双套文件），并验证 `cargo build`（tauri-build glob 校验由真实文件满足）

## 4. CI 与文档

- [x] 4.1 `.github/workflows/ci.yaml` release matrix 移除 macOS x86_64 目标；下载步骤放普通版到 `resources/tng-nora`（Unix）/`resources/tng-nora.exe`（Win）、matrix 增 `ra_keep` 并 `rm -f` 其余 3 个平台 RA 文件、删除 `rm -f resources/tng.placeholder` 行、增加本目标 `ra_keep` 文件存在性断言；release 文案改 4 目标双二进制并注明 macOS x64 不再支持；YAML 语法校验通过（如 `python -c "import yaml,…”` 或 actionlint）
- [x] 4.2 `README.md` 分发章节同步：普通版 `tng-nora` 命名与 PATH 兜底、RA 版 4 平台文件名、双二进制选择语义、发布目标表 5 → 4（移除 macOS x86_64 行）；全文 grep 确认无残留“5 目标/`tng.placeholder` 机制”表述

## 5. 集成验证

- [ ] 5.1 dev 冒烟（`cargo tauri dev`）：默认模板（RA 开）启动后 `get_output`/日志确认由 RA 版二进制（`resource_dir` 内入库文件）承载且 `get_status` 就绪；把唯一 ingress 远程证明开关关（`no_ra=true`）保存重启，确认仍可经 PATH 兜底启动（dev 机 `tng` 在 PATH 或清晰地报错，不误跑 RA 版）
- [x] 5.2 RA 缺失路径冒烟：临时移走 `resource_dir` 内 RA 文件（或用受控测试环境模拟）后，RA 开、触发启动 → 收到明确错误、现运行会话不被终止、进程列表不新增普通版子进程；恢复文件后 RA 启动恢复正常
- [x] 5.3 全量回归：`cargo test --workspace` 与 `cd frontend && npm test -- --run`（前端零改动预期全部通过）；`openspec validate select-ra-tng-binary --strict` 通过
