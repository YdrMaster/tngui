// 反代缓存盐（cache_salt）的纯配置逻辑：默认值、输入规整、随机盐生成与缓存恢复。
// 这里不依赖 Tauri，也不碰任何 GUI 状态，方便单独测试。

export type CacheSaltMode = "off" | "fixed" | "auto";

export interface CacheSaltSettings {
  /** 关闭 / 固定值 / 定时自动刷新随机值。 */
  mode: CacheSaltMode;
  /** 自动模式的刷新周期（分钟）。 */
  refreshMinutes: number;
  /** 固定模式的盐值。 */
  fixedValue: string;
  /** 请求体里已有 cache_salt 时是否覆盖。 */
  overwrite: boolean;
}

/** 默认自动刷新，周期 30 分钟，不覆盖已有盐。 */
export const DEFAULT_CACHE_SALT: CacheSaltSettings = {
  mode: "auto",
  refreshMinutes: 30,
  fixedValue: "",
  overwrite: false,
};

export const MIN_REFRESH_MINUTES = 1;
export const MAX_REFRESH_MINUTES = 1440;
export const SALT_BYTES = 16;

const MODES: readonly CacheSaltMode[] = ["off", "fixed", "auto"];

/** 周期只接受 [1, 1440] 的整数分钟，其余一律回落默认 30。 */
export function normalizeRefreshMinutes(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_REFRESH_MINUTES &&
    value <= MAX_REFRESH_MINUTES
  ) {
    return value;
  }
  return DEFAULT_CACHE_SALT.refreshMinutes;
}

/** 恢复缓存里的盐配置：缺失或非法字段各自回落默认，有效字段保留。 */
export function restoredCacheSalt(value: unknown): CacheSaltSettings {
  const raw = (value ?? {}) as {
    mode?: unknown;
    refreshMinutes?: unknown;
    fixedValue?: unknown;
    overwrite?: unknown;
  };
  return {
    mode: MODES.includes(raw.mode as CacheSaltMode)
      ? (raw.mode as CacheSaltMode)
      : DEFAULT_CACHE_SALT.mode,
    refreshMinutes: normalizeRefreshMinutes(raw.refreshMinutes),
    fixedValue: typeof raw.fixedValue === "string" ? raw.fixedValue : "",
    overwrite:
      typeof raw.overwrite === "boolean"
        ? raw.overwrite
        : DEFAULT_CACHE_SALT.overwrite,
  };
}

/** 生成 128 位随机盐的小写十六进制串，与后端 `random_salt()` 同构。 */
export function randomSaltValue(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
