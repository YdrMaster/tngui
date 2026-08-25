## MODIFIED Requirements

### Requirement: 带配置编辑器与启动控制的 GUI 窗口

系统须（SHALL）渲染带左侧导航栏、含"概览""密态推理""设置"三视图的桌面 GUI 窗口；配置编辑控件位于"设置"视图，启动/停止控件位于"概览"视图；"设置"视图不含启动/停止控件。

#### Scenario: 用户编写配置并启动 tng

- **WHEN** 用户在"设置"视图编辑 TNG 配置后，通过"概览"视图点击启动 OR 在"设置"视图离开时触发自动保存并重启
- **THEN** 系统将该配置写入文件并以该配置文件拉起 `tng launch`

#### Scenario: 重启时先终止既有进程

- **WHEN** GUI 启动的 tng 进程已在运行 AND 用户触发新启动/重启（概览启动按钮 或 设置页 dirty 时自动重启）
- **THEN** 系统在以新配置拉起新进程之前先终止既有 tng 子进程

#### Scenario: 三视图导航切换

- **WHEN** 用户点击导航的"概览"/"密态推理"/"设置"
- **THEN** 右侧视图区切换为对应视图

#### Scenario: 启停控件位于概览

- **WHEN** 用户在概览视图操作启动/停止
- **THEN** 点击启动 = 以当前 TNG 配置写盘并拉起 `tng launch`；点击停止 = 终止 GUI 拉起的 tng 子进程

#### Scenario: 设置视图不含启停控件

- **WHEN** 用户处于设置视图
- **THEN** 该视图不显示启动/重启按钮，仅显示配置编辑控件 + 原始 JSON + 导入导出 + 密态推理 model/API Key 输入框

#### Scenario: 离开设置时按需自动重启

- **WHEN** 用户修改 TNG 配置后从设置视图切换到其他视图 AND tng 正在运行
- **THEN** 系统在切走前写盘并自动重启 tng（kill 旧 + spawn 新）

## REMOVED Requirements

### Requirement: 首页为纯监视视图

该需求被新能力"概览展示进程、连接与 RA 状态并启停 tng"取代：概览视图不再"纯监视"，新增了 启动/停止 按钮 + 进程/配置+连接/RA 验证 三状态块；原"首页不含启停控件"的场景不再成立。

## ADDED Requirements

### Requirement: 概览展示进程、连接与 RA 状态并启停 tng

系统须（SHALL）在"概览"视图展示三状态块：TNG 进程状态（不可达/启动中/就绪三态）、配置与服务端连接状态（基于 tng stdout 是否含 `encrypted=true`）、远程证明（RA）验证状态（UI 占位）；并提供启动/停止 tng 的操作按钮；并展示 tng 进程 stdout/stderr 输出区。概览视图不含 TNG 配置编辑控件、不含密态推理 model/API Key 输入字段。

#### Scenario: 显示进程状态

- **WHEN** tng 处于不同状态
- **THEN** 进程状态块显示三态指示（不可达/启动中/就绪）

#### Scenario: 显示配置+连接状态

- **WHEN** tng stdout 中已出现过 `encrypted=true`
- **THEN** 配置+连接状态块显示"已建立隧道 / 已连接服务端"

- **WHEN** tng stdout 中未出现过 `encrypted=true`
- **THEN** 该块显示"未建立隧道"

#### Scenario: RA 验证状态占位

- **WHEN** 概览视图渲染 RA 验证状态块
- **THEN** 使用静态占位文案（不读取 stdout 中 `attested=` 的真实数据）

#### Scenario: 启停按钮

- **WHEN** 用户在概览视图点击启动/停止按钮
- **THEN** 执行对应的 tng 拉起/终止操作

#### Scenario: 概览不含配置编辑控件

- **WHEN** 用户处于概览视图
- **THEN** 界面不出现 TNG 配置编辑控件/原始 JSON/导入导出/密态推理 model+API Key 输入字段；仅含 启动/停止按钮 + 三状态块 + /status/ JSON + tng stdout/stderr 输出区

### Requirement: 密态推理页面发送并显示推理请求

系统须（SHALL）在密态推理视图提供单次作用的推理请求面板：用户在 prompt textarea 输入（发送后不清空、可改可重发）；发送时按 OpenAI 兼容格式通过 tng 透明代理 POST 到 `http://127.0.0.1:<tng-ingress-端口>/v1/chat/completions`（携带 `Authorization: Bearer <apiKey>` 头、`{model, messages}` body），输出区（只读）显示当次响应的 assistant 回复文本；不保留历史请求。RA 验证过程展示为 UI 占位（不接 stdout 数据）。

#### Scenario: prompt 发送后不清空且可重发

- **WHEN** 用户发送推理请求后
- **THEN** prompt textarea 内容保持不变、可编辑后重新发送；输出区显示本次响应

#### Scenario: 真发送经 tng 透明代理

- **WHEN** 用户点击发送 AND tng 已启动且 TNG 配置至少含一个 ingress
- **THEN** 系统向 `http://127.0.0.1:(配置中第一个 ingress 的 listen 端口)/v1/chat/completions` 发 POST；收到响应后输出区显示 `choices[0].message.content`

#### Scenario: 不保留历史请求

- **WHEN** 用户再次发送推理请求
- **THEN** 输出区覆盖为最新响应；不显示历史请求列表

#### Scenario: RA 过程占位

- **WHEN** 渲染密态推理视图的 RA 过程区域
- **THEN** 仅显示占位 UI，不从 tng stdout 读取 `attested=` 数据

### Requirement: 设置页离开时自动保存并自动重启 tng

系统须（SHALL）在用户从"设置"视图切换到其他视图时检测 TNG 配置是否变化（与最后一次已保存的序列化对比 dirty）；dirty 则写 tng-runtime.json；若 tng 当前正在运行 THEN 自动终止旧进程并拉起新配置下的 tng；未在运行 THEN 仅写盘不 spawn。修改 model/apiKey 不计入 dirty。

#### Scenario: dirty 且 tng 在跑 → 自动重启

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 正在运行
- **THEN** 系统写盘 + kill 旧进程 + spawn 新

#### Scenario: dirty 且 tng 未在跑 → 仅写盘

- **WHEN** 用户改 TNG 配置并切出设置 AND tng 未在运行
- **THEN** 系统只写盘 tng-runtime.json 不 spawn

#### Scenario: 未 dirty → 不动

- **WHEN** 用户切出设置且 TNG 配置未变
- **THEN** 系统不写盘、不重启

#### Scenario: 推理凭据改动不触发 tng 重启

- **WHEN** 用户仅改 model/apiKey 并切出设置
- **THEN** 不触发 TNG 配置 dirty / tng 写盘/重启逻辑

### Requirement: 密态推理凭据只在 GUI 会话内

系统须（SHALL）将密态推理的 model 与 apiKey 作为仅 GUI 会话内的内存态（不写本地存储、不持久化、不入 tng 配置），在设置视图填写后供密态推理视图使用；关闭 GUI 后这两个值不保留。

#### Scenario: 不入 tng-runtime.json

- **WHEN** 保存 TNG 配置时
- **THEN** 写盘的 tng-runtime.json 不含 model 或 apiKey 字段

#### Scenario: 不持久化跨会话

- **WHEN** 用户填写 model/apiKey 并关闭后重新打开 GUI
- **THEN** 设置视图的 model/apiKey 为空

#### Scenario: 推理页只读 model 且不展示明文 apiKey

- **WHEN** 渲染密态推理视图
- **THEN** model 以只读形式显示设置页填写的值；apiKey 不在 UI 上明文展示（发送时作为 Authorization 头使用）

#### Scenario: model+apiKey 变动不影响 tng 进程

- **WHEN** 用户修改 model/apiKey
- **THEN** 不触发 TNG 配置 dirty / tng 进程重启