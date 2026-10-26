// 反代缓存盐（cache_salt）的纯配置逻辑：默认值、输入规整、随机盐生成与缓存恢复。
// 这里不依赖 Tauri，也不碰任何 GUI 状态，方便单独测试。当前实际使用的盐值不在这里，
// 它只存在于反代进程内存中。

export type CacheSaltMode = "ignore" | "add" | "overwrite";

export interface CacheSaltSettings {
  /** 忽略 / 添加 / 覆盖。 */
  mode: CacheSaltMode;
  /** 定时刷新开关。 */
  timerEnabled: boolean;
  /** 定时刷新周期（分钟）。 */
  refreshMinutes: number;
  /** 定量刷新开关。 */
  countEnabled: boolean;
  /** 定量刷新阈值（已转发的推理请求数）。 */
  countThreshold: number;
}

/** 默认添加模式、定时刷新 30 分钟、不开定量刷新。 */
export const DEFAULT_CACHE_SALT: CacheSaltSettings = {
  mode: "add",
  timerEnabled: true,
  refreshMinutes: 30,
  countEnabled: false,
  countThreshold: 50,
};

export const MIN_REFRESH_MINUTES = 1;
export const MAX_REFRESH_MINUTES = 1440;
export const MIN_COUNT_THRESHOLD = 1;
export const MAX_COUNT_THRESHOLD = 100000;
export const SALT_BYTES = 16;

const MODES: readonly CacheSaltMode[] = ["ignore", "add", "overwrite"];

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

/** 阈值只接受 [1, 100000] 的整数请求数，其余一律回落默认 50。 */
export function normalizeCountThreshold(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_COUNT_THRESHOLD &&
    value <= MAX_COUNT_THRESHOLD
  ) {
    return value;
  }
  return DEFAULT_CACHE_SALT.countThreshold;
}

/**
 * 恢复缓存里的盐配置：逐字段校验，缺失或非法字段各自回落默认。
 * 旧缓存残留的 `fixedValue`/`overwrite` 与旧模式串（`off`/`fixed`/`auto`）都不认，
 * 一律按缺失处理。
 */
export function restoredCacheSalt(value: unknown): CacheSaltSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    mode: MODES.includes(raw.mode as CacheSaltMode)
      ? (raw.mode as CacheSaltMode)
      : DEFAULT_CACHE_SALT.mode,
    timerEnabled:
      typeof raw.timerEnabled === "boolean"
        ? raw.timerEnabled
        : DEFAULT_CACHE_SALT.timerEnabled,
    refreshMinutes: normalizeRefreshMinutes(raw.refreshMinutes),
    countEnabled:
      typeof raw.countEnabled === "boolean"
        ? raw.countEnabled
        : DEFAULT_CACHE_SALT.countEnabled,
    countThreshold: normalizeCountThreshold(raw.countThreshold),
  };
}

/** 生成 128 位随机盐的小写十六进制串，与后端 `random_salt()` 同构。 */
export function randomSaltValue(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
