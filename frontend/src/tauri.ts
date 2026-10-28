// 与 Tauri 后端的 invoke 封装 + 原生对话框（导入/导出取路径）。
import { Channel, invoke } from "@tauri-apps/api/core";
import type { CacheSaltSettings } from "./cacheSaltConfig";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export interface StatusReport {
  reachable: boolean;
  livez_ok: boolean;
  ready: boolean;
  status_json: unknown;
  ingress_ids?: unknown;
  ingress_keys?: unknown;
  ingress_keys_error?: string | null;
  process_error?: string | null;
  error?: string | null;
}

export async function getStatus(): Promise<StatusReport> {
  return invoke<StatusReport>("get_status");
}

export async function getOutput(): Promise<string[]> {
  return invoke<string[]>("get_output");
}

/** 反代对外端点（按 add_ingress 顺序；未启动返回空）。 */
export interface ProxyEndpoint {
  host: string;
  port: number;
}
export async function proxyEndpoint(): Promise<ProxyEndpoint[]> {
  return invoke<ProxyEndpoint[]>("proxy_endpoint");
}

/** 当前 tngui 反代会话的本地诊断快照；固定类别，不含动态诊断 label。 */
export interface ProxyDiagnostics {
  proxy_running: boolean;
  identity_valid_total: number;
  identity_rejected_total: number;
  payload_rejected_total: number;
  discovery_success_total: number;
  discovery_failure_total: number;
  upstream_failure_total: number;
}
export async function proxyDiagnostics(): Promise<ProxyDiagnostics> {
  return invoke<ProxyDiagnostics>("proxy_diagnostics");
}

/** OpenAI compatible chat message 角色。命令边界允许 user / assistant / tool。 */
export type InferenceRole = "user" | "assistant" | "tool";

/** `tool_calls[].function`：工具名与 JSON 参数串（原样透传）。 */
export interface ToolCallFunction {
  name: string;
  arguments: string;
}

/** OpenAI compatible 工具调用（只出现在 assistant 消息的 tool_calls 中）。 */
export interface ToolCall {
  id: string;
  type: "function";
  function: ToolCallFunction;
}

/**
 * OpenAI compatible chat message。
 *
 * `tool_calls`（assistant 请求的工具调用）与 `tool_call_id`（`role: "tool"` 结果消息
 * 对应的调用 id）是可选字段；纯文本消息不会带上它们。
 */
export interface InferenceMessage {
  role: InferenceRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** vLLM 0.26 thinking 强度。 */
export type InferenceEffort = "none" | "low" | "medium" | "high";

/** SSE 增量类型。 */
export type InferenceDeltaKind = "reasoning" | "content";
export interface InferenceDelta {
  kind: InferenceDeltaKind;
  text: string;
}

/** 工具调用在前端的执行状态。 */
export type ToolStatus = "running" | "ok" | "error" | "cancelled";

/**
 * 密态推理视图的统一流式事件（两种运行模式共用同一个事件流，按 `kind` 分派）。
 * 对话模式只会发出 reasoningDelta / contentDelta / done / error。
 */
export type InferenceEvent =
  | { kind: "turnStart"; turn: number }
  | { kind: "reasoningDelta"; text: string }
  | { kind: "contentDelta"; text: string }
  | { kind: "toolStart"; id: string; name: string; arguments: string }
  | { kind: "toolEnd"; id: string; status: ToolStatus; summary: string }
  | { kind: "notice"; message: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** 流式命令结果：completed 为正常完成；stopped 为用户主动取消，不是错误。 */
export type InferenceStreamOutcome = "completed" | "stopped";

/**
 * Agent 模式命令结果：`stopped` 为 true 时 `messages` 必为空（被停止的运行不进入
 * 后续上下文）；否则 `messages` 是本轮运行新产生的消息（assistant `tool_calls`、
 * `role:"tool"` 结果与最终 assistant `content`），供前端原样并入共享会话。
 */
export interface AgentRunResult {
  stopped: boolean;
  messages: InferenceMessage[];
}

/**
 * 对话模式：通过 tngui 反代对外端点发送流式多轮推理请求（body 恒含 `"stream": true`，
 * 由后端组装）。一次调用恰好发一次请求；每节非空 reasoning / content 增量与终态经
 * 统一 [`InferenceEvent`] 通道推给 `onEvent`。`systemPrompt` 是调试页身份提示词快照；
 * `null` 表示不注入 system role。任何失败（连接失败、非 2xx、非 SSE、断流等）Promise
 * reject，错误为脱敏诊断字符串（不含明文凭据）。`requestId` 是 GUI 进程内本轮请求的
 * 唯一取消标识。
 */
export async function sendInferenceStream(
  requestId: string,
  port: number,
  model: string,
  apiKey: string,
  messages: InferenceMessage[],
  systemPrompt: string | null,
  reasoningEffort: InferenceEffort,
  onEvent: (event: InferenceEvent) => void,
): Promise<InferenceStreamOutcome> {
  const channel = new Channel<InferenceEvent>();
  channel.onmessage = onEvent;
  return invoke<InferenceStreamOutcome>("send_inference_stream", {
    requestId,
    port,
    model,
    apiKey,
    messages,
    systemPrompt,
    reasoningEffort,
    onEvent: channel,
  });
}

/**
 * Agent 模式：一次调用内驱动"模型 ↔ 工具"多轮循环，事件经统一 [`InferenceEvent`] 通道
 * 推送（含 `toolStart` / `toolEnd` / `notice`）。`messages` 是共享会话上下文加上本轮
 * 用户输入原文（最后一条必须是 user）；返回本轮新产生的消息用于并入共享会话。取消复用
 * 同一个 `requestId`。失败 reject 为脱敏诊断字符串。
 */
export async function runAgentMessage(
  requestId: string,
  port: number,
  model: string,
  apiKey: string,
  messages: InferenceMessage[],
  systemPrompt: string | null,
  reasoningEffort: InferenceEffort,
  onEvent: (event: InferenceEvent) => void,
): Promise<AgentRunResult> {
  const channel = new Channel<InferenceEvent>();
  channel.onmessage = onEvent;
  return invoke<AgentRunResult>("run_agent_message", {
    requestId,
    port,
    model,
    apiKey,
    messages,
    systemPrompt,
    reasoningEffort,
    onEvent: channel,
  });
}

/** 按 request_id 请求停止进行中的推理流；无活跃请求时后端返回 false。 */
export function stopInferenceStream(requestId: string): Promise<boolean> {
  return invoke<boolean>("stop_inference_stream", { requestId });
}

/** 从本地 pre-TNG proxy 的 \/v1\/models 获取模型清单。 */
export async function listModels(port: number): Promise<string[]> {
  return invoke<string[]>("list_models", { port });
}

export async function launchTng(configJson: string, rvsUrl: string): Promise<number> {
  return invoke<number>("launch_tng", { configJson, rvsUrl });
}

/** 客户端信息：版本（编译期 CARGO_PKG_VERSION）与操作系统（编译期平台常量）。 */
export interface AppInfo {
  version: string;
  os: string;
}
export async function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

/** 原生"另存为"对话框，返回 TNG 日志目标路径或 null（取消）。 */
export async function pickLogPath(): Promise<string | null> {
  const p = await saveDialog({
    filters: [{ name: "Log", extensions: ["log", "txt"] }],
    defaultPath: "tng-gateway.log",
  });
  return p ?? null;
}

/** 把当前 TNG 进程日志快照写入所选路径。 */
export async function exportTngLog(path: string): Promise<void> {
  return invoke<void>("export_tng_log", { path });
}

/** 原生"打开文件"对话框，返回所选路径或 null（取消）。 */
export async function pickImportPath(): Promise<string | null> {
  const p = await openDialog({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return p ? (p as string) : null;
}

/** 原生"另存为"对话框，返回所选路径或 null（取消）。 */
export async function pickExportPath(): Promise<string | null> {
  const p = await saveDialog({
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return p ?? null;
}

/** 读文件路径，返回 JSON 字符串。 */
export async function importConfig(path: string): Promise<string> {
  return invoke<string>("import_config", { path });
}

/** 把 JSON 字符串写入路径。 */
export async function exportConfig(path: string, json: string): Promise<void> {
  return invoke<void>("export_config", { path, json });
}

/** 原生“另存为”对话框，返回远程证明报告 JSON 目标路径或 null（取消）。 */
export async function pickRemoteAttestationReportPath(): Promise<string | null> {
  const p = await saveDialog({
    filters: [{ name: "JSON", extensions: ["json"] }],
    defaultPath: "remote-attestation-report.json",
  });
  return p ?? null;
}

/** 把当前远程证明 keys 快照以 pretty JSON 写入用户所选路径。 */
export async function exportRemoteAttestationReport(
  path: string,
  report: unknown,
): Promise<void> {
  return exportConfig(path, JSON.stringify(report, null, 2));
}
/** 反代缓存盐配置的下发入参（两个数值以字符串传给后端，由后端规整）。 */
export interface CacheSaltApplyInput {
  mode: string;
  timerEnabled: boolean;
  refreshMinutes: number;
  countEnabled: boolean;
  countThreshold: number;
}

/**
 * 把缓存盐策略推给运行中的反代。改动即时生效，不写盘、不重启 tng，
 * 也不进入 TNG 配置的保存流程；当前盐值不受影响，只重置定时与定量记录。
 */
export async function configureCacheSalt(input: CacheSaltApplyInput): Promise<void> {
  return invoke<void>("configure_cache_salt", {
    mode: input.mode,
    timerEnabled: input.timerEnabled,
    refreshMinutes: String(input.refreshMinutes),
    countEnabled: input.countEnabled,
    countThreshold: String(input.countThreshold),
  });
}

/** 直接改盐值：立即换用该值并重置定时与定量记录。 */
export async function setCacheSaltValue(value: string): Promise<void> {
  return invoke<void>("set_cache_salt_value", { value });
}

/** 读取当前实际使用的盐值；忽略模式返回 null。只读，不影响刷新记录。 */
export async function currentCacheSalt(): Promise<string | null> {
  return invoke<string | null>("current_cache_salt");
}

/** 独立设置缓存 payload；后端只校验信封，不解析 `tng` 字段。 */
export interface SettingsCachePayload {
  schemaVersion: 1;
  tng: {
    configJson: string;
    apiKey: string;
    rvsUrl: string;
    cacheSalt: CacheSaltSettings;
  };
}

/** 启动时读取独立设置缓存；缺失/损坏时后端返回空 object。 */
export async function loadSettingsCache(): Promise<unknown> {
  return invoke<unknown>("load_settings_cache");
}

/** 正常关闭前 flush 当前设置快照。 */
export async function flushSettingsCache(payload: SettingsCachePayload): Promise<void> {
  return invoke<void>("flush_settings_cache", { payload });
}
