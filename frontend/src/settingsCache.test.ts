import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSettingsCacheSnapshot,
  flushSettingsAndClose,
  parseSettingsCache,
} from "./settingsCache";
import { parse, serialize } from "./configmodel";
import { defaultModel } from "./formspec";

const validConfig = serialize(defaultModel());
const validSerializedModel = defaultModel();

describe("settings cache parsing", () => {
  it("restores valid tng config and apiKey", () => {
    const payload = {
      schemaVersion: 1,
      tng: { configJson: validConfig, apiKey: "secret" },
    };
    const state = parseSettingsCache(payload);
    expect(state.apiKey).toBe("secret");
    expect(state.config.add_ingress[0].mode).toBe("mapping");
    expect(state.config.add_ingress[0].outward).toEqual(
      validSerializedModel.add_ingress[0].outward,
    );
  });

  it("rejects unknown schema and restores defaults", () => {
    const state = parseSettingsCache({ schemaVersion: 2, tng: { apiKey: "x" } });
    expect(state.config).toEqual(defaultModel());
    expect(state.apiKey).toBe("");
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
    const snapshot = buildSettingsCacheSnapshot('{"add_ingress":[]}', "key");
    expect(snapshot).toEqual({
      schemaVersion: 1,
      tng: { configJson: '{"add_ingress":[]}', apiKey: "key" },
    });
    expect(Object.keys(snapshot.tng)).toEqual(["configJson", "apiKey"]);
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
    const snapshot = buildSettingsCacheSnapshot("{}", "key");
    await flushSettingsAndClose(snapshot, flush, close);
    expect(flush).toHaveBeenCalledWith(snapshot);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("continues closing when flush fails without exposing the snapshot", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const flush = vi.fn().mockRejectedValue(new Error("disk full"));
    const close = vi.fn().mockResolvedValue(undefined);
    await flushSettingsAndClose(
      buildSettingsCacheSnapshot("secret-config", "secret-key"),
      flush,
      close,
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls.map(String).join(" ")).not.toContain("secret-config");
    expect(errorSpy.mock.calls.map(String).join(" ")).not.toContain("secret-key");
  });
});
