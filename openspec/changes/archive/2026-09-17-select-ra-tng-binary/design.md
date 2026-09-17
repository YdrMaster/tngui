## Context

现状是单套二进制、启动期固化：App setup 时 `resolve_tng_path` 解析一次 `tng`/`tng.exe`（resource_dir 平铺 + 一层子目录，未命中回退 PATH）传给 `TngSupervisor::new(bin, 4000)`；`launch_tng` 每次重启执行 `prepare_launch → 写 runtime.json → sup.launch`，supervisor 持固定 `bin`。RA 开关在配置层早已存在且逐 ingress：前端序列化产出 `no_ra:true`（RA 关）或 `verify{...}`（RA 开），而 `configmodel.parse` 对两者皆缺省的原始 JSON 判为 RA 开（`e.no_ra === true` 才算关）——即 **"RA 开 = `no_ra` 非 `true`"**。

分发链普通版由 CI 按 `TNG_VERSION` 下载 TNG 官方产物放入 `resources/`，`.gitignore` 以 `/resources/*` + `!/resources/tng.placeholder` 控制入库；RA 版 4 个真实二进制（Win `tng.exe`、Linux `tng-linux-x86_64`/`tng-linux-aarch64`、macOS arm64 `tng-aarch64-apple-darwin`，约 190MB）已放入 `resources/` 但被现 ignore 规则挡在版本控制外，且 `tng.placeholder` 已删（工作区）。`tauri.conf.json` 的 `bundle.resources = ["resources/tng*"]` 会把目录内所有匹配文件打进每个平台的安装包。macOS x86_64 无 RA 版产物，产品发布目标 5 → 4。

## Goals / Non-Goals

**Goals:**
- RA 判定与二进制选择对全部三条启动入口（概览启动、设置保存/重启、离开设置自动重启）一次收口，语义与前端序列化/解析一致。
- RA 版缺失时 fail-fast：报明确错误、不回退、也不终止当前运行中的原会话。
- 仓库与安装包都可靠携带 RA 版二进制，且每个平台安装包只含本平台 RA 版（避免死重）。

**Non-Goals:**
- 不改 `no_ra`/`verify` 的配置形态与 UI；不改推理/反代/控制面轮询。
- 不做 RA 运行状态的真实展示（规范中的 RA 过程占位维持）。
- 不引入 `TNG_RA_VERSION`——RA 版版本由 git 提交钉定；如需来源/产物追溯另立变更。

## Decisions

- **D1 — RA 判定在核心层返回，而非壳层重复解析。** `prepare_launch` 的返回值从 `(Value, routes)` 扩为 `(Value, routes, ra_required: bool)`：`ra_required = add_ingress 中任一条目的 no_ra !== true`（`add_ingress` 缺失/空数组 → false）。与前端 parse 语义逐字对齐（verify 或两者皆缺 → 开）。备选：在 `launch_tng` 里再 sed 一遍 JSON——否决，第二套解析必然与前端/核心语义漂移，且 `prepare_config` 诊断路径会漏判定。
- **D2 — resolver 泛化为"按名查找"，双映射表在壳层。** 把 `resolve_tng_path` 改造成 `resolve_resource_bin(app, base_name) -> Option<PathBuf>`（保留现平铺 + 一层子目录兼容逻辑）。普通版名 `tng-nora`/`tng-nora.exe`（未命中回退 PATH `tng`，维持"松耦合替换无需重编"与开发态兜底）；RA 版名用编译期 `cfg` 平台映射表：`(windows,x86_64)→tng.exe`、`(linux,x86_64)→tng-linux-x86_64`、`(linux,aarch64)→tng-linux-aarch64`、`(macos,aarch64)→tng-aarch64-apple-darwin`；`(macos,x86_64)` 与其余未列平台返回 `None`（显式无支持，非静默）。备选：RA 版也做通用 glob 搜索——否决，误命中 (`tng.placeholder` 类) 风险高于收益。
- **D3 — supervisor 持双 bin、launch 按判定选。** `TngSupervisor::new(bin_nora, bin_ra: Option<String>, cap)`；`launch(config, ra_required)` 内选定本条进程的 bin，`build_command`/`ensure_executable` 均作用于选定 bin（RA 二进制入库无执行位，运行期补 chmod 的既有机制自动覆盖它）。备选一：每次 launch 由调用方传 bin 字符串——可行但把"哪套程序在跑"的状态挤出 supervisor，日志/子进程归一处持有的现结构更内聚；备选二：两个 supervisor 实例——否决，共享日志与"先杀旧再拉新"将拆成两份状态。
- **D4 — RA 缺失 fail-fast 且不杀现有会话。** `launch_tng` 在 `prepare_launch` 之后、**停反代/杀旧进程之前**预检：`ra_required && bin_ra.is_none()` → 直接返回明确错误（提示"当前平台未随包提供远程证明版 tng 二进制；开启远程证明需要该版本"），当前运行的普通版会话与反代保持原状。备选：交给 supervisor 先杀再报——否决，会把可用会话带停机。本次改动不触发 UI 结构变化，三条启动入口的既有错误路径直接展示该错误。
- **D5 — 仓库与打包改动最小化。** `.gitignore`：以显式白名单放行 4 个 RA 文件（`!/resources/tng.exe`、`!/resources/tng-linux-x86_64`、`!/resources/tng-linux-aarch64`、`!/resources/tng-aarch64-apple-darwin`）、移除 `!/resources/tng.placeholder`，使 `git add resources/` 后 4 个二进制进入版本控制；`resources/tng.placeholder` 的删除随本变更提交退役（glob 校验由真实文件满足）。`tauri.conf.json` 的 glob 不改——`resources/tng*` 匹配两套全部文件。备选：glob 改精确枚举——否决，未来加目标/文件反而易漏。
- **D6 — CI release 4 目标 + 每目标剪枝。** matrix 删 `macos x86_64`；"Download & place bundled tng" 步骤变为：①普通版下载产物改放 `resources/tng-nora`（Unix）/`resources/tng-nora.exe`（Win，避开 RA 版 `tng.exe` 撞名覆盖）；②按 matrix 显式提供 `ra_keep`（本平台 RA 文件名）保留之并 `rm -f` 其余 3 个平台 RA 文件（防 `resources/tng*` 把全部 4 个二进制约 190MB 打进每个安装包）；③删除原 `rm -f resources/tng.placeholder` 行；④增加存在性断言（本目标 RA keep 文件必须存在，缺则 fail——防 .gitignore 白名单漏项静默漏打包）。release 文案改 4 目标、说明双二进制与 macOS x64 不再支持。
- **D7 — 不新增前端/状态面变化。** 开启与否的判定完全由后端从 runtime 配置推导；运行中的二进制身份可经进程命令行/日志观察。前端零改动，避免为"哪套在跑"扩张 UI 状态位（规范中的 RA 过程占位不变）。

## Risks / Trade-offs

- [安装包体积增长（双二进制，单目标约 +15–60MB）] → 接受为功能必要成本；CI 每目标剪掉其他 3 个平台 RA 文件，避免约 140MB 跨平台死重。
- [git 仓库体积一次性 +约 190MB] → 用户已确认 RA 版直接入库；本次一次性提交，后续升 RA 版会用增量历史。如需换存储（LFS/制品库）后续另议。
- [`.gitignore` 白名单漏项 → release checkout 缺 RA 二进制] → CI 增加本目标 RA 文件存在性断言（D6④），漏项在发布期 fail 而非静默产出坏包。
- [RA 判定与前端语义漂移（导入原始 JSON 边界）] → 核心层 `ra_required` 单测覆盖：单条 no_ra=true、单条 verify、字段双缺省、多条混合、空/缺失 add_ingress。
- [macos x64 旧版本升级后开启 RA] → 明确报"当前平台未随包提供远程证明版 tng 二进制"，不静默降级——该架构已从发布目标移除。
- [dev 态直接实测 RA] → RA 4 文件入 git 后，`cargo tauri dev` 的 resource_dir 即包含真实 RA 文件，RA 开启可直接启动调试；普通版 dev 仍走 PATH 兜底。
- [RA 版程序自身行为兼容控制面（同 restful port 等）] → 沿用三条松耦合契约假定；若 RA 版与控制面接口有差异，实施时以冒烟（启动 + get_status 就绪）验证，必要时在本变更内反馈再定。

## Migration Plan

1. 提交 `.gitignore` 改动并将 4 个 RA 二进制 `git add` 入库（连同 `tng.placeholder` 删除），与代码/CI 同批合入。
2. 下一个 tag 起 release 自动产出 4 目标双二进制安装包；无需对已安装旧版本做数据迁移（资源名变化只存在于新版安装包内部，无用户态持久数据涉及）。
3. 回滚 = `git revert` 本变更（二进制文件回退由 git 历史承载)；开发态行为回到单套 PATH 兜底。

## Open Questions

- RA 版二进制的来源/版本字符串是否需要独立钉定（如 `TNG_RA_VERSION`）——已在范围内明确不引入；若后续要做，另立变更，不影响本次结构。
