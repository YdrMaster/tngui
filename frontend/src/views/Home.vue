<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { getStatus, getOutput } from "../tauri";

const light = ref("");
const label = ref("未知");
const statusJson = ref("—");
const output = ref("—");
let timer: number | undefined;

async function poll() {
  // 状态
  try {
    const r = await getStatus();
    if (!r.reachable) {
      light.value = "red";
      label.value = "不可达 / 未运行";
    } else if (r.ready) {
      light.value = "green";
      label.value = "就绪";
    } else {
      light.value = "yellow";
      label.value = "启动中…";
    }
    statusJson.value = r.status_json ? JSON.stringify(r.status_json, null, 2) : "（空）";
    if (r.error) statusJson.value += "\n// " + r.error;
  } catch (e) {
    light.value = "red";
    label.value = "查询失败";
    statusJson.value = String(e);
  }
  // 输出
  try {
    const lines = await getOutput();
    output.value = lines && lines.length ? lines.join("\n") : "（暂无输出）";
  } catch (e) {
    output.value = String(e);
  }
}

onMounted(() => {
  poll();
  timer = window.setInterval(poll, 1500);
});
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 12px; height: 100%">
    <div>
      状态：
      <span class="light" :class="light"></span>
      <span style="margin-left: 8px; font-weight: 600">{{ label }}</span>
    </div>
    <div class="panel">
      <div class="panel-title">GET /status/</div>
      <pre>{{ statusJson }}</pre>
    </div>
    <div class="panel" style="flex: 1; overflow: auto">
      <div class="panel-title">tng 进程输出（stdout / stderr，只读）</div>
      <pre style="color: #6abf6a">{{ output }}</pre>
    </div>
  </div>
</template>

<style scoped>
.light {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid #888;
  vertical-align: middle;
  background: #999;
}
.light.red { background: #e53935; }
.light.yellow { background: #fdd835; }
.light.green { background: #43a047; }
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