## Context

当前结构化端口框全部落在 `a-input-number` 上，依赖 `min=1`、`max=65535`、`precision=0` 与失焦时的裁剪行为。由于 `a-input-number` 样式的输入框在聚焦时允许临时存储非法文本，用户看到的并不是“无法输入非法值”，而是**非法输入先出现，失焦时再跳回 `65535` 或 `1`**。这在 `0`、越界端口和小数端口上尤其反直觉。

已有模型、序列化、导入/回填、启动前和后端校验都已严格阻挡非法端口。这个变更只改进**结构化表单的输入交互**，不处理新增的导入或 JSON 审查规则。

## Goals / Non-Goals

**Goals:**

- 让结构化端口框在键入、粘贴、拖入或选区替换时，都无法进入非法文本。
- 将“非法尝试”和“必填为空”变成可见的红色错误态。
- 保留现有模型语义：必填端口可空，空值由既有校验拒绝；可选端口空值合法。
- 覆盖 `tngui_outward.port`、`mapping.rules[*].out.port`、`http_proxy.dst_filters[*].port`。
- 让输入拦截逻辑可被单元测试和组件测试覆盖，避免依赖 WebView 的不确定行为。

**Non-Goals:**

- 不改变端口取值范围、导入/回填规则、启动前校验或后端校验。
- 不处理非端口字段（e.g. IP、主机名、URL）的同类交互。
- 不增加端口控件自动纠错、默认值回填或自动补全之外的新配置语义。
- 不暴露自动注入的内部监听端口或管控端口。

## Decisions

### 1. 用一个专用的 `PortInput` 组件替换这三处 `a-input-number`

- 建议实现 `frontend/src/components/PortInput.vue`。
- 内部基于 Ant Design Vue 的 `AInput` / `a-input` 渲染文本输入框，而不是继续使用 `a-input-number`。
- 组件统一暴露以下最小接口：
  - `modelValue: number | null`
  - `required?: boolean`
  - `placeholder?: string`
  - `width?: string`
- 这使三个端口字段的校验边界集中在一处，`EntryEditor.vue` 和 `FieldRenderer.vue` 不再各自维护 `min/max/precision`。
- 为什么不用 `a-input-number`：它内部自己处理 `onBeforeInput`、`onInput` 和 `beforeInput`，并且其行为更贴近于**失焦裁剪**而非真正的“拒绝非法输入”。控制层不如直接用文本输入框透明。

### 2. 用“候选文本”在 `beforeinput` 阶段拦截非法值

`PortInput` 内部维护一个受控的 `draftText: string`。所有输入前变化都用一个纯函数计算**候选结果文本**，典型输入类型包括：

- `insertText`
- `insertFromPaste`
- `insertFromDrop`
- `deleteContentBackward`
- `deleteContentForward`
- `replaceText`

候选文本合法才能继续；否则 `preventDefault()`，不改 `draftText`。

合法文本规则采用：

```text
"^\\d{1,5}$" AND 1 <= Number(text) <= 65535
```

精确一点，不用 `0` 起，也不接受前导 `0`：

```text
"^[1-9][0-9]{0,4}$" AND <= 65535
```

例如：

- `1` -> 合法
- `0` -> 非法
- `000` -> 非法
- `65535` -> 合法
- `65536` -> 非法
- `12.5` -> 非法
- `abc` -> 非法

`required` 只影响**错误态**，不影响输入合法性。也就是说，必填字段允许空，因为空值是编辑中的合法中间态；可选字段也允许空。两者都会产生空模型值。被清空的必填框显示红色错误态，直到重新填入合法端口。

### 3. 把候选计算与状态同步拆成可测试的纯逻辑

将候选文本计算函数、合法性判断和状态迁移函数分离到一个纯 TS helper 中。这样 Vitest 可以不依赖真实 DOM 直接测试：

- 追加数字
- 选区替换
- 全选后粘贴
- 复制/粘贴非法串
- 键盘删除导致空值
- 越界追加
- 非数字字符

组件层负责把 DOM 事件转换为 helper 的输入，`PortInput` 本身只做一层薄壳。这样可避免因为要在真实浏览器里手动验证所有路径而降低可测试性。

### 4. 用 Ant Design Vue 的 `status="error"` 呈现错误态

`a-input` 原生支持 `status` prop：

```vue
:status="error ? 'error' : undefined"
```

它底层会应用 `.ant-input-status-error`，直接提供红色边框和聚焦时一致的错误样式。不需要自写边框样式，也不用复用输入框自身的默认错误样式。

Red error state 的来源：

- 用户尝试了非法输入
- 必填端口当前为空

可选端口为空不触发错误态。当用户重新输入合法值后，错误态清除；如果只是试图输入非法值，控件保留原有合法值并在错误态下提示。

### 5. `a-input` 作为渲染层，而不是新建原生控件

- `type="text"`
- `inputmode="numeric"`
- `autocomplete="off"`
- 设置 `maxlength=5`
- 保留 Ant Design Vue 的常规输入框边框、聚焦、错误态样式
- 右上角的数值增减按钮不移植；端口输入不需要数值步进

这样可以避免引入额外 UI 控件或键盘适配问题，同时保持修复在 Vue 组件层内可维护。若未来确实要保留步进按钮，可另行补充专用增加/减少操作。

### 6. 用 `@vue/test-utils` + `happy-dom` 补组件级测试

当前仓库只有 Vitest，尚未装组件测试环境。建议在实现时添加这两个 dev dependency，并仅用于端口输入组件测试：

- `@vue/test-utils`
- `happy-dom`

测试应验证：

- 键入 `0` 不会污染输入框
- 追加越界数字被阻止
- 全选粘贴 `70000` 被阻止
- 小数被阻止
- 必填空值显示错误态
- 可选空值不显示错误态
- 合法端口正常更新模型

### 7. 保留独立的模型与校验层

`PortInput` 只负责输入层。它不会试图替代：

- `formspec.is_valid_port`
- `configmodel.parse`
- `serialize`
- 后端启动校验

这样即使前端输入层被绕过或出现回归，现有配置解析和启动校验仍会拦截非法值，安全边界不变。

## Risks / Trade-offs

- [beforeinput 兼容性] 不是每个 Tauri WebView 版本都完全一致地暴露所有输入类型。→ 使用候选工具函数 + 组件测试，并准备在 `update:value` 或 change 事件层再回退一次，确保非法文本最终不会留存在模型中。
- [失去 InputNumber 步进按钮] 用户可能会习惯通过按钮调整端口。→ 端口输入通常直接使用数字，且当前 UI 只允许 ASCII 数字；不保留步进按钮，用输入框本身的数字 edit 行为解决。
- [新增组件测试依赖] 增加 `@vue/test-utils` 和 `happy-dom` 会扩大 dev dependencies。→ 仅用于 `PortInput` 级测试，不引入 E2E 测试框架。
- [自定义输入框比 InputNumber 更易有字符差异] 输入法、粘贴、选区替换、backspace 处理路径更复杂。→ 与其依赖 InputNumber 内部的 implicit clamp，不如使用显式候选计算函数来控制系统行为，并在组件测试中覆盖主要输入路径。
- [失去前导 ` 0` 的宽松显示] PortInput 直接拒绝前导零，与 `a-input-number` 相比更严格。→ 这是明确的交互选择，可减少 `065535`、`000` 之类困惑；规格把它归为非法输入。

## Migration Plan

1. 引入 `PortInput.vue`，先实现输入候选计算和合法文本规则。
2. 单元测试通过后再替换 `EntryEditor.vue` 中的反代对外端口。
3. 替换 `FieldRenderer.vue` 中的 mapping 远端端口和 http_proxy 目标端口。
4. 补齐组件级错误态测试，确认必填与可选端口语义。
5. 最后进行纯 Vue 层回归：`npm test`、`vue-tsc`，并手动测试 Linux/Windows/macOS WebView 的输入差异——如必要，再增加回退层。

(如实现阶段发现 happy-dom 对某些 `beforeinput` 类型支持不足，可改用更完整的 DOM 测试环境；该替换只影响测试实现，不影响本方案的交互契约。)
