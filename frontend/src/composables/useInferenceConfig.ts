// 密态推理模型清单与选中模型保持会话内；apiKey 可由启动 bootstrap 从设置缓存恢复。
import { ref, type Ref } from "vue";

export type ModelDiscoveryState = "loading" | "loaded-nonempty" | "loaded-empty" | "failed";

const model: Ref<string> = ref("");
const modelIds: Ref<string[]> = ref([]);
const modelDiscoveryState: Ref<ModelDiscoveryState> = ref("loading");
const apiKey: Ref<string> = ref("");

function startModelDiscovery(): void {
  modelDiscoveryState.value = "loading";
}

/** 以服务端返回清单驱动选择器，保持“当前选择必须属于最新清单”的不变量。 */
function replaceModelList(nextModelIds: string[]): void {
  modelIds.value = [...nextModelIds];
  if (nextModelIds.length === 0) {
    model.value = "";
    modelDiscoveryState.value = "loaded-empty";
    return;
  }
  if (!nextModelIds.includes(model.value)) {
    model.value = nextModelIds[0];
  }
  modelDiscoveryState.value = "loaded-nonempty";
}

function failModelDiscovery(): void {
  modelIds.value = [];
  model.value = "";
  modelDiscoveryState.value = "failed";
}

/** 只接受当前模型清单中的值；搜索筛选产生的任意文本不能进入状态。 */
function selectModel(value: string): void {
  if (modelIds.value.includes(value)) {
    model.value = value;
  }
}

export function useInferenceConfig() {
  return {
    apiKey,
    initializeApiKey,
    model,
    modelIds,
    modelDiscoveryState,
    selectModel,
    replaceModelList,
    startModelDiscovery,
    failModelDiscovery,
  };
}

function initializeApiKey(next: string): void {
  apiKey.value = next;
}
