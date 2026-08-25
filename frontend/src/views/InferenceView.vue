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

// 推理请求端点：第一个 ingress 的 listen 端口
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
  <div style="display: flex; flex-direction: column; gap: 12px; height: 100%">
    <!-- Model 只读 -->
    <div>
      <strong>Model: </strong>
      <span v-if="inferenceModel">{{ inferenceModel }}</span>
      <span v-else style="color: #999">（请先在"设置"中填写 Model）</span>
    </div>

    <!-- Prompt textarea（不清空） -->
    <div>
      <div style="margin-bottom: 4px; font-weight: 600">Prompt：</div>
      <a-textarea
        v-model:value="prompt"
        :rows="8"
        placeholder="输入推理请求 prompt"
        style="font-family: monospace"
      />
    </div>

    <!-- 发送按钮 -->
    <a-button type="primary" :loading="sending" :disabled="!canSend" @click="onSend">
      发送推理请求
    </a-button>
    <span v-if="inferencePort === null" style="color: #999; font-size: 12px">
      ⚠ 未检测到可用 ingress 端口，请在设置中添加 http_proxy 或 mapping ingress。
    </span>

    <!-- 输出区（只读，覆盖上一次） -->
    <div class="panel" style="flex: 1; overflow: auto">
      <div class="panel-title">推理输出（只读）</div>
      <pre>{{ output || "（尚未发送）" }}</pre>
    </div>

    <!-- RA 过程区 占位 -->
    <div class="panel">
      <div class="panel-title">RA 验证过程（TODO 接数据）</div>
      <pre style="color: #999">待接数据。TODO: 从 tng stdout 抓 encrypted= / attested= 行</pre>
    </div>
  </div>
</template>

<style scoped>
.panel {
  border: 1px solid #555;
  border-radius: 6px;
  padding: 8px;
  background: rgba(127, 127, 127, 0.08);
}
.panel-title {
  font-size: 13px;
  color: #888;
  margin-bottom: 6px;
  font-weight: 600;
}
pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
}
</style>