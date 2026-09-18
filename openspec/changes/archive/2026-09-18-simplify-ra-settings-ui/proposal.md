# 简化设置页 ingress 配置与 TNG 配置锁定

## Why

设置页 ingress 编辑器仍暴露低频的 `verify.model` / `verify.as_provider` 字段，并且 `add_ingress` 层级、远端类型英文命名与多 ingress 编辑能力让配置面显得偏底层。客户端场景实际只需要一条 ingress，且 TNG 配置属于高风险配置，缺少一个显式锁定态来避免误操作。远端证明报告在获取后也缺少便捷的本地留档入口。

## What Changes

- 简化设置页 ingress 编辑器：
  - 移除 `verify.model` / `verify.as_provider` 两个 textbox。
  - 打开某条 ingress 的远程证明开关时，固定使用现有默认值 `verify.model=passport`、`verify.as_provider=tpm`。
  - 该开关移到 ingress 卡片标题行，删除原来单独的远程证明/verify 行。
  - 打开 RA 时固定序列化为 `verify = { model: "passport", as_provider: "tpm" }`；关闭 RA 时序列化为 `"no_ra": true`。
  - 导入 JSON、原始 JSON 回填或既有设置缓存中的自定义 verify 字段统一重置为默认值。
  - 设置页不显示 `add_ingress` 管理层级或说明性文字，入口卡片仅以“入口配置”标识当前唯一 ingress。
- 远端类型选项文案与默认值调整：
  - “地址端口”改为“端点映射”。
  - “域名”改为“域名代理”。
  - UI 不再显示英文 `mapping` / `http_proxy`。
  - 默认选中“域名代理”。
  - 默认域名为 `https://inference.cloud.misuan.com`。
  - 默认远端端口为 `443`。
- 单一 ingress 配置：
  - 去除 `add_ingress` 层级和新增 ingress 操作。
  - 前端状态只保留一条 ingress。
  - 导入 JSON、原始 JSON 回填或设置缓存恢复时，仅保留第一条 ingress，多余条目被丢弃并给出提示。
  - 序列化仍保持 TNG 兼容的 `add_ingress` 数组，但只输出一个元素。
- 域名与模型文本输入首尾 trim：
  - `http_proxy` ingress 的域名 / 主机名输入框去掉首尾空白后进入配置模型与序列化结果。
  - 导入、原始 JSON 回填或设置缓存恢复的域名也按同一规则规范化。
  - 密态推理请求面板的模型输入框去掉首尾空白后用于请求 `body.model`、curl 示例与 Model ID 预览。
  - 仅去除首尾空白，不删除字符串内部字符、不改变大小写，也不影响 prompt textarea、API Key、RVS 地址或端口输入。
- 设置页 TNG 配置锁定：
  - 在“导入配置”与“导出配置”按钮左侧增加锁定 toggle。
  - 锁定默认开启。
  - 锁定时，TNG 配置区域内所有编辑控件不可交互，包括远程证明开关、RVS 地址、远端类型、远端字段、本机绑定、端口和原始 JSON 编辑。
  - 锁定关闭后，上述配置控件恢复可编辑。
  - 导入、导出按钮和锁定 toggle 本身不受锁定影响。
- RVS 地址默认值与锁定：
  - RVS 地址默认填写 `https://rvs.tsk.com`。
  - 仅在缺少导入值、回填值或有效缓存时使用默认值，不覆盖用户显式配置。
  - RVS 地址属于 TNG 配置，受同一个锁定 toggle 控制。
- 远端证明报告导出：
  - 在概览页与设置页的“远端证明”卡右侧添加图标-only 导出按钮。
  - 按钮渲染为报告/文档图标，不显示“导出报告”文字；可通过 tooltip/aria-label 提示用途。
  - 仅当当前 OHTTP keys 快照中任一 `server_attestation` 非空时可点击。
  - 点击后弹出原生另存为对话框，默认文件名 `remote-attestation-report.json`，保存当前 keys JSON 快照。
  - 两处入口共用同一构件与同一快照，取消时不写文件，失败时显示明确错误。

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `gui-shell`:
  - ingress 结构化编辑器布局
  - 远端类型文案与默认值
  - 单一 ingress 配置
  - verify 固定默认值
  - 设置页 ingress 标题文案
  - 域名与推理模型输入首尾空白规范化
  - 设置页 TNG 配置锁定
  - 设置页远端证明卡导出动作
- `ingress-state-home`:
  - 概览远端证明卡增加基于校验凭据是否存在的报告导出入口

## Impact

- 前端：
  - `frontend/src/components/EntryEditor.vue`
  - `frontend/src/components/FieldRenderer.vue`
  - `frontend/src/components/IngressStateCard.vue`
  - `frontend/src/views/SettingsView.vue`
  - `frontend/src/views/Overview.vue`
  - `frontend/src/views/InferenceView.vue`
  - `frontend/src/configmodel.ts`
  - `frontend/src/formspec.ts`
  - `frontend/src/ingressState.ts`
  - `frontend/src/composables/useIngressState.ts`
  - `frontend/src/tauri.ts`
- 测试：
  - 配置模型序列化、导入回填与设置缓存
  - ingress 标题行布局与单一 ingress 行为
  - 远端类型文案与默认值
  - 域名/模型输入 trim
  - 证明报告导出可用性、导出流程与取消行为
  - TNG 配置锁定状态与控件可用性
- 文档：
  - 更新设置页 ingress 布局、默认值、单一 ingress、锁定 toggle、verify 固定默认值、域名/模型 trim 与远端证明导出说明
- 不改变：
  - TNG RA/普通版二进制选择
  - TNG 配置 JSON 的 `add_ingress` wire format
  - tng 启停流程
  - 状态卡四态语义
  - 不新增后端命令或外部依赖
