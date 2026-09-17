// 全 App 共享的 TNG 配置 model + dirty 检测。
import { ref, type Ref } from "vue";
import { defaultModel, type ConfigModel } from "../formspec";
import { serialize } from "../configmodel";

const model: Ref<ConfigModel> = ref(defaultModel());
// 上一次已保存的序列化——用于 dirty 检测。
let lastSavedSerialized = serialize(model.value);

export function useTngConfig() {
  return { model, isDirty, initialize, markSaved, serializeCurrent };
}

function isDirty(): boolean {
  return serialize(model.value) !== lastSavedSerialized;
}

/** 启动 bootstrap 使用：同时恢复 model 并重置“最后已保存”基线。 */
function initialize(next: ConfigModel): void {
  model.value = next;
  markSaved();
}

function markSaved(): void {
  lastSavedSerialized = serialize(model.value);
}

function serializeCurrent(): string {
  return serialize(model.value);
}
