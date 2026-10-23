import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSettingsCacheSnapshot,
  flushSettingsAndClose,
  parseSettingsCache,
} from "./settingsCache";
import { parse, serialize } from "./configmodel";
import { DEFAULT_CACHE_SALT } from "./cacheSaltConfig";
import { DEFAULT_RVS_URL, defaultModel } from "./formspec";

const validConfig = serialize(defaultModel());
const validSerializedModel = defaultModel();

describe("settings cache parsing", () => {
  it("restores valid tng config and apiKey", () => {
    const payload = {
      schemaVersion: 1,
      tng: {
        configJson: validConfig,
        apiKey: "secret",
        rvsUrl: "https://private-rvs.example.com:8443",
      },
    };
    const state = parseSettingsCache(payload);
    expect(state.apiKey).toBe("secret");
    expect(state.rvsUrl).toBe("https://private-rvs.example.com:8443");
    expect(state.config.rvsUrl).toBe("https://private-rvs.example.com:8443");
    expect(state.config.ingress.mode).toBe("http_proxy");
    expect(state.config.ingress.outward).toEqual(
      validSerializedModel.ingress.outward,
    );
  });

  it("rejects unknown schema and restores defaults", () => {
    const state = parseSettingsCache({ schemaVersion: 2, tng: { apiKey: "x" } });
    expect(state.config).toEqual(defaultModel());
    expect(state.apiKey).toBe("");
    expect(state.rvsUrl).toBe(DEFAULT_RVS_URL);
  });

  it("restores the default RVS address when the cached value is missing or invalid", () => {
    const missing = parseSettingsCache({
      schemaVersion: 1,
      tng: { configJson: validConfig, apiKey: "secret" },
    });
    expect(missing.rvsUrl).toBe(DEFAULT_RVS_URL);

    for (const invalidValue of [42, null, "", "   "]) {
      const state = parseSettingsCache({
        schemaVersion: 1,
        tng: { configJson: validConfig, apiKey: "secret", rvsUrl: invalidValue },
      });
      expect(state.rvsUrl).toBe(DEFAULT_RVS_URL);
    }
  });

  it("falls back only the config while preserving an explicit cached RVS address", () => {
    const state = parseSettingsCache({
      schemaVersion: 1,
      tng: { configJson: "{invalid", apiKey: "secret", rvsUrl: "https://private-rvs.example.com:8443" },
    });
    const expected = defaultModel();
    expected.rvsUrl = "https://private-rvs.example.com:8443";
    expect(state.config).toEqual(expected);
    expect(state.apiKey).toBe("secret");
    expect(state.rvsUrl).toBe("https://private-rvs.example.com:8443");
  });

  it("falls back only tng config when its content is invalid", () => {
    const payload = {
      schemaVersion: 1,
      tng: {
        configJson: JSON.stringify({
          add_ingress: [{
            mapping: { rules: [{ in: {}, out: { host: "", port: 80 } }] },
            ohttp: {},
            tngui_outward: { host: "127.0.0.1", port: 0 },
          }],
        }),
        apiKey: "secret",
      },
    };
    const state = parseSettingsCache(payload);
    expect(state.config).toEqual(defaultModel());
    expect(state.apiKey).toBe("secret");
  });

  it("restores tng config independently when apiKey is not a string", () => {
    const payload = {
      schemaVersion: 1,
      tng: {
        configJson: validConfig,
        apiKey: 42,
      },
    };
    const state = parseSettingsCache(payload);
    expect(state.apiKey).toBe("");
    expect(state.config).not.toEqual(defaultModel());
  });

  it("builds a closed payload with no raw draft/model/prompt fields", () => {
    const snapshot = buildSettingsCacheSnapshot(
      '{"add_ingress":[]}',
      "key",
      "https://private-rvs.example.com:8443",
    );
    expect(snapshot).toEqual({
      schemaVersion: 1,
      tng: {
        configJson: '{"add_ingress":[]}',
        apiKey: "key",
        rvsUrl: "https://private-rvs.example.com:8443",
        cacheSalt: DEFAULT_CACHE_SALT,
      },
    });
    expect(Object.keys(snapshot.tng)).toEqual([
      "configJson",
      "apiKey",
      "rvsUrl",
      "cacheSalt",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("prompt");
    expect(JSON.stringify(snapshot)).not.toContain('"model"');
    expect(JSON.stringify(snapshot)).not.toContain("control_interface");
    expect(JSON.stringify(snapshot)).not.toContain("restful");
    expect(JSON.stringify(snapshot)).not.toContain("proxy_listen");
  });
});

describe("close flush", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("continues closing after a successful flush", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const snapshot = buildSettingsCacheSnapshot("{}", "key", DEFAULT_RVS_URL);
    await flushSettingsAndClose(snapshot, flush, close);
    expect(flush).toHaveBeenCalledWith(snapshot);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("continues closing when flush fails without exposing the snapshot", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const flush = vi.fn().mockRejectedValue(new Error("disk full"));
    const close = vi.fn().mockResolvedValue(undefined);
    await flushSettingsAndClose(
      buildSettingsCacheSnapshot("secret-config", "secret-key", "secret-rvs"),
      flush,
      close,
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls.map(String).join(" ")).not.toContain("secret-config");
    expect(errorSpy.mock.calls.map(String).join(" ")).not.toContain("secret-key");
  });
});

describe("cached domain normalization", () => {
  it("trims a cached http_proxy domain while preserving the https TLS semantics", () => {
    const configJson = JSON.stringify({
      add_ingress: [{
        http_proxy: {
          proxy_listen: {},
          dst_filters: [{ domain: "  https://cached.example.com  ", port: 443 }],
        },
        no_ra: true,
        tngui_outward: { host: "127.0.0.1", port: 9443 },
      }],
    });
    const state = parseSettingsCache({
      schemaVersion: 1,
      tng: { configJson, apiKey: "secret", rvsUrl: "https://private-rvs.example.com:8443" },
    });
    const df = state.config.ingress.fields.dst_filters as { domain: string };
    expect(df.domain).toBe("https://cached.example.com");
    expect(state.config.ingress.tls).toBe(true);
  });
});

describe("自动模式的实时盐不落盘", () => {
  it("快照只带盐配置字段，不携带任何实时盐值", () => {
    const snapshot = buildSettingsCacheSnapshot("{}", "key", DEFAULT_RVS_URL, {
      mode: "auto",
      refreshMinutes: 30,
      fixedValue: "",
      overwrite: false,
    });
    // 结构化保证：盐配置只有这 4 个字段，实时随机盐没有落脚处。
    expect(Object.keys(snapshot.tng.cacheSalt)).toEqual([
      "mode",
      "refreshMinutes",
      "fixedValue",
      "overwrite",
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/[0-9a-f]{32}/);
  });
});

describe("缓存盐配置的缓存恢复", () => {
  const base = { configJson: validConfig, apiKey: "secret" };

  it("完整字段按原样恢复", () => {
    const state = parseSettingsCache({
      schemaVersion: 1,
      tng: {
        ...base,
        rvsUrl: DEFAULT_RVS_URL,
        cacheSalt: { mode: "off", refreshMinutes: 15, fixedValue: "abc", overwrite: true },
      },
    });
    expect(state.cacheSalt).toEqual({
      mode: "off",
      refreshMinutes: 15,
      fixedValue: "abc",
      overwrite: true,
    });
    // 盐字段存在不影响其它字段的恢复。
    expect(state.apiKey).toBe("secret");
    expect(state.config).not.toEqual(defaultModel());
  });

  it("缺失字段整体回落默认（自动/30/不覆盖）", () => {
    const state = parseSettingsCache({ schemaVersion: 1, tng: base });
    expect(state.cacheSalt).toEqual(DEFAULT_CACHE_SALT);
  });

  it("非法字段逐项回落默认，且不影响配置与 API Key", () => {
    const state = parseSettingsCache({
      schemaVersion: 1,
      tng: {
        ...base,
        cacheSalt: { mode: "weird", refreshMinutes: 0, fixedValue: 42, overwrite: "yes" },
      },
    });
    expect(state.cacheSalt).toEqual(DEFAULT_CACHE_SALT);
    expect(state.apiKey).toBe("secret");
    expect(state.config).not.toEqual(defaultModel());
  });

  it("非整数或越界周期回落默认值", () => {
    for (const refreshMinutes of [1.5, 0, -3, 1441, Number.NaN]) {
      const state = parseSettingsCache({
        schemaVersion: 1,
        tng: { ...base, cacheSalt: { mode: "auto", refreshMinutes } },
      });
      expect(state.cacheSalt.refreshMinutes).toBe(DEFAULT_CACHE_SALT.refreshMinutes);
      expect(state.cacheSalt.mode).toBe("auto");
    }
  });
});
