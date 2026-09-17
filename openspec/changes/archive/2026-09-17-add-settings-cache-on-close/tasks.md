## 0. 版本与依赖

- [x] 0.1 将 workspace 与 frontend 包版本统一为 0.4.2；用 `grep`/.package 字段与 `cargo metadata` 验证
- [x] 0.2 更新 npm 与 Cargo 兼容依赖（不主动跨 major），运行 `npm install` 且测试通过验证

## 1. 后端设置缓存

- [x] 1.1 在 `src/lib.rs` 新增 `settings-cache.json` 的读写辅助：临时文件 + 原子替换、Unix owner-only 权限、缺失时返回空缓存；为正常写入、覆盖写入、损坏 JSON 返回空缓存添加 Rust 单测
- [x] 1.2 新增 `flush_settings_cache` 与 `load_settings_cache` Tauri 命令：只接受 schemaVersion 1 的顶层 JSON object，写入/返回原始 payload，不解析 API Key 内容；为非法顶层/schema 添加 Rust 单测或错误断言
- [x] 1.3 确认缓存错误路径不输出 TNG 配置或 API Key；用代码审查 + 断言错误字符串不含 payload 验证

## 2. 前端快照与恢复

- [x] 2.1 在 `frontend/src/tauri.ts` 暴露 load/flush 设置缓存命令类型；运行 `npm run typecheck` 验证
- [x] 2.2 新增 `settingsCache` 纯函数模块：生成 `{schemaVersion, tng:{configJson, apiKey}}` 快照并排除未应用 raw 文本；实现 schema 检查、`parse()` 回填、端口校验、API Key 必须为 string；为有效、损坏、未知 schema、非法端口、API Key 独立回退添加 Vitest
- [x] 2.3 在应用启动时调用 load、校验后初始化 `useTngConfig` 与 `useInferenceConfig`，并把 dirty 基线设为恢复后的序列化结果；GUI 等 bootstrap 完成后再渲染视图；用 Vitest/组件测试覆盖恢复成功和回退默认
- [x] 2.4 拦截正常关闭请求，先调用快照和 `flush_settings_cache`，成功后继续关闭；为“不缓存未应用 raw 草稿”与“flush payload 不含 model/prompt”添加测试

## 3. 行为边界与集成

- [x] 3.1 验证恢复缓存后不调用 `launch_tng`，控制端口不进入缓存 payload；用前端测试或 spy 断言
- [x] 3.2 验证切出设置的自动保存/自动重启逻辑不变，API Key 修改仍不触发 tng 重启；运行现有相关测试并补充边界测试
- [x] 3.3 校验 `flush` 失败不阻塞关闭、缺失/损坏缓存回退默认且 API Key 为空；添加集成或组件测试

## 4. 全量验证

- [ ] 4.1 运行 `npm run test`、`npm run typecheck`，以及 `cargo fmt --check` / `cargo test`
- [ ] 4.2 手动冒烟：填写合理配置与 API Key → 正常关闭 → 重开恢复设置且 tng 未运行；再分别把缓存改为损坏 JSON、非法端口、非字符串 API Key，重启后验证对应字段回退而 GUI 可用
- [x] 4.3 运行 `openspec validate --strict` 并归档前复核 delta spec 覆盖 flush、恢复、默认回退与 raw 草稿排除
