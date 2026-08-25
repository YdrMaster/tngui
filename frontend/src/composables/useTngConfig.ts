// 全 App 共享的 TNG 配置 model + dirty 检测。
import { ref, type Ref } from "vue";
import { defaultModel, type ConfigModel } from "../formspec";
import { serialize } from "../configmodel";

const model: Ref<ConfigModel> = ref(defaultModel());
// 上一次已保存的序列化——用于 dirty 检测
let lastSavedSerialized = serialize(model.value);

export function useTngConfig() {
  return { model, isDirty, markSaved, serializeCurrent };
}

function isDirty(): boolean {
  return serialize(model.value) !== lastSavedSerialized;
}

function markSaved(): void {
  lastSavedSerialized = serialize(model.value);
}

function serializeCurrent(): string {
  return serialize(model.value);
}