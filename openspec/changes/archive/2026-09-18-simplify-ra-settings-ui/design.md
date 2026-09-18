# Design

## Context

现有前端配置模型仍保留 `add_ingress` 数组与多 ingress 编辑能力，设置页 ingress 编辑器也暴露低频的 `verify.model` / `verify.as_provider` 字段。客户端实际场景只需要一条 ingress，且这些技术命名与多入口层级会加重配置负担。当前 `EntryModel` 保存 `verify` 并由 `EntryEditor` 渲染两个输入框；导入/原始 JSON 解析会把自定义 verify 字段写回模型，形成隐藏状态。远端类型选项仍显示英文 `mapping` / `http_proxy`，默认配置偏底层。

远端证明状态由 `useIngressState` 轮询 Tauri `get_status` 得到。`StatusReport.ingress_keys` 已保存当前首个 ingress 的 `/status/ingress/{id}/ohttp/keys` 快照，`deriveIngressStates` 内部根据 `servers[*].server_attestation` 判断证明凭据是否存在。设置页与概览页各自渲染共享的 `IngressStateCard`，但尚无统一的报告导出入口。配置区缺少锁定状态，容易在浏览或误操作时改变高风险 TNG 参数。

用户期望叠加两类简化：
1. 把设置页 ingress 配置简化为“单一入口 + 中文文案 + 默认化”
2. 加一个显式锁定开关，默认启用，防止配置被意外改动

这仍属于 UI / 前端状态管理简化，不改变 TNG wire format 或后端服务契约。

## Goals / Non-Goals

**Goals:**

- 只保留一条 ingress，去掉 `add_ingress` 层级和新增入口操作。
- 远端类型选项显示为中文：
  - `端点映射`
  - `域名代理`
- 默认选中 `域名代理`，并预填常用推理域名与端口。
- RVS 地址默认填写 `https://rvs.tsk.com`，且受同一锁定开关控制。
- 在设置页导入/导出按钮旁加入锁定 toggle，默认开启。
- 锁定时禁用 TNG 配置区域所有编辑控件，包括 RA 开关、RVS 地址、远端字段、本机绑定和原始 JSON 编辑。
- 解锁后恢复可编辑。
- 导入/导出按钮、锁定 toggle 与状态卡导出不受锁定影响。
- 移除 `verify.model` / `verify.as_provider` 输入框，RA 开启时固定输出默认 verify。
- 域名与推理模型输入统一首尾 trim。
- 概览与设置页共用同一个远端证明报告导出入口。

**Non-Goals:**

- 不改变 TNG 配置 JSON 的 `add_ingress` 数组结构。
- 不禁止一条 ingress 内部的字段编辑，仅限制 ingress 数量为 1。
- 不新增后端命令或外部服务依赖。
- 不把锁定状态写入 TNG JSON 或持久化设置缓存。
- 不改变 tng 启停流程、状态四态判定、report export 语义。
- 不对 prompt textarea、API Key、RVS 地址或端口输入应用 trim。
- 不改变 `server_attestation` 报告内容的解析或重排。

## Decisions

1. **单一 ingress 状态模型**

   - 前端配置状态只保留一条 ingress，不再维护多 ingress 数组。
   - `SettingView`、`EntryEditor`、`FieldRenderer` 按单 ingress 模型渲染。
   - 导入、原始 JSON 回填或设置缓存恢复时，只保留第一条 ingress。
   - 如果输入中不存在可识别的 `mapping` / `http_proxy` 条目，回退到默认单 ingress 配置。
   - 序列化时仍将配置包装成单元素 `add_ingress` 数组，从而保持 TNG wire format 兼容。

   这样既能简化 UI 和状态管理，又避免破坏现有 TNG 解析与导出功能。

2. **中文远端类型文案与默认值**

   - UI 层面的远端类型选项只显示：
     - `端点映射`
     - `域名代理`
   - 移除界面上的英文 `mapping` / `http_proxy` 标识。
   - 默认选中 `域名代理`。
   - 默认域名为 `https://inference.cloud.misuan.com`。
   - 默认远端端口为 `443`。
   - 用户导入或恢复已有配置时，显式值优先，不做静默覆盖。

   这样可以把底层技术形态保留在实现层，同时让 UI 更贴近业务语义。

3. **RVS 默认值与统一锁定**

   - RVS 地址默认值改为 `https://rvs.tsk.com`。
   - 仅在缺少导入值、回填值或有效缓存值时填入默认值。
   - 不覆盖用户显式配置。
   - RVS 地址作为 TNG 配置的一部分，受同一个锁定 toggle 控制。
   - 不为 RVS 单独引入第二个锁定状态。

   这样可以保持配置锁定语义统一，避免用户误解 RVS 是否可编辑。

4. **配置锁定 toggle**

   - 在设置页“导入配置”与“导出配置”按钮左侧放置锁定 toggle。
   - 默认开启锁定。
   - 锁定开启时，以下控件全部不可交互：
     - 远程证明开关
     - RVS 地址
     - 远端类型选择
     - 远端字段
     - 本机绑定
     - 端口输入
     - 原始 JSON 编辑
   - 锁定关闭后，上述控件恢复可编辑。
   - 导入、导出按钮和锁定 toggle 本身不受锁定影响。
   - 状态卡和远程证明报告导出不属于配置编辑控件，不受锁定影响。
   - 锁定状态仅保留在当前 UI 会话或本地界面状态中，不写入 TNG JSON，也不进入设置缓存。

   这样可在浏览配置时避免误操作，同时不影响导入导出与排障能力。

5. **verify 从可配置状态降级为固定序列化值**

   - 从 `EntryModel` 移除 `verify` 字段。
   - `serialize` 在 RA 开启（`no_ra=false`）时固定输出 `DEFAULT_VERIFY`。
   - `parse` 只把 `verify` 存在与否作为 RA 开启信号，丢弃其字段值。
   - 结构化 UI 不再暴露 `verify.model` / `verify.as_provider` 输入框。
   - 导入或回填带自定义 verify 字段的配置时，下一次序列化统一回到默认值。

   这既降低配置复杂度，也消除隐藏状态。

6. **远程证明开关位置**

   - 将 RA 开关移动到“入口配置”卡片标题行，不提供 ingress 删除动作。
   - 内容区只保留两行：
     1. 本机绑定 / 端口
     2. 远端类型与远端字段
   - 内容区不再出现独立的远程证明/verify 行。
   - 设置页不显示 `add_ingress` 管理层级或说明性文字。

7. **报告导出组件与交互**

   - 新增共享的 icon-only 导出按钮。
   - 组件接收当前 `ingress_keys` 快照。
   - 仅当任一 `server_attestation` 非空时可用。
   - 点击时捕获当前快照、打开原生另存为对话框、写入 pretty JSON。
   - 概览页与设置页复用同一组件与同一快照来源，避免状态漂移。
   - 取消导出时不写文件，失败时显示明确错误。

8. **文本输入首尾 trim**

   - `http_proxy` 域名输入在状态写入和序列化边界仅去除首尾空白。
   - 密态推理模型输入在状态写入和请求边界仅去除首尾空白。
   - 保留字符串内部字符与大小写。
   - 不对 prompt textarea、API Key、RVS 地址或端口输入应用 trim。
   - 导入、回填或缓存恢复得到的域名也统一 trim，避免隐藏空白状态。

9. **导入导出与锁定解耦**

   - 导入/导出按钮放在锁定 toggle 旁，但不被锁定禁用。
   - 导入或回填操作改变配置内容后，配置区仍按当前锁定状态控制可编辑性。
   - 多余 ingress 在导入或回填阶段被丢弃，不进入前端状态。
   - 锁定状态不参与 JSON 序列化。

## Risks / Trade-offs

- [兼容性] 只支持单 ingress 会降低灵活性 → 这是明确的 UI 简化取舍；客户端当前业务场景只需要一条入口。
- [数据丢失] 导入多条 ingress 时仅保留第一条 → 需在导入提示中明确告知，避免用户误解。
- [误操作] 锁定默认开启可能导致用户想编辑时先解除锁定 → 这是显式安全语义，符合高风险配置界面的防误操作设计。
- [可发现性] icon-only 报告导出按钮不如文字直观 → 通过 tooltip、aria-label 和一致位置补偿。
- [状态复杂度] 单 ingress 与 TNG wire format 不一致 → 前端状态模型保持单对象，序列化边界转换为单元素数组，避免泄漏到 UI。
- [配置恢复] 默认值可能覆盖用户已有 RVS 地址 → 仅在无显式配置或无有效缓存时使用默认值，确保不覆盖用户配置。

## Migration Plan

1. 调整配置状态模型为单 ingress。
2. 调整设置页与 ingress 编辑器为单 ingress 渲染，去掉 `add_ingress` 层级和新增按钮。
3. 更新远端类型中文文案与默认值，并调整 RVS 默认值。
4. 引入锁定 toggle，并确保锁定状态覆盖 TNG 配置区域所有编辑控件。
5. 保持导入、导出、报告导出与状态卡不受锁定影响。
6. 移除 verify 输入框并将 verify 序列化固定为默认值。
7. 在域名与模型输入上应用首尾 trim，并同步导入/回填/缓存恢复边界。
8. 更新测试与文档，覆盖单 ingress、默认值、锁定状态、RA、导出、导入导出与 trim。
9. 回滚时恢复前端状态模型、UI 与测试即可，无需数据迁移，旧配置仍可读取。
