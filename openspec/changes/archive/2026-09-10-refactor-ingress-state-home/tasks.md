## 1. 状态数据契约

- [x] 1.1 扩展 `tngui-core/src/status.rs`：在探针和 `/status/` 后发现 ingress id，并读取 `/status/ingress/{id}/ohttp/keys`；为空数组、缺失路由、非 JSON、超时和失败响应补充保守处理。验证：`cargo test -p tngui-core`，桩服务覆盖成功、空 keys 和失败响应。
- [x] 1.2 扩展 `StatusReport` 增加 `ingress_ids`、`ingress_keys`、`ingress_keys_error`，并按设计补充可选进程异常信号字段。验证：Rust 序列化测试和前端类型编译通过。
- [x] 1.3 保持 `get_status` 单命令契约与松耦合只读约束。验证：`cargo test -p tngui-core` 与 `cargo clippy -p tngui-core -- -D warnings` 通过。

## 2. 状态映射与类型

- [x] 2.1 新增前端状态枚举 `runtime: stopped | running | error`、`remote-link: uninit | established | failed`、`remote-proof: not-obtained | verified | refresh-due | failed`。验证：TypeScript 编译通过。
- [x] 2.2 实现纯函数 `deriveIngressStates()`，输入探针结果、keys 快照、keys 错误和保守进程/服务失败信号，输出三个互斥状态。验证：Vitest 覆盖 keys 空、缺公钥、有公钥、有凭据、keys 错误和失败信号。
- [x] 2.3 为失败日志匹配建立保守信号识别，只接受结构性错误事件；确认 `attested=false`、普通 info/debug 和“未校验”不触发失败。验证：Vitest 正反向用例通过。
- [x] 2.4 保留“待刷新”枚举与映射分支；暂无可信接近过期信号时不得将 JWT `exp` 直接作为依据。验证：Vitest 包含待刷新映射用例或显式未激活测试。

## 3. 首页 UI

- [x] 3.1 按 HTML 设计稿重建 `Overview.vue` 四卡布局：运行状态、入口信息、远端链路、远端证明，桌面四列并支持窄容器两列。验证：前端 build 通过，DOM 顺序与设计稿一致。
- [x] 3.2 实现状态卡色点、文案、副标题和 `ok / warn / err / neutral` 视觉；入口信息卡不使用状态色或状态点。验证：Vue 模板测试或组件快照覆盖每个状态值。
- [x] 3.3 从共享配置第一个 ingress 提取入口模式、监听地址和监听端口；无法确定时显示 `——`。验证：Vitest 覆盖 mapping、http_proxy/socks5 和缺字段情况。
- [x] 3.4 移除旧三卡、“TNG Gateway 已在本机就绪”主横幅、XMPP 表达、本地访问可达/错误表达和 RA 占位。验证：grep/组件测试确认相关文案不再出现在 Overview。
- [x] 3.5 保留并规范底部“原始状态数据”和“进程日志”面板。验证：`npm run build` 通过，轮询更新保持只读展示。
- [x] 3.6 更新 `App.vue` 侧栏运行摘要，复用运行状态判定并移除 XMPP 表达。验证：前端 build 通过，摘要文案与运行状态卡一致。

## 4. 验证与对照

- [x] 4.1 运行 `npm test`、`npm run build`、`cargo test -p tngui-core` 和 `cargo clippy -p tngui-core -- -D warnings`。验证：全部通过。
- [x] 4.2 对照 `tngui-ingress-state-preview.html` 检查卡片位置、文案、颜色、状态图例和信息结构。验证：人工检查清单记录一致。
- [x] 4.3 用空配置、运行中无 keys、有 keys 无凭据、keys 请求失败和日志失败信号五类状态检查 UI。验证：集成或手动验收记录每类状态映射正确。
- [x] 4.4 确认页面没有“远端健康正常”一站式绿灯，也没有本地访问可达/错误表达。验证：人工验收和文案断言通过。
