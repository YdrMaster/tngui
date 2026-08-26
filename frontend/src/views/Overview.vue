<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import { getStatus, getOutput, launchTng } from "../tauri";
import { useTngConfig } from "../composables/useTngConfig";

const { serializeCurrent } = useTngConfig();
const light = ref("");
const label = ref("未知");
const statusJson = ref("—");
const outputLines = ref<string[]>([]);
const launching = ref(false);
let timer: number | undefined;

const connected = computed(() =>
  outputLines.value.some((l) => l.includes("encrypted=true"))
);
const tngRunning = computed(
  () => light.value === "yellow" || light.value === "green"
);
const lightBg = computed(() => {
  if (light.value === "red") return "bg-red-500";
  if (light.value === "yellow") return "bg-yellow-400";
  if (light.value === "green") return "bg-green-600";
  return "bg-slate-400";
});

async function poll() {
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
  try {
    const lines = await getOutput();
    outputLines.value = lines && lines.length ? lines : [];
  } catch {
    outputLines.value = [];
  }
}

async function onStart() {
  launching.value = true;
  try {
    await launchTng(serializeCurrent());
    message.success("已拉起 tng");
  } catch (e) {
    message.error("启动失败: " + String(e));
  } finally {
    launching.value = false;
  }
}

async function onStop() {
  try {
    await invoke("stop_tng");
    message.success("已停止 tng");
  } catch (e) {
    message.error("停止失败: " + String(e));
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
  <div class="flex flex-col gap-3 h-full">
    <!-- 3 状态块 -->
    <a-row :gutter="12">
      <a-col :span="8">
        <a-card size="small" :bordered="false">
          <div class="text-sm text-slate-500 mb-1 font-semibold">进程</div>
          <div class="flex items-center gap-2">
            <span :class="['inline-block w-4 h-4 rounded-full border border-slate-300', lightBg]"></span>
            <span class="font-semibold">{{ label }}</span>
          </div>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card size="small" :bordered="false">
          <div class="text-sm text-slate-500 mb-1 font-semibold">配置 + 连接</div>
          <a-tag :color="connected ? 'green' : 'default'">
            {{ connected ? "已连接服务端" : "未建立隧道" }}
          </a-tag>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card size="small" :bordered="false">
          <div class="text-sm text-slate-500 mb-1 font-semibold">RA 验证</div>
          <a-tag color="default">待接数据</a-tag>
          <div class="text-xs text-slate-400 mt-1">TODO: 解析 stdout attested=</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 启停按钮 -->
    <a-space>
      <a-button type="primary" :loading="launching" @click="onStart">启动</a-button>
      <a-button :disabled="!tngRunning" @click="onStop">停止</a-button>
    </a-space>

    <!-- /status/ JSON -->
    <div class="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div class="text-sm text-slate-500 mb-2 font-semibold">GET /status/</div>
      <pre class="font-mono text-xs text-slate-700 m-0 whitespace-pre-wrap break-all">{{ statusJson }}</pre>
    </div>

    <!-- tng stdout/stderr -->
    <div class="rounded-lg border border-slate-200 bg-slate-50/50 p-4 flex-1 overflow-auto">
      <div class="text-sm text-slate-500 mb-2 font-semibold">tng 进程输出（stdout / stderr，只读）</div>
      <pre class="font-mono text-xs text-green-700 m-0 whitespace-pre-wrap break-all">{{
        outputLines.length ? outputLines.join("\n") : "（暂无输出）"
      }}</pre>
    </div>
  </div>
</template>