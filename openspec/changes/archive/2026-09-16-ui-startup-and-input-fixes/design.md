## Context

Tauri 主窗口目前配置为 1440×960 且未启动最大化。设置页的 Ant Design Vue 功能卡受到全局 `min-height: 44px` 标题样式影响，内部又有大号 API Key 输入框和较大表单间距。ingress 默认模型当前把 mapping 远端端口设为 10000，http_proxy 远端端口切为 0。前端还没有统一的禁用 WebKit 输入改写属性。workspace 版本已经推进到 `0.4.1`，客户端信息通过编译期 `CARGO_PKG_VERSION` 读取。

## Goals / Non-Goals

**Goals:**

- 主窗口启动即窗口最大化，并保留 1120×720 最小尺寸和 1440×960 还原基准。
- 用局部 CSS 精确调整“密态推理”功能卡，避免影响其他卡片。
- 为 mapping 和 http_proxy 建立模式专属远端默认端口，同时保留显式配置。
- 在相关文本控件上请求 WebKit 关闭自动首字母大写、自动更正和拼写检查。
- 保持发布版本为 `0.4.1`，不引入第二轮版本号编辑。

**Non-Goals:**

- 不改变 TNG 内部注入端口、反代对外端口语义或 OHTTP/RA 序列化契约。
- 不新增持久化窗口状态或记住用户窗口位置。
- 不引入新的 UI 测试框架或版本发布工具。
- 不处理 macOS 系统级输入法配置对非 Web 控件的行为。

## Decisions

- 启动最大化放在 Tauri window 配置中：将主窗口 `maximized` 设为 `true`，保留现有 `width=1440 / height=960` 作为取消最大化后的基准。这比mount后调用命令时序更稳定，也无需新增命令。
- 端口默认值拆成两个常量：`DEFAULT_MAPPING_OUT_PORT = 80`、`DEFAULT_HTTP_PROXY_DST_PORT = 443`。`defaultFields("mapping")` 和 `defaultFields("http_proxy")` 分别使用；导入解析中缺失的对应端口也可使用模式专属默认值。显式数值不被覆盖。
- “密态推理”卡样式由 `feature-card` 作用域承载：将标题区 `min-height` 提高到 66px，并让 head/title 内的图标与文案组合垂直居中；收缩该卡 body/form/form-item 上下额外间距，并把 API Key 输入从 `size="large"` 改为默认尺寸。不修改全局 `.ant-card-head`。
- 文本输入通过 Vue 模板属性直接请求 WebView 行为：`autocapitalize="off"`、`autocorrect="off"`，并在相关控件加 `spellcheck="false"`。这比全局 JS 拦截或改写输入值更安全，不会破坏粘贴或用户主动大写。
- 仅涉及前端文本控件的默认属性；`a-input-number` 等纯数值控件不注入这些属性。

## Risks / Trade-offs

- [macOS 系统级输入辅助与 WebView 行为版本差异] → 在 macOS 构建上人工验证小写首字母、域名占位符、host/domain 和 JSON 编辑器；如 WebView 仍改写，需要再评估 native text-input 属性。
- [Ant Design Vue 可能不透传部分非标准属性到真实 input] → 人工检查渲染后的 `<input>/<textarea>`；必要时在局部包装层或原生属性绑定中补充。
- [局部 UI 像素约束在不同缩放比例下有整数舍入] → 使用不少于 66px 标题高度和不超过 12px 的间距约束作为上下限，允许 1px 舍入。
- [导入 JSON 中端口缺失与显式 0 的区分] → 缺失时使用模式默认值；显式数字仍然原样回填，测试覆盖 missing、0 和非默认显式值。

## Migration Plan

无数据迁移或后端协议变更。工作区版本保持 `0.4.1`，客户端版本继续由 Cargo 元数据派生。发布前只需构建、前端测试/typecheck、Tauri 桌面烟测；如需回滚，按普通 UI/Tauri 配置回滚即可。
