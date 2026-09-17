// 设置页跨会话缓存：只快照“已提交”的结构化模型、API Key 与 RVS 地址。
// 未应用原始 JSON 文本、推理 model/prompt 绝不在这里出现。
import { parse } from "./configmodel";
import { DEFAULT_RVS_URL, defaultModel, type ConfigModel } from "./formspec";
import type { SettingsCachePayload } from "./tauri";

export interface SettingsState {
  config: ConfigModel;
  apiKey: string;
  rvsUrl: string;
}

function restoredRvsUrl(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : DEFAULT_RVS_URL;
}

export function buildSettingsCacheSnapshot(
  configJson: string,
  apiKey: string,
  rvsUrl: string,
): SettingsCachePayload {
  return {
    schemaVersion: 1,
    tng: {
      configJson,
      apiKey,
      rvsUrl,
    },
  };
}

/** 语义校验并恢复设置。TNG 配置与 API Key 独立判断，一个非法不阻止另一个恢复。 */
export function parseSettingsCache(payload: unknown): SettingsState {
  const envelope = payload as {
    schemaVersion?: unknown;
    tng?: { configJson?: unknown; apiKey?: unknown; rvsUrl?: unknown };
  } | null;
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.schemaVersion !== 1
  ) {
    return { config: defaultModel(), apiKey: "", rvsUrl: DEFAULT_RVS_URL };
  }

  const cachedTng = envelope.tng;
  const configJson = typeof cachedTng?.configJson === "string" ? cachedTng.configJson : "";
  const parsedConfig = configJson ? parse(configJson) : { error: "missing" };
  const apiKey = typeof cachedTng?.apiKey === "string" ? cachedTng.apiKey : "";
  const rvsUrl = restoredRvsUrl(cachedTng?.rvsUrl);
  if (parsedConfig.error) {
    return { config: defaultModel(), apiKey, rvsUrl: DEFAULT_RVS_URL };
  }
  const config = parsedConfig.model!;
  config.rvsUrl = rvsUrl;
  return { config, apiKey, rvsUrl };
}

/** 把已校验的缓存应用到 GUI 共享状态；dirty 基线以恢复后的模型为准。 */
export function applySettingsCache(
  payload: unknown,
  apply: (state: SettingsState) => void,
): SettingsState {
  const state = parseSettingsCache(payload);
  apply(state);
  return state;
}

/** 关闭请求回调：无论 flush 成败都继续关闭，且错误信息绝不携带快照内容。 */
export async function flushSettingsAndClose(
  snapshot: SettingsCachePayload,
  flush: (payload: SettingsCachePayload) => Promise<void>,
  close: () => Promise<void>,
): Promise<void> {
  try {
    await flush(snapshot);
  } catch (error) {
    console.error("设置缓存写入失败", error);
  }
  await close();
}
