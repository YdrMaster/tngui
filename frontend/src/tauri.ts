// 与 Tauri 后端的 invoke 封装 + 原生对话框（导入/导出取路径）。
import { Channel, invoke } from "@tauri-apps/api/core";
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

/** OpenAI compatible chat message。命令边界只允许 user / assistant。 */
export type InferenceRole = "user" | "assistant";
export interface InferenceMessage {
  role: InferenceRole;
  content: string;
}

/** vLLM 0.26 thinking 强度。 */
export type InferenceEffort = "none" | "low" | "medium" | "high";

/** SSE 增量类型。 */
export type InferenceDeltaKind = "reasoning" | "content";
export interface InferenceDelta {
  kind: InferenceDeltaKind;
  text: string;
}

/** 流式命令结果：completed 为正常完成；stopped 为用户主动取消，不是错误。 */
export type InferenceStreamOutcome = "completed" | "stopped";

/**
 * 通过 tngui 反代对外端点发送流式多轮推理请求（body 恒含 `"stream": true`，由
 * 后端组装）。每节非空 `choices[0].delta.reasoning` / `choices[0].delta.content`
 * 到达即调用 `onDelta`；收到 `data: [DONE]` 后 Promise resolve 为 `completed`。
 * `systemPrompt` 是调试页身份提示词快照；`null` 表示不注入 system role。
 * 任何失败（连接失败、非 2xx、非 SSE、断流等）Promise reject，错误为脱敏诊断
 * 字符串（不含明文凭据）。`requestId` 是 GUI 进程内本轮请求的唯一取消标识。
 */
export async function sendInferenceStream(
  requestId: string,
  port: number,
  model: string,
  apiKey: string,
  messages: InferenceMessage[],
  systemPrompt: string | null,
  reasoningEffort: InferenceEffort,
  onDelta: (delta: InferenceDelta) => void,
): Promise<InferenceStreamOutcome> {
  const channel = new Channel<InferenceDelta>();
  channel.onmessage = onDelta;
  return invoke<InferenceStreamOutcome>("send_inference_stream", {
    requestId,
    port,
    model,
    apiKey,
    messages,
    systemPrompt,
    reasoningEffort,
    onDelta: channel,
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
/** 独立设置缓存 payload；后端只校验信封，不解析 `tng` 字段。 */
export interface SettingsCachePayload {
  schemaVersion: 1;
  tng: {
    configJson: string;
    apiKey: string;
    rvsUrl: string;
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
