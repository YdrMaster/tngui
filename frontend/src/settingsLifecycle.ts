// App 生命周期的可测试入口：启动恢复设置、关闭 flush、切出设置自动保存。
import type { ConfigModel } from "./formspec";
import { parseSettingsCache } from "./settingsCache";
import type { SettingsCachePayload } from "./tauri";

export interface SettingsRestoreTarget {
  initialize(config: ConfigModel): void;
  initializeApiKey(apiKey: string): void;
}

export async function bootstrapSettings(
  load: () => Promise<unknown>,
  target: SettingsRestoreTarget,
): Promise<void> {
  try {
    // 调用方不能在这里注入 launchTng：该函数类型本身不暴露启动入口。
    const restored = parseSettingsCache(await load());
    target.initialize(restored.config);
    target.initializeApiKey(restored.apiKey);
  } catch (error) {
    console.error("读取设置缓存失败", error);
    const fallback = parseSettingsCache({});
    target.initialize(fallback.config);
    target.initializeApiKey(fallback.apiKey);
  }
}

export interface BeforeLeaveSettingsDependencies {
  isDirty(): boolean;
  serializeCurrent(): string;
  markSaved(): void;
  saveConfig(configJson: string): Promise<void>;
  getStatus(): Promise<{ reachable: boolean }>;
  launchTng(configJson: string): Promise<unknown>;
  showError(message: string): void;
}

/** 与 App 现有行为保持一致：仅 TNG 配置 dirty 触发 runtime 保存，apiKey 永不参与。 */
export async function beforeLeaveSettings(
  dependencies: BeforeLeaveSettingsDependencies,
): Promise<void> {
  if (!dependencies.isDirty()) return;
  const configJson = dependencies.serializeCurrent();
  try {
    await dependencies.saveConfig(configJson);
    dependencies.markSaved();
  } catch (error) {
    dependencies.showError("保存配置失败: " + String(error));
    return;
  }
  try {
    const status = await dependencies.getStatus();
    if (status.reachable) {
      await dependencies.launchTng(configJson);
    }
  } catch (error) {
    dependencies.showError("自动重启 tng 失败: " + String(error));
  }
}

export type SettingsCloseSnapshot = SettingsCachePayload;
