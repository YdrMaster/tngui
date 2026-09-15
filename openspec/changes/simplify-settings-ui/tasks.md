## 1. 状态视图复用与日志导出后端

- [x] 1.1 新增共享网关状态卡视图推导，输出“运行状态”“远端链路”“远端证明”的标题、状态文本、副标题和颜色枚举；为 stopped/running/error、remoteLink、remoteProof 组合补纯函数单元测试。— verify：`npm test -s` 新增用例通过
- [x] 1.2 重构 `Overview.vue` 消费共享状态卡视图，保持概览第 1、3、4 卡渲染结果不变。— verify：`npm run typecheck` 通过，概览三卡状态仍随状态变化
- [ ] 1.3 在 Tauri 后端新增导出 TNG 进程日志命令：锁取 supervisor 日志快照，lines 为空时导出空内容，否则按原始顺序连接写入指定路径；为日志内容拼接规则加单测。— verify：`cargo test -p tngui-app` 通过
- [x] 1.4 注册该命令，并在 `frontend/src/tauri.ts` 增加日志另存为路径选择和日志导出绑定；取消路径时前端不调用写盘命令。— verify：`npm run typecheck` 通过

## 2. 设置页重构

- [x] 2.1 将设置页 Gateway 摘要替换为共享的三张状态卡，删除“TNG v0.2.1”和“已连接/已断开”摘要；保留“导出日志”入口并改为调用真实命令，取消不写盘、失败提示、成功路径提示。— verify：`npm run typecheck` 通过，设置页状态卡与概览同源
- [x] 2.2 将“密态推理”卡收敛为唯一 API Key 输入：普通文本输入，移除密码遮罩/显隐、保存并验证、复制本地 URL、导入配置、导出配置、清除本机凭据区及相关说明。— verify：模板含且仅含 API Key 输入，`npm run typecheck` 通过
- [x] 2.3 将“高级 TNG 配置”标题改为“TNG 配置”，保留结构化/原始 JSON/导入导出配置能力但不保留手动保存按钮。— verify：模板无“保存”“保存并验证”按钮，`npm run typecheck` 通过
- [x] 2.4 移除设置页“客户端信息”中的更新通道，改为两列展示客户端版本和操作系统，仍从 `app_info()` 获取。— verify：模板无“更新通道/稳定版(OTA)”，`npm run typecheck` 通过

## 3. 自动保存与推理表单

- [x] 3.1 调整导航离开设置流程：未变化静默返回；保存成功/重启成功不弹提示；写盘、保存或重启失败分别给出明确错误并正确维护“已保存”快照状态。— verify：`npm run typecheck` 通过，成功无 toast、失败有错误 toast
- [x] 3.2 将密态推理 prompt textarea 改为 auto-size（4–16 行）并禁用 resize，移除旧固定 rows。— verify：模板/样式命中 `auto-size`、`resize:none`，`npm run typecheck` 通过
- [x] 3.3 对齐“发送测试请求”按钮图标与文字，并删除按钮下方蓝色锁形提示框。— verify：按钮使用居中 flex 排版，模板无对应 alert，`npm run typecheck` 通过

## 4. 文档与回归

- [x] 4.1 更新 `docs/tngui-ui-guide.md`：设置页 Gateway 三卡、导出日志、密态推理卡、TNG 配置自动保存、客户端信息和传感器提示框的最新描述。— verify：文档与 delta spec 一致
- [ ] 4.2 运行前端与后端回归：`npm run typecheck`、`npm test -s`、`cargo fmt --check --all`、`cargo test -p tngui-app` 全绿。— verify：全部命令退出码 0
- [x] 4.3 校验 OpenSpec 提案完整性。— verify：`openspec validate simplify-settings-ui --json` 通过
