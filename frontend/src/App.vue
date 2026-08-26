<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import Overview from "./views/Overview.vue";
import InferenceView from "./views/InferenceView.vue";
import SettingsView from "./views/SettingsView.vue";
import { useTngConfig } from "./composables/useTngConfig";

type View = "overview" | "inference" | "settings";
const view = ref<View>("overview");

const themeConfig = {
  token: {
    colorPrimary: "#1677ff",
    colorInfo: "#1677ff",
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#ff4d4f",
    borderRadius: 8,
    fontFamily: '"PingFang SC", "Microsoft YaHei", Arial, sans-serif',
  },
};

async function beforeLeaveSettings() {
  const { isDirty, markSaved, serializeCurrent } = useTngConfig();
  if (!isDirty()) return;
  const json = serializeCurrent();
  try {
    await invoke("save_config", { configJson: json });
  } catch (e) {
    message.error("保存配置失败: " + String(e));
    return;
  }
  try {
    const status = await invoke<{ reachable: boolean }>("get_status");
    if (status.reachable) {
      await invoke("launch_tng", { configJson: json });
      message.success("配置已保存并自动重启 tng");
    } else {
      message.success("配置已保存");
    }
  } catch {
    /* ignore */
  }
  markSaved();
}

async function onMenuClick(e: { key: string }) {
  if (view.value === "settings") {
    await beforeLeaveSettings();
  }
  view.value = e.key as View;
}
</script>

<template>
  <a-config-provider :theme="themeConfig">
    <a-layout class="h-screen">
      <a-layout-sider width="160" theme="light" style="border-right: 1px solid #e2e8f0">
        <div class="px-4 py-4 font-semibold text-lg" style="color: var(--portal-navy)">
          TNG GUI
        </div>
        <a-menu :selectedKeys="[view]" mode="inline" @click="onMenuClick">
          <a-menu-item key="overview">概览</a-menu-item>
          <a-menu-item key="inference">密态推理</a-menu-item>
          <a-menu-item key="settings">设置</a-menu-item>
        </a-menu>
      </a-layout-sider>
      <a-layout-content
        class="p-4 overflow-auto"
        style="background: linear-gradient(145deg, #ffffff 0%, #f3f8ff 52%, #f8fbff 100%)"
      >
        <Overview v-if="view === 'overview'" />
        <InferenceView v-else-if="view === 'inference'" />
        <SettingsView v-else />
      </a-layout-content>
    </a-layout>
  </a-config-provider>
</template>