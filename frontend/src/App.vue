<script setup lang="ts">
import { computed, ref, provide, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "ant-design-vue";
import {
  SafetyCertificateOutlined, DashboardOutlined, ExperimentOutlined, SettingOutlined,
} from "@ant-design/icons-vue";
import Overview from "./views/Overview.vue";
import InferenceView from "./views/InferenceView.vue";
import SettingsView from "./views/SettingsView.vue";
import { useTngConfig } from "./composables/useTngConfig";
import { useInferenceConfig } from "./composables/useInferenceConfig";
import {
  buildSettingsCacheSnapshot,
  flushSettingsAndClose,
} from "./settingsCache";
import {
  beforeLeaveSettings as runBeforeLeaveSettings,
  bootstrapSettings,
} from "./settingsLifecycle";
import { flushSettingsCache, loadSettingsCache } from "./tauri";

type View = "overview" | "inference" | "settings";
const view = ref<View>("overview");
const settingsReady = ref(false);
let unlistenClose: (() => void) | undefined;
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

const views = {
  overview: Overview,
  inference: InferenceView,
  settings: SettingsView,
} as const;
const activeView = computed(() => views[view.value]);

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
  const { isDirty, markSaved, serializeCurrent, currentRvsUrl } = useTngConfig();
  await runBeforeLeaveSettings({
    isDirty,
    serializeCurrent,
    currentRvsUrl,
    markSaved,
    saveConfig: (configJson: string) => invoke("save_config", { configJson }),
    getStatus: () => invoke<{ reachable: boolean }>("get_status"),
    launchTng: (configJson: string, rvsUrl: string) =>
      invoke("launch_tng", { configJson, rvsUrl }),
    showError: (text: string) => message.error(text),
  });
}

async function goTo(target: View) {
  if (view.value === "settings") await beforeLeaveSettings();
  view.value = target;
}

provide("navigate", goTo);

onMounted(async () => {
  // 关闭监听先注册：设置 bootstrap 未完成时也能 flush 当前默认/已恢复状态。
  unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
    // 阻止默认关闭，等后端原子写入完成；失败也继续关闭。
    event.preventDefault();
    const { serializeCurrent, currentRvsUrl } = useTngConfig();
    const { apiKey } = useInferenceConfig();
    await flushSettingsAndClose(
      buildSettingsCacheSnapshot(serializeCurrent(), apiKey.value, currentRvsUrl()),
      flushSettingsCache,
      () => getCurrentWindow().destroy(),
    );
  });

  // 所有视图都必须等待设置初始化完成，避免用户先进入设置看到默认值。
  await bootstrapSettings(loadSettingsCache, {
    initialize: useTngConfig().initialize,
    initializeRvsUrl: useTngConfig().initializeRvsUrl,
    initializeApiKey: useInferenceConfig().initializeApiKey,
  });
  settingsReady.value = true;

  pollRuntime();
  runtimeTimer = window.setInterval(pollRuntime, 2000);
});
onBeforeUnmount(() => {
  unlistenClose?.();
  if (runtimeTimer) window.clearInterval(runtimeTimer);
});
</script>

<template>
  <a-config-provider :theme="themeConfig">
    <div
      v-if="!settingsReady"
      class="h-screen flex items-center justify-center"
      style="color:var(--text-secondary)"
    >
      正在初始化设置…
    </div>
    <a-layout v-else class="h-screen" style="background:var(--bg-layout)">
      <a-layout-sider width="196" theme="light" class="sidebar">
        <div class="brand">
          <div class="brand-row">
            <div class="brand-mark"><SafetyCertificateOutlined /></div>
            <div class="brand-title">可信网关</div>
          </div>
          <div class="brand-subtitle">Trusted Network Gateway</div>
        </div>
        <div class="sidebar-menu">
          <a-button
            v-for="item in menuItems"
            :key="item.key"
            :type="view === item.key ? 'primary' : 'text'"
            @click="goTo(item.key as View)"
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
          class="p-4 overflow-auto"
          style="background:linear-gradient(145deg,#ffffff 0%,#f3f8ff 52%,#f8fbff 100%)"
        >
          <KeepAlive include="InferenceView">
            <component :is="activeView" />
          </KeepAlive>
        </a-layout-content>
      </a-layout>
    </a-layout>
  </a-config-provider>
</template>