import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CACHE_SALT } from "../cacheSaltConfig";

const tauriMocks = vi.hoisted(() => ({ configureCacheSalt: vi.fn() }));
vi.mock("../tauri", () => tauriMocks);

const { useCacheSaltConfig } = await import("./useCacheSaltConfig");

const { cacheSalt, currentCacheSalt, updateCacheSalt, initializeCacheSalt } =
  useCacheSaltConfig();

beforeEach(() => {
  vi.clearAllMocks();
  cacheSalt.value = { ...DEFAULT_CACHE_SALT };
  tauriMocks.configureCacheSalt.mockResolvedValue(undefined);
});

describe("useCacheSaltConfig", () => {
  it("默认自动刷新、30 分钟、不覆盖", () => {
    expect(currentCacheSalt()).toEqual(DEFAULT_CACHE_SALT);
  });

  it("改动即时下发给反代，且只走 configure_cache_salt 这一条路径", async () => {
    const next = { mode: "fixed" as const, refreshMinutes: 15, fixedValue: "abc", overwrite: true };
    await updateCacheSalt(next);

    expect(tauriMocks.configureCacheSalt).toHaveBeenCalledTimes(1);
    expect(tauriMocks.configureCacheSalt).toHaveBeenCalledWith({
      mode: "fixed",
      refreshMinutes: 15,
      fixedValue: "abc",
      overwrite: true,
    });
    expect(currentCacheSalt()).toEqual(next);
  });

  it("bootstrap 恢复时也把盐配置推给命令", async () => {
    const restored = { mode: "off" as const, refreshMinutes: 60, fixedValue: "", overwrite: false };
    await initializeCacheSalt(restored);

    expect(tauriMocks.configureCacheSalt).toHaveBeenCalledWith({
      mode: "off",
      refreshMinutes: 60,
      fixedValue: "",
      overwrite: false,
    });
    expect(currentCacheSalt()).toEqual(restored);
  });

  it("下发失败只记日志，不回滚状态也不抛错", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    tauriMocks.configureCacheSalt.mockRejectedValue(new Error("backend down"));

    await expect(
      updateCacheSalt({ mode: "auto", refreshMinutes: 30, fixedValue: "", overwrite: true }),
    ).resolves.toBeUndefined();
    expect(currentCacheSalt()).toEqual({
      mode: "auto",
      refreshMinutes: 30,
      fixedValue: "",
      overwrite: true,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
