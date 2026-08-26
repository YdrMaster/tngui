<script setup lang="ts">
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import { useInferenceConfig } from "../composables/useInferenceConfig";
import { useTngConfig } from "../composables/useTngConfig";

const { model: inferenceModel, apiKey } = useInferenceConfig();
const { model: tngConfigModel } = useTngConfig();

const prompt = ref("");
const output = ref("");
const sending = ref(false);

const inferencePort = computed((): number | null => {
  const entries = tngConfigModel.value.add_ingress;
  if (!entries || entries.length === 0) return null;
  const first = entries[0];
  if (first.mode === "http_proxy" || first.mode === "socks5") {
    const pl = first.fields["proxy_listen"] as { port?: number } | undefined;
    return pl?.port ?? null;
  }
  if (first.mode === "mapping") {
    const rules = first.fields["rules"] as Array<{ in: { port?: number } }> | undefined;
    if (rules && rules.length > 0) return rules[0].in.port ?? null;
  }
  return null;
});

const canSend = computed(
  () =>
    !!inferenceModel.value &&
    !!apiKey.value &&
    !!prompt.value.trim() &&
    inferencePort.value !== null
);

async function onSend() {
  if (!canSend.value || inferencePort.value === null) return;
  sending.value = true;
  output.value = "";
  try {
    const result = await invoke<string>("send_inference", {
      port: inferencePort.value,
      model: inferenceModel.value,
      apiKey: apiKey.value,
      prompt: prompt.value,
    });
    output.value = result;
  } catch (e) {
    output.value = "发送失败: " + String(e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 h-full">
    <!-- Model 只读 -->
    <div>
      <strong>Model: </strong>
      <span v-if="inferenceModel">{{ inferenceModel }}</span>
      <span v-else class="text-slate-400">（请先在"设置"中填写 Model）</span>
    </div>

    <!-- Prompt textarea（不清空） -->
    <div>
      <div class="mb-1 font-semibold">Prompt：</div>
      <a-textarea
        v-model:value="prompt"
        :rows="8"
        placeholder="输入推理请求 prompt"
        class="font-mono"
      />
    </div>

    <!-- 发送按钮 -->
    <a-button type="primary" :loading="sending" :disabled="!canSend" @click="onSend">
      发送推理请求
    </a-button>
    <span v-if="inferencePort === null" class="text-slate-400 text-xs">
      ⚠ 未检测到可用 ingress 端口，请在设置中添加 http_proxy 或 mapping ingress。
    </span>

    <!-- 输出区（只读，覆盖上一次） -->
    <div class="rounded-lg border border-slate-200 bg-slate-50/50 p-4 flex-1 overflow-auto">
      <div class="text-sm text-slate-500 mb-2 font-semibold">推理输出（只读）</div>
      <pre class="font-mono text-xs text-slate-700 m-0 whitespace-pre-wrap break-all">{{ output || "（尚未发送）" }}</pre>
    </div>

    <!-- RA 过程区 占位 -->
    <div class="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div class="text-sm text-slate-500 mb-2 font-semibold">RA 验证过程（TODO 接数据）</div>
      <pre class="font-mono text-xs text-slate-400 m-0 whitespace-pre-wrap break-all">待接数据。TODO: 从 tng stdout 抓 encrypted= / attested= 行</pre>
    </div>
  </div>
</template>