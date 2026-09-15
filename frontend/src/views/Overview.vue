<script setup lang="ts">
import { ref, computed, inject } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import { launchTng } from "../tauri";
import { useTngConfig } from "../composables/useTngConfig";
import { useIngressState } from "../composables/useIngressState";
import { isRemoteConfigured } from "../formspec";
import { deriveIngressInfo } from "../ingressState";
import { deriveGatewayStateViews } from "../ingressStateViews";
import IngressStateCard from "../components/IngressStateCard.vue";
import IngressInfoCard from "../components/IngressInfoCard.vue";

const { serializeCurrent, model } = useTngConfig();
const { statusReport, outputLines, states, tngRunning, pollError } = useIngressState();
const gatewayViews = computed(() => deriveGatewayStateViews(states.value));
const launching = ref(false);

const ingressInfo = computed(() => {
  const entries = model.value.add_ingress || [];
  return deriveIngressInfo(entries[0]);
});

// tng 本地监听对用户隐藏（tngui 启动时注入）；概览入口信息以反代对外绑定为"本机入口"。
const entryOutward = computed(() => {
  const e = model.value.add_ingress?.[0];
  return e?.outward ?? null;
});

const statusJsonText = computed(() => {
  const r = statusReport.value;
  if (!r) return pollError.value ? `查询失败: ${pollError.value}` : "（暂无数据）";
  let txt = r.status_json ? JSON.stringify(r.status_json, null, 2) : "（暂无数据）";
  if (r.ingress_keys) txt += "\n// ingress ohttp keys\n" + JSON.stringify(r.ingress_keys, null, 2);
  if (r.ingress_keys_error) txt += "\n// keys 采集: " + r.ingress_keys_error;
  if (r.error) txt += "\n// " + r.error;
  return txt;
});

const navigate = inject<(target: "overview" | "inference" | "settings") => void>(
  "navigate",
  () => message.info("请点击左侧导航「设置」"),
);
const remoteConfigured = computed(() => isRemoteConfigured(model.value));
const startDisabled = computed(() => !tngRunning.value && !remoteConfigured.value);

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
        :key="gatewayViews.runtime.key"
        :title="gatewayViews.runtime.title"
        :state="gatewayViews.runtime.state"
        :state-text="gatewayViews.runtime.stateText"
        :subtitle="gatewayViews.runtime.subtitle"
      />
      <IngressInfoCard title="入口信息">
        <template #rows>
          <div class="ingress-info-row"><b>入口模式</b><span>{{ ingressInfo.modeLabel }}</span></div>
          <div class="ingress-info-row"><b>绑定地址</b><span>{{ entryOutward ? entryOutward.host : "——" }}</span></div>
          <div class="ingress-info-row"><b>本机端口</b><span>{{ entryOutward ? entryOutward.port : "——" }}</span></div>
        </template>
      </IngressInfoCard>
      <IngressStateCard
        :key="gatewayViews.remoteLink.key"
        :title="gatewayViews.remoteLink.title"
        :state="gatewayViews.remoteLink.state"
        :state-text="gatewayViews.remoteLink.stateText"
        :subtitle="gatewayViews.remoteLink.subtitle"
      />
      <IngressStateCard
        :key="gatewayViews.remoteProof.key"
        :title="gatewayViews.remoteProof.title"
        :state="gatewayViews.remoteProof.state"
        :state-text="gatewayViews.remoteProof.stateText"
        :subtitle="gatewayViews.remoteProof.subtitle"
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
