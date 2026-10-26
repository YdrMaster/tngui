// 全 App 共享的反代缓存盐配置。它不进 useTngConfig 的 dirty 基线，
// 改动只即时下发给反代，不写盘、不重启 tng。
//
// 当前实际使用的盐值不在这里：它由反代进程持有、随请求惰性轮换，只能通过
// currentCacheSalt 命令读回，也绝不进入设置缓存。
import { ref, type Ref } from "vue";
import { DEFAULT_CACHE_SALT, type CacheSaltSettings } from "../cacheSaltConfig";
import { configureCacheSalt, currentCacheSalt, setCacheSaltValue } from "../tauri";

const cacheSalt: Ref<CacheSaltSettings> = ref({ ...DEFAULT_CACHE_SALT });

function cacheSaltSnapshot(): CacheSaltSettings {
  return { ...cacheSalt.value };
}

/** 把策略推给后端。失败只记日志，不回滚 UI，也不暴露盐值内容。 */
async function pushCacheSalt(next: CacheSaltSettings): Promise<void> {
  try {
    await configureCacheSalt({
      mode: next.mode,
      timerEnabled: next.timerEnabled,
      refreshMinutes: next.refreshMinutes,
      countEnabled: next.countEnabled,
      countThreshold: next.countThreshold,
    });
  } catch (error) {
    console.error("下发缓存盐配置失败", error);
  }
}

/** 设置页改动：先更新共享状态，再即时下发反代。 */
async function updateCacheSalt(next: CacheSaltSettings): Promise<void> {
  cacheSalt.value = { ...next };
  await pushCacheSalt(next);
}

/** bootstrap 恢复：在 tng 启动前把恢复后的策略推给后端，避免回落默认。 */
async function initializeCacheSalt(next: CacheSaltSettings): Promise<void> {
  cacheSalt.value = { ...next };
  await pushCacheSalt(next);
}

/** 直接改盐值（提交输入框内容或生成随机值）：换用新盐并重置定时与定量记录。 */
async function applyCacheSaltValue(value: string): Promise<void> {
  try {
    await setCacheSaltValue(value);
  } catch (error) {
    console.error("下发缓存盐值失败", error);
  }
}

/** 读取当前实际使用的盐值；忽略模式、非字符串或读取失败一律返回 null。只读，不影响刷新记录。 */
async function fetchCurrentSalt(): Promise<string | null> {
  try {
    const value = await currentCacheSalt();
    return typeof value === "string" ? value : null;
  } catch (error) {
    console.error("读取当前缓存盐失败", error);
    return null;
  }
}

export function useCacheSaltConfig() {
  return {
    cacheSalt,
    cacheSaltSnapshot,
    updateCacheSalt,
    initializeCacheSalt,
    applyCacheSaltValue,
    fetchCurrentSalt,
  };
}
