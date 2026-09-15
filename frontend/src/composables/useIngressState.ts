// 共享的 tng 入口状态轮询：复用概览“运行状态”卡同一 `deriveIngressStates` 判定，
// 供概览与密态推理视图同源消费，避免两处“运行”判定漂移。
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { getStatus, getOutput } from "../tauri";
import {
  deriveIngressStates,
  type IngressObservation,
  type IngressStates,
} from "../ingressState";

export function useIngressState(intervalMs = 1500) {
  const statusReport = ref<Awaited<ReturnType<typeof getStatus>> | null>(null);
  const outputLines = ref<string[]>([]);
  const pollError = ref("");

  const states = computed<IngressStates>(() => {
    const report = statusReport.value;
    const observation: IngressObservation = {
      reachable: report?.reachable ?? false,
      livezOk: report?.livez_ok ?? false,
      ready: report?.ready ?? false,
      statusJson: report?.status_json ?? null,
      ingressKeys: report?.ingress_keys ?? null,
      ingressKeysError: report?.ingress_keys_error ?? null,
      processError: report?.process_error ?? null,
      outputLines: outputLines.value,
    };
    return deriveIngressStates(observation);
  });

  // 与概览左上角“运行状态”卡同口径：runtime === "running"。
  const tngRunning = computed(() => states.value.runtime === "running");

  async function poll() {
    try {
      statusReport.value = await getStatus();
      pollError.value = "";
    } catch (e) {
      statusReport.value = null;
      pollError.value = String(e);
    }
    try {
      const lines = await getOutput();
      outputLines.value = lines?.length ? lines : [];
    } catch {
      outputLines.value = [];
    }
  }

  let timer: number | undefined;
  onMounted(() => {
    poll();
    timer = window.setInterval(poll, intervalMs);
  });
  onBeforeUnmount(() => {
    if (timer) window.clearInterval(timer);
  });

  return { statusReport, outputLines, states, tngRunning, pollError, poll };
}
