<script setup lang="ts">
import { computed, ref } from "vue";
import { message } from "ant-design-vue";
import { FileTextOutlined } from "@ant-design/icons-vue";
import {
  exportRemoteAttestationReport,
  pickRemoteAttestationReportPath,
} from "../tauri";
import { hasServerAttestation } from "../ingressState";

const props = defineProps<{ report: unknown }>();

const exporting = ref(false);
const canExport = computed(() => hasServerAttestation(props.report));

async function onExport() {
  if (!canExport.value || exporting.value) return;

  // 先固定当前快照：保存对话框等待期间轮询刷新不改变本次导出内容。
  const snapshot = props.report;
  exporting.value = true;
  try {
    const path = await pickRemoteAttestationReportPath();
    if (!path) return;

    await exportRemoteAttestationReport(path, snapshot);
    message.success(`已导出: ${path}`);
  } catch (e) {
    message.error("导出远程证明报告失败: " + String(e));
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <a-tooltip title="导出报告">
    <a-button
      type="text"
      size="small"
      :loading="exporting"
      :disabled="!canExport"
      aria-label="导出远程证明报告"
      @click="onExport"
    >
      <template #icon>
        <FileTextOutlined />
      </template>
    </a-button>
  </a-tooltip>
</template>
