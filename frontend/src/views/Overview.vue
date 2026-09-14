<script setup lang="ts">
import { ref, computed, inject, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import { getStatus, getOutput, launchTng } from "../tauri";
import { useTngConfig } from "../composables/useTngConfig";
import { isRemoteConfigured } from "../formspec";
import {
  deriveIngressStates,
  deriveIngressInfo,
  type IngressObservation,
  type RuntimeState,
  type RemoteLinkState,
  type RemoteProofState,
} from "../ingressState";
import IngressStateCard from "../components/IngressStateCard.vue";
import IngressInfoCard from "../components/IngressInfoCard.vue";

const { serializeCurrent, model } = useTngConfig();

const statusReport = ref<Awaited<ReturnType<typeof getStatus>> | null>(null);
const outputLines = ref<string[]>([]);
const statusJsonText = ref("（暂无数据）");
const launching = ref(false);
let timer: number | undefined;

const ingressInfo = computed(() => {
  const entries = model.value.add_ingress || [];
  return deriveIngressInfo(entries[0]);
});

const states = computed(() => {
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

const tngRunning = computed(() => states.value.runtime === "running");

const navigate = inject<(target: "overview" | "inference" | "settings") => void>(
  "navigate",
  () => message.info("请点击左侧导航「设置」"),
);
const remoteConfigured = computed(() => isRemoteConfigured(model.value));
const startDisabled = computed(() => !tngRunning.value && !remoteConfigured.value);

const runtimeView = computed<{ state: "ok" | "warn" | "err"; text: string; subtitle: string }>(() => {
  const map: Record<RuntimeState, { state: "ok" | "warn" | "err"; text: string; subtitle: string }> = {
    stopped: { state: "warn", text: "关停", subtitle: "进程未运行" },
    running: { state: "ok", text: "运行", subtitle: "就绪探针通过" },
    error: { state: "err", text: "错误", subtitle: "服务失败或进程异常" },
  };
  return map[states.value.runtime];
});

const remoteLinkView = computed<{ state: "ok" | "warn" | "err" | "neutral"; text: string; subtitle: string }>(() => {
  const map: Record<RemoteLinkState, { state: "ok" | "warn" | "err" | "neutral"; text: string; subtitle: string }> = {
    uninit: { state: "neutral", text: "未初始化", subtitle: "尚无成功的远端密钥配置" },
    established: { state: "ok", text: "已建联", subtitle: "已有远端公钥" },
    failed: { state: "err", text: "失败", subtitle: "密钥配置或隧道失败" },
  };
  return map[states.value.remoteLink];
});

const remoteProofView = computed<{ state: "ok" | "warn" | "err" | "neutral"; text: string; subtitle: string }>(() => {
  const map: Record<RemoteProofState, { state: "ok" | "warn" | "err" | "neutral"; text: string; subtitle: string }> = {
    "not-obtained": { state: "neutral", text: "未获取", subtitle: "无缓存的校验凭据" },
    verified: { state: "ok", text: "已验证", subtitle: "已缓存校验凭据" },
    "refresh-due": { state: "warn", text: "待刷新", subtitle: "凭据接近过期" },
    failed: { state: "err", text: "失败", subtitle: "校验、刷新或取证失败" },
  };
  return map[states.value.remoteProof];
});

async function poll() {
  try {
    const r = await getStatus();
    statusReport.value = r;
    statusJsonText.value = r.status_json
      ? JSON.stringify(r.status_json, null, 2)
      : "（暂无数据）";
    if (r.ingress_keys) {
      statusJsonText.value += "\n// ingress ohttp keys\n" + JSON.stringify(r.ingress_keys, null, 2);
    }
    if (r.ingress_keys_error) {
      statusJsonText.value += "\n// keys 采集: " + r.ingress_keys_error;
    }
    if (r.error) {
      statusJsonText.value += "\n// " + r.error;
    }
  } catch (e) {
    statusReport.value = null;
    statusJsonText.value = "查询失败: " + String(e);
  }
  try {
    const lines = await getOutput();
    outputLines.value = lines?.length ? lines : [];
  } catch {
    outputLines.value = [];
  }
}

async function onToggle() {
  launching.value = true;
  if (tngRunning.value) {
    try {
      await invoke("stop_tng");
      message.success("已停止 tng");
    } catch (e) {
      message.error("停止失败: " + String(e));
    }
  } else {
    try {
      await launchTng(serializeCurrent());
      message.success("已启动 tng");
    } catch (e) {
      message.error("启动失败: " + String(e));
    }
  }
  launching.value = false;
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
  <div class="full-width" style="max-width:1540px;margin:0 auto">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px">
      <div>
        <h3 style="margin:0 0 4px;font-size:24px;font-weight:650">概览</h3>
        <span style="color:var(--text-secondary)">查看本机可信网关的运行状态、入口配置和远端链路状态。</span>
      </div>
      <a-tooltip :title="startDisabled ? '远端网关地址（out.host）未配置，请先在「设置」填写网关 IPv4' : undefined">
        <a-button
          :type="tngRunning ? 'primary' : 'default'"
          :danger="tngRunning"
          :loading="launching"
          :disabled="startDisabled"
          @click="onToggle"
        >{{ tngRunning ? '停止' : '启动' }}</a-button>
      </a-tooltip>
    </div>

    <a-alert
      v-if="startDisabled"
      type="warning"
      showIcon
      message="尚未配置远端网关地址，启动已禁用"
      style="margin-bottom:16px"
    >
      <template #description>
        请在「设置 → 入口」的「远端地址端口」填入集群网关 IPv4 地址（out），保存后返回此处启动。
        <a-button type="link" size="small" @click="navigate('settings')">前往设置 →</a-button>
      </template>
    </a-alert>

    <div class="ingress-top-strip">
      <IngressStateCard
        title="运行状态"
        :state="runtimeView.state"
        :state-text="runtimeView.text"
        :subtitle="runtimeView.subtitle"
      />
      <IngressInfoCard title="入口信息">
        <template #rows>
          <div class="ingress-info-row"><b>入口模式</b><span>{{ ingressInfo.modeLabel }}</span></div>
          <div class="ingress-info-row"><b>监听地址</b><span>{{ ingressInfo.listenAddress }}</span></div>
          <div class="ingress-info-row"><b>监听端口</b><span>{{ ingressInfo.listenPort }}</span></div>
        </template>
      </IngressInfoCard>
      <IngressStateCard
        title="远端链路"
        :state="remoteLinkView.state"
        :state-text="remoteLinkView.text"
        :subtitle="remoteLinkView.subtitle"
      />
      <IngressStateCard
        title="远端证明"
        :state="remoteProofView.state"
        :state-text="remoteProofView.text"
        :subtitle="remoteProofView.subtitle"
      />
    </div>

    <div class="ingress-debug-grid">
      <a-card size="small" title="原始状态数据">
        <pre class="mono" style="font-size:12px;white-space:pre-wrap;word-break:break-all;min-height:80px;max-height:320px;overflow:auto">{{ statusJsonText }}</pre>
      </a-card>
      <a-card size="small" title="进程日志">
        <pre class="mono" style="color:#6abf6a;font-size:12px;white-space:pre-wrap;word-break:break-all;min-height:80px;max-height:320px;overflow:auto">{{ outputLines.length ? outputLines.join("\n") : "（暂无输出）" }}</pre>
      </a-card>
    </div>
  </div>
</template>
