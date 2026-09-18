# Tasks

## 1. 配置模型与 verify 语义

- [x] 1.1 调整 `frontend/src/formspec.ts` 与前端类型：移除 `EntryModel.verify` 与 `verifyFields` 字段类型，确认默认模型/新增 ingress 不再携带可编辑 verify 状态，并通过 `npm test -- --runInBand` 中的配置相关测试验证类型与默认值
- [x] 1.2 调整 `frontend/src/configmodel.ts` 序列化与解析：RA 开启固定输出 `{ model: "passport", as_provider: "tpm" }`， RA 关闭输出 `"no_ra": true`；导入/原始 JSON 的自定义 verify 字段只用于判定 RA 开启并丢弃其值；更新 `configmodel.test.ts` 覆盖 RA 开、RA 关、自定义 verify 标准化
- [x] 1.3 更新 `frontend/src/views/SettingsView.vue` 新增 ingress 的模型构造，确保不再复制 `verify` 并保持 `no_ra=false` 默认 RA 开启；用设置页导入/原始 JSON 回填测试确认序列化结果仍为默认 verify

## 2. Ingress 标题行 UI 简化

- [x] 2.1 修改 `frontend/src/components/EntryEditor.vue`：把远程证明 switch 移到 ingress 卡片标题行；删除内容第三行；Switch 保留「远程证明」可见标签或 `aria-label`；新增/更新组件测试断言标题行包含 switch、内容区不含 verify 输入框
- [x] 2.2 修改 `frontend/src/components/FieldRenderer.vue`：删除 `verifyFields` 渲染分支和两个 textbox 相关逻辑；运行 `cd frontend && npm run typecheck -- --noEmit` 验证无残留类型引用（按项目实际命令调整）
- [x] 2.3 移除设置页 ingress 说明性文字 `（客户端 OHTTP 形态）`；后续 6.2 进一步移除 `add_ingress` 管理层级，入口卡片标题收敛为“入口配置”

## 3. 远端证明报告导出

- [x] 3.1 在 `frontend/src/ingressState.ts` 抽出可复用的 `server_attestation` 非空判断函数，并让 `deriveIngressStates` 与导出可用性共用该判定；更新 `ingressState.test.ts` 覆盖无凭据、有凭据、失败但仍有历史凭据快照三种情况
- [x] 3.2 在 `frontend/src/tauri.ts` 添加远程证明报告专用原生另存为封装，默认路径 `remote-attestation-report.json`、JSON 过滤器，并复用现有 `export_config` 写文件；用单元测试或模拟调用验证返回路径、取消返回 `null` 与 pretty JSON 写入参数
- [x] 3.3 新增共享 icon-only 报告导出组件（如 `RemoteReportExportAction.vue`）：接收当前 `ingress_keys`，根据 `server_attestation` 非空禁用/启用，点击时捕获当前快照、打开另存为、写 pretty JSON、处理取消与失败；组件测试覆盖 disabled、enabled、成功、取消、写失败
- [x] 3.4 为 `frontend/src/components/IngressStateCard.vue` 增加标题右侧 `actions` slot 并保证不影响既有卡片布局；在概览页与设置页的“远端证明”卡挂载共享导出组件，用组件测试确认两个入口均只有图标按钮、可用性一致且不渲染文字
- [x] 3.5 更新 `frontend/src/composables/useIngressState.ts` 暴露当前 `ingress_keys`/报告可用性所需的只读状态或派生值，确保两个页面使用同一次轮询快照；通过现有状态派生测试与页面组件测试验证选中视图导出的 JSON 与状态数据一致

## 4. 文本输入首尾空白规范化

- [x] 4.1 修改 `frontend/src/components/FieldRenderer.vue`、`frontend/src/configmodel.ts` 与 `frontend/src/views/InferenceView.vue`：域名和模型文本输入在进入前端状态 / 请求时统一执行首尾 trim；导入、回填、设置缓存恢复的域名也规范化；纯空白模型归空且可发送门锁不变
- [x] 4.2 新增 / 更新端口外文本输入相关测试：覆盖域名输入 / 粘贴 trim、导入或缓存回填 trim、字符串内部字符保留、模型请求与示例使用 trim 后值、纯空白模型归空、prompt textarea 不被 trim

## 5. 测试、文档与验收

- [x] 5.1 更新 `frontend/src/configmodel.test.ts`、`formspec.test.ts`、ingress UI、域名 / 模型 trim 与导出相关测试，覆盖 spec delta 中所有场景；运行 `cd frontend && npm test`，确保全部现有与新增测试通过
- [x] 5.2 更新 `docs/tngui-ui-guide.md` 中 ingress 布局、verify 固定默认值、域名 / 模型输入 trim、导入行为和远端证明导出说明；检查文档不再描述 verify 输入框或标题说明性文字
- [x] 5.3 运行 `cd frontend && npm run typecheck` 与 `cargo test`，验证前端类型、Rust 回归测试均通过，且没有新增后端命令或 TNG 交互面
- [x] 5.4 人工检查概览页、设置页与密态推理页：RA 开关位于入口卡片标题行、无 verify textbox、设置页无 `add_ingress` 管理层级；域名 / 模型输入 trim 生效；无证明时导出按钮禁用，有证明时可导出 JSON，取消不写文件；完成后在任务摘要中记录观察结果
  验收记录（2026-09-18，已按单一 ingress 追加需求复核）：本环境无 GUI 浏览器/WebView 截图能力，采用 happy-dom 挂载后的页面/组件 DOM 与真实输入、点击事件人工核对。设置页不显示 `add_ingress` 管理层级，当前唯一入口标题行包含远程证明 switch，且无新增/删除 ingress 操作，内容区无 `verify.model` / `verify.as_provider` 文本框；概览与设置页远端证明卡均为 icon-only 导出动作，无 `server_attestation` 时禁用，有非空凭据时可用，成功导出捕获的 keys pretty JSON，取消不触发写文件，失败显示错误；`http_proxy` 域名输入、导入/回填/缓存恢复及序列化均仅扣首尾空白且保留内部字符与大小写，`https://` 仍派生 TLS；推理模型输入、请求 `body.model`、cURL 示例与 Model ID 预览使用 trim 后值，纯空白归空且不影响发送门锁，prompt textarea 原样保留首尾空白。

## 6. 设置页 ingress 与 TNG 配置锁定追加

- [x] 6.1 修改 `frontend/src/views/SettingsView.vue`、`frontend/src/components/EntryEditor.vue` 与 `frontend/src/components/FieldRenderer.vue`：远端类型选项改为“端点映射”/“域名代理”，不显示英文 `mapping` / `http_proxy`；默认选中“域名代理”，默认域名为 `https://inference.cloud.misuan.com`，默认端口为 `443`；RVS 地址默认改为 `https://rvs.tsk.com`，仅在无导入、无回填、无有效缓存时填入，不覆盖显式配置
- [x] 6.2 移除 `add_ingress` 层级与新增 ingress 入口，前端配置状态收敛为单一 ingress；导入、原始 JSON 回填与设置缓存恢复仅保留第一条 ingress，多余条目丢弃并提示；导出/应用时仍序列化为单元素 `add_ingress` 数组，保持 TNG wire format 兼容
- [x] 6.3 在设置页导入/导出 JSON 按钮左侧增加锁定 toggle，默认开启；锁定时禁用 TNG 配置区域全部编辑控件，包括远程证明开关、RVS 地址、远端类型、远端字段、本机绑定、端口和原始 JSON；解锁后全部恢复可交互；导入/导出按钮与报告导出不受锁定影响
- [x] 6.4 更新相关前端测试：覆盖中文远端类型文案、默认选中与默认值、单 ingress 状态、多 ingress 导入丢弃、RVS 默认值与显式值优先、锁定开关默认开启、锁定时配置控件不可交互、解锁后恢复可交互、导入导出不受锁定影响
- [x] 6.5 更新 `docs/tngui-ui-guide.md` 中设置页 ingress 布局、中文远端类型、默认配置、单 ingress 限制、RVS 默认值与锁定 toggle 的行为说明
- [x] 6.6 运行前端完整测试与 typecheck，并执行 Rust 回归测试，更新验收记录
  追加验收记录（2026-09-18）：前端 `npm test` 通过 16 个测试文件、112 个用例；`npm run typecheck` 通过。宿主环境 cargo 测试因既有构建产物要求 GLIBC 2.33/2.34 而无法启动，改在 Ubuntu chroot 执行：主 crate `cargo test` 通过 9 个用例，`cargo test -p tngui-core -- --test-threads=1` 通过 75 个用例（首次并行运行仅因本机端口占用出现 `Address already in use`，单线程复跑全部通过）。设置页复核确认默认锁定开启并覆盖 RA、RVS、远端类型、远端字段、本机绑定、端口与原始 JSON；导入/导出、锁定 toggle 与报告导出不受影响；唯一入口默认域名代理、默认域名 `https://inference.cloud.misuan.com`、端口 `443`，导入多条 ingress 仅保留第一条，显式 RVS 地址优先；锁定状态未写入导出 JSON。
