# 任务清单

参照 `specs/gui-shell/spec.md`（要做什么）与 `design.md`（怎么做）。决策定调：前端 Vue 3 + Vite + Ant Design Vue 4.x；form-spec 手写；RA 仅 `no_ra`；导入导出经 tauri-plugin-dialog + Rust；不持久化（默认模板开局）；首页纯监视。

> 构建机验证状态（headless，无 WebKitGTK）：
> - 前端：`npm install` ✓、`vite build` + `vue-tsc` 通过 ✓、`vitest` 10/10 ✓。
> - Tauri 侧：`cargo metadata` workspace 全量解析 ✓（含 `tauri-plugin-dialog`）；**Rust 编译 + 原生对话框运行期**须在带 WebKitGTK/WebView2 的机器。
> - 8.x 端到端须在用户机器（带显示 + tng on PATH）。

## 1. 前端工程化（Vite + Vue + AntDV）

- [x] 1.1 把 `frontend/` 改为 Vite 工程：`package.json`（vue3、ant-design-vue 4.x、`@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`vite`、`@vitejs/plugin-vue`、`vue-tsc`、`typescript`）、`vite.config.ts`、`tsconfig.json`、`src/main.ts`、`src/App.vue`、`index.html`。删除原单文件 `index.html`。验证：`npm install` ✓，`npm run build`（vite build）产出 `frontend/dist` ✓。AntDV 4 用 CSS-in-JS → 全局 `app.use(Antd)`（非 unplugin 按需 style，后者在 v4 生成错误路径）。
- [x] 1.2 更新 `tauri.conf.json`：`devUrl=http://localhost:5173`、`beforeDevCommand=npm run dev`（pnpm 未装，用 npm；脚本两通用）、`beforeBuildCommand=npm run build`、`frontendDir=./frontend`、`frontendDist=./frontend/dist`；`withGlobalTauri=false`，前端改用 `@tauri-apps/api/core` 的 `invoke`。验证：`cargo metadata` 解析通过 ✓；运行期开窗留用户机器。

## 2. 导航与首页/配置两视图

- [x] 2.1 `App.vue` 左侧导航（"首页"/"配置"）+ 右侧视图区，`ref` 视图切换。验证：`npm run build` 通过 ✓；点击导航切换视图留用户机器。
- [x] 2.2 `views/Home.vue`：只渲染三态灯 + `/status/` JSON + 输出区，轮询 `get_status`/`get_output`（1.5s）；**已移除**配置 textarea 与启动/重启按钮。验证：Home.vue 无配置输入/启停控件 ✓；`npm run build` 通过 ✓。

## 3. form-spec 与配置模型

- [x] 3.1 `src/formspec.ts`：内置默认 model（port=50000 + 一条 `no_ra` mapping ingress）+ ingress/egress 各模式字段声明与默认值。验证：默认 model `serialize` 产出合法 TNG JSON（外挂 tag + host 127.0.0.1）✓（vitest）。
- [x] 3.2 `serialize(model)` + `parse(json)`（extra 容器原样回填未知字段、非法 JSON/error）；vitest 10/10：默认模板往返、各模式序列化、RA `attest` 往返不丢、top-level extra 往返、非法/缺 port/根非对象报错、host 强制 127.0.0.1 ✓。

## 4. 配置页结构化控件

- [x] 4.1 `views/Config.vue`：AntDV `a-form` 渲染 `control_interface.restful.port`（`a-input-number` 必填；`host` 只读 127.0.0.1）。验证：`npm run build` ✓；port 必填（1..65535）拦截。
- [x] 4.2 ingress/egress 列表（`a-card` 每条 + 增删）：模式选择器（ingress=mapping/http_proxy/socks5/netfilter/hook；egress=mapping/netfilter/hook）；按模式渲染字段（`FieldRenderer` 覆盖 ruleList/filterList/captureList/interceptList/endpoint/stringList/number/text/bool）；每条 `no_ra` 开关。验证：`npm run build` ✓；切换模式字段集变更留用户机器手测。
- [x] 4.3 切换模式弹 `Modal.confirm`；每条 `a-collapse` 折叠"高级"（extra 原始 JSON：ohttp/rats_tls/quic/RA）。验证：`npm run build` ✓。

## 5. 原始 JSON 高级视图

- [x] 5.1 配置页"原始 JSON"tab，显示 `serialize(model)`，切到该 tab 时同步。验证：`npm run build` ✓；表单→JSON 实时同步留用户机器手测。
- [x] 5.2 编辑 JSON→"应用回填"：合法 `parse` 回填；非法 `message.error` 不破坏当前 model。验证：vitest 覆盖 `parse` 路径 ✓；运行期手测回填。

## 6. 导入导出（tauri-plugin-dialog）

- [x] 6.1 `src-tauri` 加 `tauri-plugin-dialog` 依赖；`lib.rs` 注册 `.plugin(tauri_plugin_dialog::init())` + `import_config(path)->Result<String,String>`（读文件）+ `export_config(path,json)->Result<(),String>`（写文件）。验证：`cargo metadata` 解析通过 ✓（含 dialog）；Rust 编译/命令单测留用户机器。
- [x] 6.2 capability 授权 `dialog:default`（`capabilities/default.json`）。前端 `@tauri-apps/plugin-dialog` `open`/`save` 取路径后 invoke 读写命令；取消返回 null 不报错。验证：`npm run build` ✓；运行期原生对话框留用户机器。
- [x] 6.3 配置页"导入 JSON"/"导出 JSON"按钮接入：导入→`parse`→回填表单+JSON，失败显错不改当前配置；导出→`serialize`→写入。验证：vitest 覆盖导入回填（parse）✓；运行期往返手测。

## 7. 启动/重启接线 + 默认开局

- [x] 7.1 配置页"启动/重启"按钮：`invoke('launch_tng', { configJson: serialize(model) })`，成功/失败 `message` 反馈。验证：`npm run build` ✓；复用既有 `launch_tng`（无后端契约改动）。
- [x] 7.2 GUI 进入配置页即 `ref(defaultModel())`（不读本地存储）。验证：代码审查 ✓ + 运行期手测。

## 8. 联调（用户机器：带显示 + tng on PATH）

- [x] 8.1 默认开局→点启动→灯 红→黄→绿，`/status/` 显示 ingress 索引，输出区干净。
- [x] 8.2 切换 ingress 模式、编辑字段、`no_ra` 开关往返正常；原始 JSON 与表单双向同步一致。
- [x] 8.3 导入一份已知 JSON→表单回填正确；导出→再导入往返无丢失（含带 RA `attest` 的配置，`extra` 不丢）。
- [x] 8.4 配置改含非法字段点重启→tng 拒启错误出现在首页日志区→修回转绿；首页确无配置输入与启停控件。