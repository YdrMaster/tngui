// 全 App 共享的反代缓存盐配置。它不进 useTngConfig 的 dirty 基线，
// 改动只即时下发给反代，不写盘、不重启 tng。
import { ref, type Ref } from "vue";
import { DEFAULT_CACHE_SALT, type CacheSaltSettings } from "../cacheSaltConfig";
import { configureCacheSalt } from "../tauri";

const cacheSalt: Ref<CacheSaltSettings> = ref({ ...DEFAULT_CACHE_SALT });

function currentCacheSalt(): CacheSaltSettings {
  return { ...cacheSalt.value };
}

/** 把策略推给后端。失败只记日志，不回滚 UI，也不暴露盐值内容。 */
async function pushCacheSalt(next: CacheSaltSettings): Promise<void> {
  try {
    await configureCacheSalt({
      mode: next.mode,
      refreshMinutes: next.refreshMinutes,
      fixedValue: next.fixedValue,
      overwrite: next.overwrite,
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

export function useCacheSaltConfig() {
  return { cacheSalt, currentCacheSalt, updateCacheSalt, initializeCacheSalt };
}
