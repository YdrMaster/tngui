import { describe, expect, it } from "vitest";
import {
  DEFAULT_CACHE_SALT,
  MAX_COUNT_THRESHOLD,
  MAX_REFRESH_MINUTES,
  MIN_COUNT_THRESHOLD,
  MIN_REFRESH_MINUTES,
  normalizeCountThreshold,
  normalizeRefreshMinutes,
  randomSaltValue,
  restoredCacheSalt,
} from "./cacheSaltConfig";

describe("刷新参数规整", () => {
  it("周期接受区间内的整数分钟", () => {
    expect(normalizeRefreshMinutes(MIN_REFRESH_MINUTES)).toBe(1);
    expect(normalizeRefreshMinutes(15)).toBe(15);
    expect(normalizeRefreshMinutes(MAX_REFRESH_MINUTES)).toBe(1440);
  });

  it("非整数、越界与非法类型一律回落默认 30", () => {
    for (const value of [0, -1, 1441, 1.5, Number.NaN, "30", null, undefined, {}]) {
      expect(normalizeRefreshMinutes(value)).toBe(DEFAULT_CACHE_SALT.refreshMinutes);
    }
  });

  it("阈值接受区间内的整数请求数", () => {
    expect(normalizeCountThreshold(MIN_COUNT_THRESHOLD)).toBe(1);
    expect(normalizeCountThreshold(250)).toBe(250);
    expect(normalizeCountThreshold(MAX_COUNT_THRESHOLD)).toBe(100000);
  });

  it("非整数、越界与非法类型一律回落默认 50", () => {
    for (const value of [0, -3, 100001, 2.5, Number.NaN, "50", null, undefined, {}]) {
      expect(normalizeCountThreshold(value)).toBe(DEFAULT_CACHE_SALT.countThreshold);
    }
  });
});

describe("缓存里的盐配置恢复", () => {
  it("默认添加、定时 30 分钟、不开定量刷新", () => {
    expect(DEFAULT_CACHE_SALT).toEqual({
      mode: "add",
      timerEnabled: true,
      refreshMinutes: 30,
      countEnabled: false,
      countThreshold: 50,
    });
  });

  it("完整字段原样恢复", () => {
    expect(
      restoredCacheSalt({
        mode: "overwrite",
        timerEnabled: false,
        refreshMinutes: 45,
        countEnabled: true,
        countThreshold: 80,
      }),
    ).toEqual({
      mode: "overwrite",
      timerEnabled: false,
      refreshMinutes: 45,
      countEnabled: true,
      countThreshold: 80,
    });
  });

  it("缺失或非法字段逐项回落，合法字段保留", () => {
    expect(restoredCacheSalt(undefined)).toEqual(DEFAULT_CACHE_SALT);
    expect(restoredCacheSalt(null)).toEqual(DEFAULT_CACHE_SALT);
    expect(restoredCacheSalt("nope")).toEqual(DEFAULT_CACHE_SALT);
    expect(restoredCacheSalt({ mode: "ignore" })).toEqual({
      mode: "ignore",
      timerEnabled: true,
      refreshMinutes: 30,
      countEnabled: false,
      countThreshold: 50,
    });
    expect(
      restoredCacheSalt({
        mode: "weird",
        timerEnabled: "yes",
        refreshMinutes: 0,
        countEnabled: 1,
        countThreshold: 0,
      }),
    ).toEqual(DEFAULT_CACHE_SALT);
  });

  it("旧缓存的字段与旧模式串按缺失处理", () => {
    expect(
      restoredCacheSalt({
        mode: "auto",
        refreshMinutes: 45,
        fixedValue: "abc",
        overwrite: true,
      }),
    ).toEqual({
      mode: "add",
      timerEnabled: true,
      refreshMinutes: 45,
      countEnabled: false,
      countThreshold: 50,
    });
    for (const legacy of ["off", "fixed", "auto"]) {
      expect(restoredCacheSalt({ mode: legacy }).mode).toBe("add");
    }
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
