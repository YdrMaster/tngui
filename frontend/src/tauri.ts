// 与 Tauri 后端的 invoke 封装 + 原生对话框（导入/导出取路径）。
import { invoke } from "@tauri-apps/api/core";
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

export async function launchTng(configJson: string): Promise<number> {
  return invoke<number>("launch_tng", { configJson });
}

/** 客户端信息：版本（编译期 CARGO_PKG_VERSION）与操作系统（编译期平台常量）。 */
export interface AppInfo {
  version: string;
  os: string;
}
export async function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
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