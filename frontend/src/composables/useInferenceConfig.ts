// 密态推理凭据（model + apiKey），内存态、不持久化。
import { ref, type Ref } from "vue";

const model: Ref<string> = ref("");
const apiKey: Ref<string> = ref("");

export function useInferenceConfig() {
  return { model, apiKey };
}