// 推理 model 保持会话内；apiKey 可由启动 bootstrap 从设置缓存恢复。
import { ref, type Ref } from "vue";

const model: Ref<string> = ref("");
const apiKey: Ref<string> = ref("");

export function useInferenceConfig() {
  return { model, apiKey, initializeApiKey };
}

function initializeApiKey(next: string): void {
  apiKey.value = next;
}
