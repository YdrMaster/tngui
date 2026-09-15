## ADDED Requirements

### Requirement: 设置页网关状态卡与概览同源

系统须（SHALL）在设置页 TNG Gateway 区域展示与概览视图第 1、3、4 张状态卡相同的“运行状态”“远端链路”“远端证明”三张卡。三张卡的状态判定、状态文本、副标题和颜色语义须（SHALL）与概览对应卡完全同源；设置页绝不（MUST NOT）另行使用独立的就绪判定、展示“控制信道已连接/已断开”摘要，或展示 TNG 版本概要。设置页 Gateway 区域不展示概览第 2 张“入口信息”卡，也不因此新增配置编辑控件。

#### Scenario: 设置页三卡与概览一致

- **WHEN** 概览与设置页在同一个 TNG 状态快照下渲染
- **THEN** 设置页显示“运行状态”“远端链路”“远端证明”三张卡，且每张卡的标题、状态文本、副标题和颜色语义分别与概览第 1、3、4 张卡一致

#### Scenario: 不显示独立连接摘要

- **WHEN** 渲染设置页 TNG Gateway 区域
- **THEN** 界面不出现“已连接/已断开”控制信道摘要、硬编码 TNG 版本摘要或“入口信息”卡

#### Scenario: 状态变化同步呈现

- **WHEN** TNG 的运行、远端链路或远端证明状态变化
- **THEN** 设置页对应状态卡与概览在同一次状态快照轮询后呈现相同结果

### Requirement: 导出 TNG 进程日志

系统须（SHALL）在设置页提供“导出日志”功能：点击后弹出原生“另存为”对话框；用户选择目标路径后，系统把概览“进程日志”所展示的当前 TNG 子进程 stdout/stderr 快照写入该路径。日志内容须（SHALL）与概览“进程日志”同源，按日志原始顺序连接；没有日志时写入空日志内容。用户取消对话框时绝不（MUST NOT）创建或覆盖目标文件。写入失败时须（SHALL）明确提示错误；导出日志不修改 TNG 进程、TNG 配置或调试面板内容。

#### Scenario: 选择路径后保存进程日志

- **WHEN** 用户点击“导出日志”并在原生另存为对话框选择路径
- **THEN** 系统把当前概览“进程日志”的 stdout/stderr 行按原始顺序写入所选路径

#### Scenario: 无日志时导出空文件

- **WHEN** TNG 尚无 stdout/stderr 日志且用户选择导出路径
- **THEN** 目标文件被写入空日志内容，界面不伪造“（暂无输出）”占位文本

#### Scenario: 用户取消导出

- **WHEN** 用户在原生另存为对话框中取消
- **THEN** 系统不创建、不覆盖目标文件，也不提示导出成功

#### Scenario: 保存失败可见

- **WHEN** 目标路径不可写或保存命令失败
- **THEN** 设置页显示导出错误，原始日志内容不变

## MODIFIED Requirements

### Requirement: 密态推理页面发送并显示推理请求

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板：用户在 prompt textarea 输入（发送后不清空、可改可重发）。prompt textarea 须（SHALL）按其内容自动调整高度，最小 4 行且最高 16 行；达到最大高度后内容在框内滚动；用户无法通过拖拽调整其尺寸。“发送测试请求”按钮内的图标与文字须（SHALL）垂直居中；该按钮下方不得遗留单独的蓝色锁形提示框。面板的“可发”门锁只认两个条件——概览“运行状态”卡显示“运行”（即与概览左上角卡片相同的 `deriveIngressStates().runtime === "running"` 判定：控制面 reachable、`/livez` 与 `/readyz` 均 2xx、无 attestation/hpke 结构性失败日志、无进程错误）AND 本机已配置 api-key；满足即显示请求面板，否则显示“当前无法发送测试请求”占位。发送时按 OpenAI 兼容格式 POST 到 tngui 反向代理对外端点 `http://<反代 bind host>:<对外 port>/v1/chat/completions`（携带 `Authorization: Bearer <apiKey>` 头、`{model, messages}` body）；`x-model` 头由 tngui 反代从 body 解析注入（见“tngui 反向代理对外暴露推理入口并注入 x-model 头”），而非前端或发送逻辑注入。模型名 `model` 由用户在本面板内可编辑输入提供（会话内内存、不持久化、不入 tng 配置、不触发 tng 进程重启），不在“设置”视图配置、亦不作为可发门锁条件。输出区（只读）显示当次响应的 assistant 回复文本；不保留历史请求。RA 验证过程展示为 UI 占位（不接 stdout 数据）。

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: prompt 按内容自动伸缩

- **WHEN** 用户在 prompt textarea 中增删内容
- **THEN** textarea 高度随内容自动增高或收缩，最小 4 行、最大 16 行；达到最大高度后内容滚动，且拖拽角不能改变其高度

#### Scenario: 发送按钮图标垂直居中且无遗留提示框

- **WHEN** 渲染可交互的“发送测试请求”按钮
- **THEN** 按钮内图标与文字垂直居中；按钮下方不出现单独的蓝色锁形提示框

#### Scenario: 可发判定仅认概览运行态与 api-key

- **WHEN** 渲染密态推理视图的请求面板
- **THEN** 面板在且仅在概览“运行状态”卡显示“运行”（`deriveIngressStates().runtime === "running"`，与概览左上角同一判定，复用同一状态推导）AND api-key 已配置时可用；其余一律显示“当前无法发送测试请求”占位；`model` 是否填写、`readyz` 是否单列、反代对外端口是否独立判定，均不再作为可发门锁条件

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND 概览显示“运行” AND api-key 已配置
- **THEN** 系统向 tngui 反代对外端点（`http://<反代 bind host>:<对外 port>/v1/chat/completions`）发 POST，不直连 tng 内部 ingress 端口；反代按 body.model 注入 `x-model` 后转发至 tng 透明代理（ingress）；收到响应后输出区显示 `choices[0].message.content`

#### Scenario: model 在推理页可编辑且不持久化

- **WHEN** 用户在推理请求面板编辑模型名 `model`
- **THEN** 该 `model` 作为 body.model 经反代注入 `x-model`；`model` 为会话内内存，关闭 GUI 不保留、不写入 tng-runtime.json、不触发 TNG 配置 dirty 或 tng 进程重启

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应；不显示历史请求列表

#### Scenario: 失败响应框展示脱敏请求与响应调试内容

- **WHEN** 密态推理发送失败且失败发生在请求已构建之后（连接失败、读响应失败、非 2xx、响应非 JSON 或响应缺少 content）
- **THEN** 响应框显示失败摘要，并显示本次发出的请求文本与收到的响应原文；请求中的 `Authorization` 值必须脱敏，响应正文按 Content-Length/EOF 或解码后的 chunked 内容展示
- **WHEN** 请求在建立连接/读取响应阶段没有收到任何 HTTP 响应
- **THEN** 响应框仍显示失败摘要、脱敏请求，以及明确的“无 HTTP 响应”诊断；失败详情只在本次响应框展示，不保留历史

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据

### Requirement: 设置页离开时自动保存并自动重启 tng

系统须（SHALL）在用户从“设置”视图切换到其他视图时检测 TNG 配置是否变化（与最后一次已保存的序列化对比 dirty）；dirty 则写 tng-runtime.json；若 tng 当前正在运行 THEN 自动终止旧进程并拉起新配置下的 tng；未在运行 THEN 仅写盘不 spawn。设置视图不得（MUST NOT）提供 TNG 配置保存按钮；自动保存成功或配置未变化时绝不（MUST NOT）弹出成功、提示或确认弹窗，保存失败仍必须给出明确错误提示。修改 apiKey 不计入 dirty（模型名 `model` 现于“密态推理”视图编辑，不在“设置”视图，本身不构成设置页 dirty 因素）。

#### Scenario: dirty 且 tng 在跑 → 自动重启

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 正在运行
- **THEN** 系统写盘 + kill 旧进程 + spawn 新，成功后不弹保存成功提示

#### Scenario: dirty 且 tng 未在跑 → 仅写盘

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 未在运行
- **THEN** 系统只写盘 tng-runtime.json 不 spawn，成功后不弹保存成功提示

#### Scenario: 未 dirty → 不动

- **WHEN** 用户切出设置且 TNG 配置未变
- **THEN** 系统不写盘、不重启，也不显示“配置未变”或保存成功提示

#### Scenario: 保存失败仍可见

- **WHEN** 用户改 TNG 配置并切出设置 AND 配置保存或自动重启失败
- **THEN** 系统显示明确错误提示，不声称保存成功

#### Scenario: 不提供保存按钮

- **WHEN** 渲染设置视图的 TNG 配置区域
- **THEN** 界面不存在“保存”“保存并验证”等 TNG 配置保存按钮；该区域标题为“TNG 配置”

#### Scenario: 推理凭据改动不触发 tng 重启

- **WHEN** 用户仅改 apiKey 并切出设置，或仅改“密态推理”视图的 model
- **THEN** 不触发 TNG 配置 dirty / tng 写盘/重启逻辑

### Requirement: 密态推理凭据只在 GUI 会话内

系统须（SHALL）将密态推理的 apiKey 与 model 作为仅 GUI 会话内的内存态（不写本地存储、不持久化、不入 tng 配置）：apiKey 在“设置”视图填写；model 在“密态推理”视图的请求面板内可编辑填写（不再于“设置”视图配置、亦非只读）；二者供密态推理视图发送使用；关闭 GUI 后这两个值不保留。设置页“密态推理”卡 SHALL 只保留一个普通文本输入框形式的 API Key 输入，不得（MUST NOT）做密码式遮罩、显隐切换、复制本地 URL、保存并验证，或在该卡内提供配置导入/导出、清除本机凭据、中心侧管理说明等额外控件与说明。

#### Scenario: 不入 tng-runtime.json

- **WHEN** 保存 TNG 配置时
- **THEN** 写盘的 tng-runtime.json 不含 model 或 apiKey 字段

#### Scenario: 不持久化跨会话

- **WHEN** 用户填写 model/apiKey 并关闭后重新打开 GUI
- **THEN** “设置”视图的 apiKey 与“密态推理”视图的 model 均为空

#### Scenario: 设置页 API Key 为普通文本框

- **WHEN** 渲染设置页“密态推理”卡
- **THEN** 仅出现一个 API Key 输入框，其文本可见、不使用密码遮罩且无显隐切换；界面不出现保存并验证、复制本地 URL、配置导入/导出、清除本机凭据或中心侧凭据说明

#### Scenario: 推理页只读 model 且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以可编辑输入呈现于请求面板（会话内内存、发送时作为 body.model）；apiKey 不在“密态推理”视图 UI 上明文展示（明文输入只出现在“设置”视图），发送时仅作为 Authorization 头使用

#### Scenario: model+apiKey 变动不影响 tng 进程

- **WHEN** 用户修改 model（在“密态推理”视图）或 apiKey（在“设置”视图）
- **THEN** 不触发 TNG 配置 dirty / tng 进程重启

### Requirement: 设置页客户端信息展示编译期版本与操作系统

系统须（SHALL）在设置页“客户端信息”中以编译期变量驱动“客户端版本”与“操作系统”两项，不得写硬编码业务字面量：客户端版本取自编译期 `CARGO_PKG_VERSION`（`tngui-app` crate 版本）；操作系统取自编译期平台常量，并以平台友好名展示（windows→Windows、macos→macOS、linux→Linux；可附带架构）。该两项经系统对外命令暴露给前端，前端在渲染“客户端信息”时取自该命令返回值而非硬编码字面量。客户端信息 SHALL 只包含“客户端版本”和“操作系统”两项，绝不（MUST NOT）展示“更新通道”“稳定版(OTA)”或其他渠道字段。

#### Scenario: 客户端版本取自编译期变量

- **WHEN** 渲染“客户端信息”的“客户端版本”
- **THEN** 展示值等于编译期 `CARGO_PKG_VERSION`（当前 `tngui-app` workspace 版本），非任何硬编码字面量

#### Scenario: 操作系统取自编译期平台常量

- **WHEN** 渲染“客户端信息”的“操作系统”
- **THEN** 展示值由编译期平台常量经友好名映射得到（windows→Windows、macos→macOS、linux→Linux），非 `Desktop` 等写死字面量

#### Scenario: 不展示更新通道

- **WHEN** 渲染设置页“客户端信息”
- **THEN** 客户端信息恰好包含“客户端版本”和“操作系统”两项，不出现“更新通道”或“稳定版(OTA)”

#### Scenario: 跨平台构建值正确

- **WHEN** 在 Windows/Linux/macOS 任一平台编译并运行相应构建产物
- **THEN** 该产物“客户端版本”一致（同一 `CARGO_PKG_VERSION`），“操作系统”反映其编译期平台
