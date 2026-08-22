## Why

MVP 把配置输入、启停、状态、日志全堆在一个单页里，且配置要手写完整 JSON——TNG 字段复杂（ingress/egress 各多模式、RA、ohttp），手写易错、无引导。本变更把它演进为可日常使用的形态：加导航栏，首页回归纯监视；配置编辑与启停移到专用配置页，用结构化控件替代裸 JSON，并以原生对话框支持导入导出。

## What Changes

- **BREAKING**（仅 UI 层面，不改与 tng 的后端契约）：**首页移除配置文本框与启动/重启按钮**，首页变为纯监视（状态灯 + `/status/` + 日志输出区）。
- 新增**左侧导航栏**与两视图切换（首页 / 配置）。
- 新增**配置页**：由手写 form-spec 驱动的结构化控件——`control_interface.restful.port`、`add_ingress[]`/`add_egress[]`（模式选择器 + 各模式字段）、每条 ingress/egress 的 `no_ra` 开关、可观测性/高级区。启动/重启按钮在此页。
- 新增**原始 JSON 高级视图**，与结构化表单双向同步（给高级用户和兜底编辑）。
- 新增 **JSON 配置导入/导出**，经 `tauri-plugin-dialog` 原生 open/save + Rust 读写文件。
- 前端从单文件 vanilla HTML/JS 迁移到 **Vue 3 + Vite + Ant Design Vue**。
- **不做持久化**：每次以内置默认模板开局。
- RA 仅暴露 `no_ra` 开关；`attest`/`verify` 全字段走原始 JSON 视图（本期不结构化）。
- 后端三契约命令（`launch_tng` / `get_status` / `get_output`）与核心 `prepare_config`/`control_port`/`write_runtime_config` **全部复用，不变**。

## Capabilities

### New Capabilities
<!-- 无新能力；本变更是对既有 gui-shell 能力的扩展。 -->

### Modified Capabilities
- `gui-shell`: 重构 UI 形态——导航栏 + 页面拆分，首页转为纯监视；配置编辑与启停控件移至专用配置页并以结构化控件呈现；新增 JSON 导入导出（原生对话框）与原始 JSON 高级视图；启动从内置默认模板开局（无持久化）。

## Impact

- **前端**：`frontend/` 改为 Vite 工程目录（Vue 3 + Ant Design Vue + 依赖经 pnpm）。`tauri.conf.json` 新增 `build.devUrl`（Vite dev server）与 `beforeDevCommand`，`frontendDist` 指向 `../frontend/dist`。原单文件 `index.html` 被替换。
- **src-tauri（Rust 外壳）**：新增 `tauri-plugin-dialog` 依赖 + 2 个命令（`import_config`：读用户所选文件路径返回 JSON 字符串；`export_config`：把 JSON 写到用户所选 save 路径）+ 对应 capability 授权。`launch_tng`/`get_status`/`get_output` 不变。
- **tngui-core**：复用既有配置收口与进程/状态逻辑，不改。form-spec 作为前端资产维护（不入 core，不链接 tng）。
- **与 tng 的三契约（A/B/C）不变**，松耦合不破。
- **非目标**：多 profile/持久化、RA 全字段结构化、`tng.log` tail、系统代理、metrics 面板——均不在本次范围。