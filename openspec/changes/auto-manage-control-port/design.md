## Context

动机见 `proposal.md`（Why），行为契约见 `specs/gui-shell/spec.md` delta。这里只讲如何落地。

当前控制端口的来源链横跨前后端：

```
frontend ConfigModel.control_interface.restful (默认 50000)
  └─ SettingsView: restful.host(只读 127.0.0.1) + restful.port(可编辑) + 状态卡只读 "127.0.0.1:<port>"
     └─ configmodel.serialize() -> config_json（含 control_interface.restful）
        └─ backend prepare_config(): 强制 host=127.0.0.1；缺 port -> NoRestfulPort
           └─ control_port() 读出 -> write_runtime_config -> supervisor.launch
              └─ PortCell <- port；get_status -> fetch_status(port) 轮询 127.0.0.1:<port>
```

关键约束：`status.rs::fetch_status(port)` 与控制面 `GET /livez|/readyz|/status/` 已是纯端口入参、仅回环、无鉴权——本变更不改它，只改"端口由谁产生"。松耦合契约（仅 A 拉起 `tng` CLI、B 只读 GET、C 捕获 stdout/stderr）继续成立。

## Goals / Non-Goals

**Goals:**
- tngui 端到端自有 `control_interface.restful`（`host=127.0.0.1` + 自动空闲回环端口）：前端不产生、不显示、不往返该端口。
- 端口在拉起 tng 的链路里单一产生（backend），并沿用既有 `PortCell → fetch_status(port)` 作为轮询唯一来源。
- 保留未结构化字段往返（`control_interface` 的同级如 `ttrpc`、顶层 `extra`、各 ingress/egress 的 RA 等）与 `deny_unknown_fields` 语义。

**Non-Goals:**
- 不改 tng 本身：tng 仍从 `tng-runtime.json` 读 `control_interface.restful.host/port` 后自行 bind；tngui 只是注入它。
- 不触及推理用的本地透明代理端口（`send_inference` 的 `port` / 前端 `localPort`）——那是 tng ingress 的 listen 端口，与管控面 port 无关。
- `control_interface` 的同级 `ttrpc` 等 advanced 字段维持现状（仍走原始 JSON / `extra` 往返），本变更不"藏"它们。
- 不跨启动持久化/复用同一端口：每次启动都现取一个空闲回环端口。

## Decisions

**1. 端口选取方式：tngui 侧 ephemeral bind 探测（`127.0.0.1:0` → 读 local_addr.port → 关掉 → 返回）。**
- 为何：兑现 MVP `design.md` 当初留的备选；零新增 tng 依赖；与现 tng 完全兼容（tng 已能 bind 我们注入的具体端口）。
- 备选：令 `port=0` 交给 tng 由 OS 分配、tng 把实际端口打到 stdout、tngui 解析 stdout 发现端口。否决（已核实，针对 tng 2.9.2）：(a) tng 确接受 `port:0`——`tng/src/config/mod.rs:55-59` 的 `Endpoint.port: u16`；(b) 但 tng 不输出实际绑定端口——`tng/src/control_interface/restful.rs:79-83` 的 `tracing::info!("Restful Control interface listening", port=addr.1)` 只打**请求端口**（传 0 即 `port=0`），bind 后的 `listener.local_addr().port()` 全代码从不读/输出（grep `local_addr`/`bound` 无命中），`serve()` 的 ready 信号也不带端口，故 read-back 读到的只会是 `0`；(c) tng 自身测试用 `testutil::pick_unused_port()` 探测空端口后传具体值，印证探测法是该场景的自然做法；(d) 要启用 read-back 得改外部 tng，超出 tngui 范围且违背松耦合/独立升级原则，且跨 tng 版本解析日志依旧脆。

**2. 端口在哪取：`src/lib.rs::launch_tng` 开头取一次，再注入。** 端口是运行期/backend 概念，绝不回传前端（因此无法被 UI 暴露）。取到的端口经修改后的 `prepare_config` 注入配置、写盘、并写入 `PortCell` 供 `fetch_status` 轮询——沿用唯一真源。

**3. `prepare_config` 拆分，使"保存/导出的配置"不含 `control_interface.restful`：**
- `validate_user_config(json) -> Result<Value, PrepareError>`：仅解析 + 根对象校验，不要求 restful/port。供 `save_config`（持久化用户侧配置，不注入端口，避免把端口写进用户可见的保存/导出文件）。
- `prepare_config(json, port) -> Result<Value, PrepareError>`：在 `validate` 基础上构建/覆盖 `control_interface.restful = { "host":"127.0.0.1", "port" }`（缺则建 control_interface/restful 对象；保留 `control_interface` 同级与其余 restful 键）。删除 `NoRestfulPort`（端口恒注入）。
- 备选：让 `save_config` 也注入一个端口。否决：会把一个（可能已失效、且对用户可见的）端口焙进用户可见的保存文件，违背"不暴露"。

**4. 前端模型去掉 `control_interface.restful`：**
- `ConfigModel` 改为保留 `control_interface` 的同级 `extra`（如 `ttrpc`）作 `control_interface_extra`，不再有 `restful`。
- `serialize()` 输出 `control_interface = {...control_interface_extra}`（无 restful）；`parse()` 导入/回填时丢弃 `control_interface.restful`（host/port），保留同级与其它未结构化字段。
- `defaultModel()` 去掉 restful，仍保留一条 `no_ra` mapping ingress 示例。
- `SettingsView.vue` 删除 `control_interface（host 强制 127.0.0.1）` 卡片；并删除 TNG Gateway 状态卡里只读的 `127.0.0.1:<port>` "控制面监听"端口文字（保留运行/已连接指示灯）。
- 理由：管控端口的每个用户可见面（可编辑控件 + 只读展示）都移除，才真正"不暴露"。

**5. 状态轮询不动：** `fetch_status(port)` 本就端口入参；`get_status` 读 `PortCell`（现值为 tngui 选取端口）。`status.rs` 无需改动。

## Risks / Trade-offs

- **[选取端口的 TOCTOU]** 关掉探测 socket 到 tng 真正 bind 之间，该端口可能被他人抢占 → tng bind 失败 → 状态卡显示"关停/错误"。→ 缓解：loopback 窗口极小；tng spawn 后若状态持续不可达，已有 stdout/stderr 捕获可暴露 bind 错误；未来加固=检测不可达后重取端口重试（与 tng 自身 testutil 同法，loopback 窗口极小）。tasks 中列为可选。
- **[纯保存后的 tng-runtime.json 不再可直接 `tng launch`]** `save_config` 持久化的用户侧配置没 `control_interface.restful`，单独拿去 `tng launch` 会因缺端口被 tng 拒。→ 缓解/原因：tngui 绝不从"仅保存"出的文件直接拉起；每次启动都走 `launch_tng` 路径重取+注入。设置页离开的自动重启也走该路径（注入）。
- **[向后兼容 / 手写配置]** 手写 `control_interface.restful.port` 期望被采用的旧用户会发现它被覆盖/忽略。→ 这是预期的 BREAKING；spec delta 的 REMOVED Migration 与 ui-guide 更新已说明。旧导出 JSON 若含 restful，导入时被丢弃、其余保留。
- **[移除只读端口展示的取舍]** 个别用户曾据状态卡的端口做本地诊断（如 curl 控制面）。→ 非目标权衡；控制面仍仅回环，高级用户仍可用 OS 工具找到端口自行探测，但 tngui 不再代为展示。若诊断诉求增长，可另开"高级/诊断"入口显式呈现（见 Open Questions）。

## Migration Plan

1. backend 先行：`tngui-core/src/config.rs` 加 `pick_free_port()`、拆 `prepare_config`/`validate_user_config`、删 `NoRestfulPort`；`src/lib.rs` 的 `launch_tng`/`save_config` 改调用；更新并新增单测。
2. frontend：`formspec.ts` `ConfigModel` 去 `restful`；`configmodel.ts` `serialize/parse` 去 restful、导入丢弃 restful；`SettingsView.vue` 删卡片 + 状态卡端口文字；`defaultModel()` 去 restful；更新 `configmodel.test.ts`。
3. 文档：`docs/tngui-ui-guide.md` 中"`restful.port` 可编辑"等描述同步更新。
4. 无持久化数据迁移：配置不跨会话持久化；端口是运行期态。旧保存/导出 JSON 导入无碍（restful 丢弃、其余保留）。

## Open Questions

- 是否需要为支持/诊断留一个"高级/诊断"视图显式展示运行中的控制端点？当前选择完全不显示。该问题不改当前 spec/方法/tasks，可日后单独决定。
- 未来加固方向：检测到控制面持续不可达后"重取端口重试"，是否值得做（不改当前 spec，可在实现期再定）。（已排除：tng `port=0`+stdout 发现实际端口在 tng 2.9.2 不可行——见决策 1，除非独立改 tng。）
