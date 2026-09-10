## Why

当前概览页把本地控制面可达性展示为"本地访问可用"，并把 XMPP 控制信道当作网关健康卡；远端证明仍是占位。这些表达会让用户误把本地状态或入口配置当作远端业务可达性或 RA 成功。

## What Changes

- 将首页收敛为四卡布局：运行状态、入口信息、远端链路、远端证明。
- 运行状态改为互斥的关停 / 运行 / 错误三态，替代现有"未运行 / 启动中 / 就绪"文案。
- 入口信息只展示入口模式、监听地址、监听端口，明确不表达可达性或健康状态。
- 远端链路依据 TNG 只读状态接口判定未初始化 / 已建联 / 失败，替代 stdout `encrypted=true` 推导。
- 远端证明依据 TNG OHTTP keys 状态和进程日志信号判定未获取 / 已验证 / 待刷新 / 失败，替代静态占位。
- 按指定 HTML 设计稿实现卡片位置、文案、状态点、颜色、布局和状态副标题。
- 保留页面底部的原始状态数据与进程日志调试面板。
- 不新增一站式"远端健康正常"绿灯，不显示本地访问可达或本地访问错误。
- **BREAKING**：概览页移除原"本地网关 / XMPP 控制信道 / 本地访问"三卡、"TNG Gateway 已在本机就绪"主横幅，以及 RA 验证占位卡。

## Capabilities

### New Capabilities
- `ingress-state-home`: 定义 TNG 首页四卡状态模型的可见状态、判定来源、禁用表达和调试面板。

### Modified Capabilities
- `gui-shell`: 更新概览展示契约：状态轮询包含 ingress OHTTP keys；概览从三卡加占位改为四卡模型，并调整状态文案和禁止展示项。

## Impact

- 主要影响 `frontend/src/views/Overview.vue`、首页状态卡展示组件、配置监听信息推导逻辑，以及全局侧栏中的运行状态摘要文案。
- `tngui-core/src/status.rs` 需要扩展读取 `GET /status/ingress/{id}/ohttp/keys`，并通过现有 Tauri 命令返回结构化或原始数据。
- `src/lib.rs` 的 `get_status` 契约需扩展；`tngui-core` 增加解析和失败信号标注逻辑。
- 需要补充前端类型检查/单元测试和 Rust 状态查询测试。
