import { describe, expect, it } from "vitest";
import {
  DEFAULT_CACHE_SALT,
  MAX_REFRESH_MINUTES,
  MIN_REFRESH_MINUTES,
  normalizeRefreshMinutes,
  randomSaltValue,
  restoredCacheSalt,
} from "./cacheSaltConfig";

describe("刷新周期规整", () => {
  it("接受区间内的整数分钟", () => {
    expect(normalizeRefreshMinutes(MIN_REFRESH_MINUTES)).toBe(1);
    expect(normalizeRefreshMinutes(15)).toBe(15);
    expect(normalizeRefreshMinutes(MAX_REFRESH_MINUTES)).toBe(1440);
  });

  it("非整数、越界与非法类型一律回落默认 30", () => {
    for (const value of [0, -1, 1441, 1.5, Number.NaN, "30", null, undefined, {}]) {
      expect(normalizeRefreshMinutes(value)).toBe(DEFAULT_CACHE_SALT.refreshMinutes);
    }
  });
});

describe("缓存里的盐配置恢复", () => {
  it("默认自动刷新、30 分钟、不覆盖", () => {
    expect(DEFAULT_CACHE_SALT).toEqual({
      mode: "auto",
      refreshMinutes: 30,
      fixedValue: "",
      overwrite: false,
    });
  });

  it("完整字段原样恢复", () => {
    expect(
      restoredCacheSalt({
        mode: "off",
        refreshMinutes: 45,
        fixedValue: "abc",
        overwrite: true,
      }),
    ).toEqual({ mode: "off", refreshMinutes: 45, fixedValue: "abc", overwrite: true });
  });

  it("缺失或非法字段逐项回落，合法字段保留", () => {
    expect(restoredCacheSalt(undefined)).toEqual(DEFAULT_CACHE_SALT);
    expect(restoredCacheSalt(null)).toEqual(DEFAULT_CACHE_SALT);
    expect(restoredCacheSalt("nope")).toEqual(DEFAULT_CACHE_SALT);
    expect(restoredCacheSalt({ mode: "fixed" })).toEqual({
      mode: "fixed",
      refreshMinutes: 30,
      fixedValue: "",
      overwrite: false,
    });
    expect(
      restoredCacheSalt({ mode: "weird", refreshMinutes: 0, fixedValue: 42, overwrite: "yes" }),
    ).toEqual(DEFAULT_CACHE_SALT);
  });
});

describe("随机盐生成", () => {
  it("输出 128 位（32 位十六进制）小写盐", () => {
    const salt = randomSaltValue();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("两次生成不重复", () => {
    expect(randomSaltValue()).not.toBe(randomSaltValue());
  });
});
