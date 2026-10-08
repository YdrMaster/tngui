# Tasks

## 1. 文档审查基线

- [x] 1.1 逐节盘点 `README.md`、`docs/ant-codespace-testing.md` 与 `docs/tngui-ui-guide.md`，标注本地实现细节、跨组件语义和学习价值；交付一份审查记录，确认没有误改 Ant Codespace、分发、测试平台与 UI 交互内容。验证方式：核对提案中的“需要保留的 tngui 本地细节”清单。
- [x] 1.2 建立关键词清单并全量搜索 `body.model`、`model-a`、`provider/model`、`/v1/models`、`x-model`、`capi`、`path_rewrites`、OHTTP、RA、可信、远程证明，确认每处若是本地行为才保留；若为跨组件权威，改为中心文档名称/`unresolved`。验证方式：关键词检查结果中不再出现旧组件契约声明。

## 2. README 与本地文档冲突修正

- [x] 2.1 收敛 README 开头定位：保留 tngui 是桌面 GUI、client-side `pre-tng-proxy` 与 `tng-ingress` 特化；把模型路径、授权、OHTTP 与 RA 中心语义指向 `trust-inference` 中心文档名称，不复制正文、不绑定 adjacent 路径。验证方式：README 只剩本地行为和引用，不含中心契约裁决。
- [x] 2.2 修正 README 的模型 path 描述：明确从顶层 `body.model` 精确保留模型字符串、生成单一 URI path segment 并 percent-encode，保留 body/query/credential header；`x-model` 不作为模型身份。验证方式：README 示例覆盖普通 ID 与 `provider/model`。
- [x] 2.3 修正 `GET /v1/models` 描述为 tngui 本地模型发现例外和本地 UI 能力；明确中心裁决、`capi origin` 安全来源和绕过链路问题标为 unresolved，不新增授权或注册语义。验证方式：README 中该例外没有任何“全局模型目录/路由权威”表述。
- [x] 2.4 更新 `docs/tngui-ui-guide.md` 的模型选择、模型 list、请求体生成和 model path 生成文字；保留多轮对话、SSE、诊断、进程内状态、模型下拉和 API Key 本地说明。验证方式：文档示例与 OpenSpec 场景一致。
- [x] 2.5 修正 `docs/tngui-ui-guide.md` 中 OHTTP key、RA 状态、`server_public_key`、`server_attestation` 的表述：只描述本地只读快照、保守日志信号和导出行为；不得声明认证、route、rotation 裁决或远端健康裁决。验证方式：状态卡章节包含能力边界说明。
- [x] 2.6 修正 `docs/tngui-ui-guide.md` 中旧 RA/RATS-TLS 口径：保留安全机制 UI 文案，但与本地 OpenSpec 的 OHTTP/HPKE 和 RA-TLS 语义一致；具体信任角色标注为中心远程证明契约，不写入 `..` 依赖链接。验证方式：不再出现 `RATS-TLS 段 1` 的旧口径。
- [x] 2.7 保留 Ant Codespace、双套 TNG 分发、配置锁定、RVS 注入、端口注入、状态卡布局、报告导出和测试限制等本地内容；只删除与中心契约重复或冲突的句子。验证方式：逐节 diff 确认非目标细节未丢失。

## 3. OpenSpec 语义收敛

- [x] 3.1 应用 `specs/gui-shell/spec.md` delta，更新反代模型路径要求：不为 `body.model` trim，精确保留字符串并 percent-encode 成单一 path segment；保留 400/413、body/query/header 保留、非模型 path 和流程场景。验证方式：delta 与原始 requirement 相比未丢失无关场景。
- [x] 3.2 应用 `specs/gui-shell/spec.md` delta，更新模型发现例外为 tngui 本地能力，不声明全局模型注册、授权或路由；移除旧 requirement 标题/旁引中的 `x-model` 注入说法。验证方式：`gui-shell` delta 中 `x-model` 只表示不被用作模型身份。
- [x] 3.3 应用 `specs/ingress-state-home/spec.md` delta，把远端链路和远端证明状态卡限定为本地快照观测；保留状态互斥、色点、导出、禁止本地可达性误读和禁止一站式远端健康表达。验证方式：新增边界语句和既有场景同时存在。
- [x] 3.4 检查 OpenSpec 中 “capi path 模型鉴权契约” 之类的措辞；如保留，只作为 tngui 配置锁定的本地行为说明，不写成 tngui 定义授权或注册。验证方式：grep 无第二套权威表述。
- [x] 3.5 确认 `frontend-build` 不被修改，`gui-shell` 与 `ingress-state-home` 的 path 与现有 capability 完全一致。验证方式：`openspec list --specs` 显示的 capability 路径与 delta 路径一致。

## 4. 链接与边界验证

- [x] 4.1 检查新增中心契约引用只用中心文档稳定名称，不在 README/docs/OpenSpec 绑定长期 `..` 路径；在当前 checkout 中临时定位 `trust-inference/docs`（实际路径当前可为 `../docs`）核对对应源文件，且不修改这些源。
- [x] 4.2 运行 `git diff --check`，确认没有尾随空白或冲突标记；检查 `git diff --name-only` 只包含允许的本地文档、OpenSpec specs 与本变更 planning artifacts。验证方式：命令输出与 scope 清单一致性。
- [x] 4.3 确认没有新增历史版本页、迁移说明页、以 `..` 为前提的文档运行依赖或对 `trust-inference`/其他子模块的写操作；不运行 component 构建、测试或提交。验证方式：review `git status`、变更文件清单与链接。

## 5. 最终本地校验

- [x] 5.1 运行 `openspec validate tngui-stage1-doc-contract-alignment --type change --strict`，确认所有 delta requirement/scenario 可解析。验证方式：命令退出码为 0。
- [x] 5.2 运行 `openspec status --change tngui-stage1-doc-contract-alignment`，确认 proposal、specs、design 与 tasks 均完成；不执行 archive、commit 或 apply。验证方式：状态输出不显示缺失 artifacts。
