import { describe, expect, it, vi } from "vitest";
import { beforeLeaveSettings, bootstrapSettings } from "./settingsLifecycle";
import { DEFAULT_RVS_URL, defaultModel } from "./formspec";
import { serialize } from "./configmodel";
import { buildSettingsCacheSnapshot, parseSettingsCache } from "./settingsCache";

describe("settings bootstrap", () => {
  const makeTarget = () => ({
    initialize: vi.fn(),
    initializeApiKey: vi.fn(),
    initializeRvsUrl: vi.fn(),
  });

  it("restores cached settings without exposing or calling a launch path", async () => {
    const target = makeTarget();
    const model = defaultModel();
    model.ingress.outward = { host: "0.0.0.0", port: 9443 };
    await bootstrapSettings(
      () => Promise.resolve({
        schemaVersion: 1,
        tng: {
          configJson: serialize(model),
          apiKey: "key",
          rvsUrl: "https://private-rvs.example.com:8443",
        },
      }),
      target,
    );
    const restored = target.initialize.mock.calls[0][0];
    expect(restored.ingress.outward).toEqual({ host: "0.0.0.0", port: 9443 });
    expect(target.initializeApiKey).toHaveBeenCalledWith("key");
    expect(target.initializeRvsUrl).toHaveBeenCalledWith(
      "https://private-rvs.example.com:8443",
    );

    const snapshot = buildSettingsCacheSnapshot(
      serialize(restored),
      "key",
      restored.rvsUrl,
    );
    expect(parseSettingsCache(snapshot).rvsUrl).toBe(
      "https://private-rvs.example.com:8443",
    );
  });

  it("falls back to defaults when loading throws and still does not launch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = makeTarget();
    await bootstrapSettings(() => Promise.reject(new Error("missing backend")), target);
    expect(target.initialize).toHaveBeenCalledWith(defaultModel());
    expect(target.initializeApiKey).toHaveBeenCalledWith("");
    expect(target.initializeRvsUrl).toHaveBeenCalledWith(DEFAULT_RVS_URL);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to defaults for an empty cache envelope", async () => {
    const target = makeTarget();
    await bootstrapSettings(() => Promise.resolve({}), target);
    expect(target.initialize).toHaveBeenCalledWith(defaultModel());
    expect(target.initializeApiKey).toHaveBeenCalledWith("");
    expect(target.initializeRvsUrl).toHaveBeenCalledWith(DEFAULT_RVS_URL);
  });
});

describe("before leaving settings", () => {
  const base = {
    markSaved: vi.fn(),
    showError: vi.fn(),
  };

  it("does not save or restart when TNG config is not dirty", async () => {
    const saveConfig = vi.fn();
    const launchTng = vi.fn();
    await beforeLeaveSettings({
      ...base,
      isDirty: () => false,
      serializeCurrent: () => "{}",
      currentRvsUrl: () => DEFAULT_RVS_URL,
      saveConfig,
      getStatus: () => Promise.resolve({ reachable: true }),
      launchTng,
    });
    expect(saveConfig).not.toHaveBeenCalled();
    expect(launchTng).not.toHaveBeenCalled();
  });

  it("saves a dirty config and launches only when tng is reachable", async () => {
    const markSaved = vi.fn();
    const launchTng = vi.fn();
    await beforeLeaveSettings({
      ...base,
      isDirty: () => true,
      serializeCurrent: () => '{"configured":true}',
      currentRvsUrl: () => DEFAULT_RVS_URL,
      markSaved,
      saveConfig: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ reachable: true }),
      launchTng,
    });
    expect(launchTng).toHaveBeenCalledWith(
      '{"configured":true}',
      DEFAULT_RVS_URL,
    );
    expect(markSaved).toHaveBeenCalledTimes(1);
  });

  it("RVS 地址单独变化时也触发保存与运行中重启", async () => {
    const launchTng = vi.fn();
    const markSaved = vi.fn();
    await beforeLeaveSettings({
      ...base,
      isDirty: () => true,
      serializeCurrent: () => '{"configured":true}',
      currentRvsUrl: () => "https://private-rvs.example.com:8443",
      markSaved,
      saveConfig: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ reachable: true }),
      launchTng,
    });
    expect(launchTng).toHaveBeenCalledWith(
      '{"configured":true}',
      "https://private-rvs.example.com:8443",
    );
    expect(markSaved).toHaveBeenCalledTimes(1);
  });

  it("does not restart after cache-only save or API key change", async () => {
    const launchTng = vi.fn();
    await beforeLeaveSettings({
      ...base,
      isDirty: () => false,
      serializeCurrent: () => "{}",
      currentRvsUrl: () => DEFAULT_RVS_URL,
      saveConfig: vi.fn(),
      getStatus: () => Promise.resolve({ reachable: true }),
      launchTng,
    });
    expect(launchTng).not.toHaveBeenCalled();
  });

  it("stops auto-restart after save failure", async () => {
    const launchTng = vi.fn();
    await beforeLeaveSettings({
      ...base,
      isDirty: () => true,
      serializeCurrent: () => "{}",
      currentRvsUrl: () => DEFAULT_RVS_URL,
      markSaved: vi.fn(),
      saveConfig: vi.fn().mockRejectedValue(new Error("disk full")),
      getStatus: () => Promise.resolve({ reachable: true }),
      launchTng,
      showError: vi.fn(),
    });
    expect(launchTng).not.toHaveBeenCalled();
  });
});
