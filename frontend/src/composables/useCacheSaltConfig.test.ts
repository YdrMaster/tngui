import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CACHE_SALT } from "../cacheSaltConfig";

const tauriMocks = vi.hoisted(() => ({
  configureCacheSalt: vi.fn(),
  setCacheSaltValue: vi.fn(),
  currentCacheSalt: vi.fn(),
}));
vi.mock("../tauri", () => tauriMocks);

const { useCacheSaltConfig } = await import("./useCacheSaltConfig");

const {
  cacheSalt,
  cacheSaltSnapshot,
  updateCacheSalt,
  initializeCacheSalt,
  applyCacheSaltValue,
  fetchCurrentSalt,
} = useCacheSaltConfig();

beforeEach(() => {
  vi.clearAllMocks();
  cacheSalt.value = { ...DEFAULT_CACHE_SALT };
  tauriMocks.configureCacheSalt.mockResolvedValue(undefined);
  tauriMocks.setCacheSaltValue.mockResolvedValue(undefined);
  tauriMocks.currentCacheSalt.mockResolvedValue(null);
});

describe("useCacheSaltConfig", () => {
  it("默认添加、定时 30 分钟、不开定量刷新", () => {
    expect(cacheSaltSnapshot()).toEqual(DEFAULT_CACHE_SALT);
  });

  it("配置里不含盐值字段", () => {
    expect(Object.keys(cacheSaltSnapshot()).sort()).toEqual([
      "countEnabled",
      "countThreshold",
      "mode",
      "refreshMinutes",
      "timerEnabled",
    ]);
  });

  it("改动即时下发给反代，且只走 configure_cache_salt 这一条路径", async () => {
    const next = {
      mode: "overwrite" as const,
      timerEnabled: false,
      refreshMinutes: 15,
      countEnabled: true,
      countThreshold: 80,
    };
    await updateCacheSalt(next);

    expect(tauriMocks.configureCacheSalt).toHaveBeenCalledTimes(1);
    expect(tauriMocks.configureCacheSalt).toHaveBeenCalledWith({
      mode: "overwrite",
      timerEnabled: false,
      refreshMinutes: 15,
      countEnabled: true,
      countThreshold: 80,
    });
    expect(cacheSaltSnapshot()).toEqual(next);
  });

  it("bootstrap 恢复时也把盐配置推给命令", async () => {
    const restored = {
      mode: "ignore" as const,
      timerEnabled: true,
      refreshMinutes: 60,
      countEnabled: false,
      countThreshold: 50,
    };
    await initializeCacheSalt(restored);

    expect(tauriMocks.configureCacheSalt).toHaveBeenCalledWith(restored);
    expect(cacheSaltSnapshot()).toEqual(restored);
  });

  it("下发失败只记日志，不回滚状态也不抛错", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    tauriMocks.configureCacheSalt.mockRejectedValue(new Error("backend down"));

    const next = { ...DEFAULT_CACHE_SALT, countEnabled: true };
    await expect(updateCacheSalt(next)).resolves.toBeUndefined();
    expect(cacheSaltSnapshot()).toEqual(next);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("直接改盐值走 set_cache_salt_value，不改共享配置", async () => {
    await applyCacheSaltValue("user-salt");
    expect(tauriMocks.setCacheSaltValue).toHaveBeenCalledWith("user-salt");
    expect(cacheSaltSnapshot()).toEqual(DEFAULT_CACHE_SALT);
  });

  it("改盐值失败只记日志", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    tauriMocks.setCacheSaltValue.mockRejectedValue(new Error("backend down"));
    await expect(applyCacheSaltValue("user-salt")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("读取当前盐走 current_cache_salt，失败返回 null", async () => {
    tauriMocks.currentCacheSalt.mockResolvedValue("fresh-salt");
    expect(await fetchCurrentSalt()).toBe("fresh-salt");

    tauriMocks.currentCacheSalt.mockResolvedValue(null);
    expect(await fetchCurrentSalt()).toBeNull();

    // 后端若给出 null 之外的异常值，也一律当作没有可用盐。
    tauriMocks.currentCacheSalt.mockResolvedValue(undefined);
    expect(await fetchCurrentSalt()).toBeNull();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    tauriMocks.currentCacheSalt.mockRejectedValue(new Error("backend down"));
    expect(await fetchCurrentSalt()).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
