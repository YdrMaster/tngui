<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import {
  SafetyCertificateOutlined, DashboardOutlined, ExperimentOutlined, SettingOutlined,
} from "@ant-design/icons-vue";
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

const menuItems = [
  { key: "overview", icon: DashboardOutlined, label: "概览" },
  { key: "inference", icon: ExperimentOutlined, label: "密态推理调试" },
  { key: "settings", icon: SettingOutlined, label: "设置" },
];

const runtimeStatus = ref({ running: false, statusLabel: "检测中…" });
let runtimeTimer: number | undefined;

async function pollRuntime() {
  try {
    const s = await invoke<{ reachable: boolean; livez_ok: boolean; ready: boolean }>("get_status");
    runtimeStatus.value.running = s.ready;
    runtimeStatus.value.statusLabel = !s.reachable
      ? "关停"
      : s.ready
        ? "运行"
        : s.livez_ok
          ? "关停"
          : "错误";
  } catch {
    runtimeStatus.value.running = false;
    runtimeStatus.value.statusLabel = "关停";
  }
}

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
  } catch { /* ignore */ }
  markSaved();
}

async function onMenuClick(e: { key: string }) {
  if (view.value === "settings") await beforeLeaveSettings();
  view.value = e.key as View;
}

onMounted(() => {
  pollRuntime();
  runtimeTimer = window.setInterval(pollRuntime, 2000);
});
onBeforeUnmount(() => {
  if (runtimeTimer) window.clearInterval(runtimeTimer);
});
</script>

<template>
  <a-config-provider :theme="themeConfig">
    <a-layout class="h-screen" style="background:var(--bg-layout)">
      <a-layout-sider width="216" theme="light" class="sidebar">
        <div class="brand">
          <div class="brand-mark"><SafetyCertificateOutlined /></div>
          <div>
            <div class="brand-title">可信网关</div>
            <div class="brand-subtitle"><strong>T</strong>rusted <strong>N</strong>etwork <strong>G</strong>ateway</div>
          </div>
        </div>
        <div class="sidebar-menu">
          <a-button
            v-for="item in menuItems"
            :key="item.key"
            :type="view === item.key ? 'primary' : 'text'"
            @click="onMenuClick({ key: item.key })"
          >
            <component :is="item.icon" />
            <span style="margin-left:8px">{{ item.label }}</span>
          </a-button>
        </div>
        <div class="sidebar-bottom">
          <div class="runtime-mini">
            <a-badge :status="runtimeStatus.running ? 'success' : 'default'" />
            <div>
              <strong>{{ runtimeStatus.statusLabel }}</strong>
              <div style="color:var(--text-secondary);font-size:11px">
                本地进程状态
              </div>
            </div>
          </div>
        </div>
      </a-layout-sider>
      <a-layout style="background:var(--bg-layout)">
        <a-layout-content
          class="p-6 overflow-auto"
          style="background:linear-gradient(145deg,#ffffff 0%,#f3f8ff 52%,#f8fbff 100%)"
        >
          <Overview v-if="view === 'overview'" />
          <InferenceView v-else-if="view === 'inference'" />
          <SettingsView v-else />
        </a-layout-content>
      </a-layout>
    </a-layout>
  </a-config-provider>
</template>