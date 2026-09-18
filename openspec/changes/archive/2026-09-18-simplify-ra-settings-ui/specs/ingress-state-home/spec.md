# Spec Delta

## ADDED Requirements

### Requirement: 远端证明报告导出

系统须（SHALL）在概览“远端证明”卡片标题右侧提供图标-only 导出报告动作：按钮显示报告/文档图标且不渲染“导出报告”文字，可提供 tooltip 或 accessible label；仅当前 ingress OHTTP keys 快照中任一 `server_attestation` 为非空值时该动作可点击。用户点击后系统须（SHALL）弹出原生“另存为”对话框（默认文件名 `remote-attestation-report.json`），并在用户选择目标路径后将当前 `/status/ingress/{id}/ohttp/keys` JSON 快照写入该路径。用户取消对话框时绝不（MUST NOT）创建或覆盖目标文件；导出失败时须（SHALL）给出明确错误提示；导出动作不得改变 TNG 进程、TNG 配置或状态卡数据。

#### Scenario: 无证明报告时禁用

- **WHEN** 当前 ingress OHTTP keys 快照没有非空 `server_attestation`
- **THEN** “远端证明”卡右侧导出动作不可点击

#### Scenario: 有证明报告时可导出

- **WHEN** 当前 ingress OHTTP keys 快照中任一 server 的 `server_attestation` 非空
- **THEN** “远端证明”卡右侧导出动作可点击，即使状态卡显示“待刷新”或因后续错误进入“失败”

#### Scenario: 保存证明报告

- **WHEN** 用户点击可用的导出动作并在原生“另存为”对话框选择目标路径
- **THEN** 系统把当前 ingress OHTTP keys JSON 快照 pretty JSON 写入所选路径

#### Scenario: 取消导出不写文件

- **WHEN** 用户点击可用的导出动作后在原生“另存为”对话框取消
- **THEN** 系统不创建、不覆盖目标文件，也不提示导出成功

#### Scenario: 保存失败可见

- **WHEN** 用户选择导出路径但写入失败
- **THEN** 界面显示明确的导出失败错误，且不修改状态卡或 TNG 进程
