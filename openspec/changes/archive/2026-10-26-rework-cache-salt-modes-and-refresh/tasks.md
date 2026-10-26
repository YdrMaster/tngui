# Tasks

## 1. 核心盐策略

- [x] 1.1 把 `tngui-core/src/cache_salt.rs` 的 `CacheSaltMode` 换成 `Ignore / Add / Overwrite`，`CacheSaltPolicy` 改成模式加两条刷新参数（定时开关与周期、定量开关与阈值），删掉 `fixed_value` 与 `overwrite`；`CacheSaltMode::parse` 只认新枚举、其余回落 `Add`。验证：`source ~/.cargo/env && cargo test -p tngui-core -- --test-threads=1` 通过，且模式解析测试覆盖 `ignore/add/overwrite` 与非法输入回落。
- [x] 1.2 在 `CacheSaltHandle` 里实现三态注入决定与轮换计量：忽略返回 `None`，添加返回 `overwrite: false`，覆盖返回 `overwrite: true`；`current_at` 依次判定定时到点、定量到数，任一命中就换新盐并把 `generated_at` 与 `requests_since_reset` 一起重置，未命中则计入当前请求。验证：单测覆盖"周期内盐不变、跨周期换盐"、"已转发数达到阈值后的下一个请求换盐"、以及规格里 30 分钟配 50 请求、第 51 个请求先刷新的例子。
- [x] 1.3 加只读访问器 `peek_current`，只抄当前值，不轮换也不计数。验证：单测断言连续多次 `peek_current` 得到同一盐、`requests_since_reset` 不变，且 `peek_current` 在忽略模式返回 `None`。

## 2. 反代注入路径

- [x] 2.1 更新 `tngui-core/src/proxy.rs` 的注入调用点与注释，让忽略模式（`current()` 返回 `None`）直接跳过改写。验证：反代单测断言忽略模式下含盐或不含盐的请求体都按原字节转发。
- [x] 2.2 让 `inject_cache_salt` 与新决定结构对齐：添加模式只在缺字段时插入，覆盖模式在已有字段时就地替换其字符串值，两条路径都保留其余字节与字段顺序。验证：`cargo test -p tngui-core -- --test-threads=1` 全绿，且覆盖已有盐、插入缺失盐、值转义、嵌套同名字段不被误伤这几条断言仍存在。

## 3. 宿主命令

- [x] 3.1 收敛 `src/lib.rs` 的 `configure_cache_salt` 入参与 `cache_salt_policy`，只接收模式与两条刷新参数；同步改 `frontend/src/tauri.ts` 的 `CacheSaltApplyInput`，去掉盐值与覆盖标志。验证：`source ~/.cargo/env && cargo test -p tngui-app -- --test-threads=1` 通过，命令测试断言改参数只重置基线、不换当前盐。
- [x] 3.2 新增 `set_cache_salt_value(value)` 与 `current_cache_salt()` 两条命令：前者换当前盐并重置定时与计数，后者返回当前实际盐、忽略模式返回 `None`。验证：命令测试断言设置值后读到新盐、忽略模式读到 `None`，且连续调用 `current_cache_salt` 不推进定量计数。

## 4. 前端配置与缓存

- [x] 4.1 改造 `frontend/src/cacheSaltConfig.ts`：`CacheSaltMode` 改为 `ignore / add / overwrite`，`CacheSaltSettings` 改为模式 + 定时开关与周期 + 定量开关与阈值，默认添加、定时开 30 分钟、定量关；`restoredCacheSalt` 逐字段校验回落，旧缓存的 `fixedValue`/`overwrite` 与旧模式串一律当作缺失。验证：`cd frontend && npx vitest run src/cacheSaltConfig.test.ts` 覆盖默认值、非法字段回落、旧缓存字段被忽略。
- [x] 4.2 让 `frontend/src/composables/useCacheSaltConfig.ts` 与 `frontend/src/tauri.ts` 接上新命令：配置改动走 `configure_cache_salt`，直接改盐走 `set_cache_salt_value`，回填走 `current_cache_salt`；共享状态里不再保存盐值。验证：相关 composable 测试断言改动路径调用正确命令，且配置对象里没有盐值字段。

## 5. 设置页控件

- [x] 5.1 把盐模式换成三选一（忽略 / 添加 / 覆盖），删掉"覆盖已有 cache_salt"开关；模式为忽略时隐藏下方全部盐配置控件，添加与覆盖显示同一组控件。验证：组件测试断言忽略模式看不到输入框、生成按钮与两行刷新设置，且添加与覆盖的控件集一致。
- [x] 5.2 落地添加与覆盖模式的控件：盐值输入框配"生成随机值"按钮，下面依次是定时刷新行（开关 + 分钟数 + "分钟"）和定量刷新行（开关 + 阈值 + 单位），两行的单位标签与输入框垂直居中对齐、用正常字号与正常前景色。验证：组件测试断言默认值（定时开、30 分钟、定量关）与控件存在性；人工看一眼设置页确认两行单位标签没有偏上或偏下、颜色不是低对比度灰。
- [x] 5.3 实现焦点门控与失焦对账：输入框未聚焦时把草稿跟当前盐同步（设置页可见期间轮询 `current_cache_salt`），聚焦期间不写回但后台照常换盐；失焦时拉一次当前盐比对——草稿非空且不同就当作直接刷新提交，为空或相同就把草稿改回当前盐；"生成随机值"填草稿并立即提交。验证：组件测试覆盖四个分支（有变化提交、为空回填、相同回填、编辑期间后台换盐不回填），并断言空串不会被提交成盐值。

## 6. 文档与集成验证

- [x] 6.1 更新 `docs/tngui-doc-boundaries.md` 的"本地边界要点"缓存盐条目：模式改为忽略 / 添加 / 覆盖，刷新含定时与定量两条渠道，盐值不落盘、只进请求体。验证：通读该条目，确认不再出现"关闭/固定/自动"与"覆盖开关"，且与 `openspec/specs/gui-shell/spec.md` 的最终措辞一致。
- [x] 6.2 跑通格式与静态检查：`source ~/.cargo/env && cargo fmt --all && cargo fmt --all --check`、`cargo clippy --workspace --all-targets`（宿主只能到 `tngui-core`，`tngui-app` 相关项在 chroot 里跑）与 `cd frontend && npm run build`。验证：三条命令都不报错；clippy 若有告警须是仓库里既有的、与本次改动无关的项。
- [x] 6.3 跑全量回归：宿主 `source ~/.cargo/env && cargo test -p tngui-core -- --test-threads=1`、`cd frontend && npm test`；`tngui-app` 测试按 `docs/ant-codespace-testing.md` 在 Ubuntu chroot 内跑 `cargo test --workspace -- --test-threads=1`。验证：全部用例通过，且测试数量不低于改动前。

## Workflow follow-up

- 评审通过后归档本变更，把 delta 合入 `openspec/specs/gui-shell/spec.md`。
- 归档后复核主规格：确认旧的"盐模式三态与覆盖开关""设置页密态推理卡提供盐配置项""无盐请求不被拒绝或降级"已被移除，且反代与设置缓存条目引用的是新要求名。
