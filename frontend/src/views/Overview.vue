<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import {
  CloudServerOutlined, MessageOutlined, ApiOutlined, CheckCircleOutlined, DisconnectOutlined,
  CopyOutlined, ExperimentOutlined,
} from "@ant-design/icons-vue";
import { getStatus, getOutput, launchTng } from "../tauri";
import { useTngConfig } from "../composables/useTngConfig";
import StatusCard from "../components/StatusCard.vue";
import type { Component } from "vue";

const { serializeCurrent } = useTngConfig();
const light = ref("");
const label = ref("未知");
const statusJson = ref("—");
const outputLines = ref<string[]>([]);
const launching = ref(false);
let timer: number | undefined;

const connected = computed(() => outputLines.value.some((l) => l.includes("encrypted=true")));
const tngRunning = computed(() => light.value === "green" || light.value === "yellow");
const tngReady = computed(() => light.value === "green");

const localEndpoint = computed(() => {
  const entries = (useTngConfig().model.value.add_ingress || []);
  if (entries.length === 0) return "—";
  const first = entries[0];
  if (first.mode === "http_proxy" || first.mode === "socks5") {
    const pl = first.fields["proxy_listen"] as { port?: number } | undefined;
    return pl?.port ? `http://127.0.0.1:${pl.port}/v1` : "—";
  }
  if (first.mode === "mapping") {
    const rules = first.fields["rules"] as Array<{ in: { port?: number } }> | undefined;
    if (rules?.length) return rules[0].in.port ? `http://127.0.0.1:${rules[0].in.port}/v1` : "—";
  }
  return "—";
});

const listenAddress = computed(() => {
  const entries = (useTngConfig().model.value.add_ingress || []);
  if (entries.length === 0) return "—";
  const first = entries[0];
  if (first.mode === "http_proxy" || first.mode === "socks5") {
    const pl = first.fields["proxy_listen"] as { port?: number } | undefined;
    return pl?.port ? `127.0.0.1:${pl.port}` : "—";
  }
  if (first.mode === "mapping") {
    const rules = first.fields["rules"] as Array<{ in: { port?: number } }> | undefined;
    if (rules?.length) return rules[0].in.port ? `127.0.0.1:${rules[0].in.port}` : "—";
  }
  return "—";
});

async function poll() {
  try {
    const r = await getStatus();
    if (!r.reachable) { light.value = "red"; label.value = "不可达 / 未运行"; }
    else if (r.ready) { light.value = "green"; label.value = "就绪"; }
    else { light.value = "yellow"; label.value = "启动中…"; }
    statusJson.value = r.status_json ? JSON.stringify(r.status_json, null, 2) : "（空）";
    if (r.error) statusJson.value += "\n// " + r.error;
  } catch (e) { light.value = "red"; label.value = "查询失败"; statusJson.value = String(e); }
  try {
    const lines = await getOutput();
    outputLines.value = lines?.length ? lines : [];
  } catch { outputLines.value = []; }
}

async function onToggle() {
  launching.value = true;
  if (tngRunning.value) {
    try { await invoke("stop_tng"); message.success("已停止 tng"); }
    catch (e) { message.error("停止失败: " + String(e)); }
  } else {
    try { await launchTng(serializeCurrent()); message.success("已启动 tng"); }
    catch (e) { message.error("启动失败: " + String(e)); }
  }
  launching.value = false;
}
async function copy (text: string) {
  try { await navigator.clipboard?.writeText(text); message.success("已复制"); } catch {}
}
function gotoSettings() { message.info("请点击左侧导航「设置」"); }
function gotoDebug() { message.info("请点击左侧导航「密态推理调试」"); }

onMounted(() => { poll(); timer = window.setInterval(poll, 1500); });
onBeforeUnmount(() => { if (timer) window.clearInterval(timer); });
</script>

<template>
  <div class="full-width" style="max-width:1540px;margin:0 auto">
    <!-- PageHeader -->
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px">
      <div>
        <h3 style="margin:0 0 4px;font-size:24px;font-weight:650">概览</h3>
        <span style="color:var(--text-secondary)">查看本机可信网关的运行状态、控制信道和本地访问地址。</span>
      </div>
      <a-button
        :type="tngRunning ? 'primary' : 'default'"
        :danger="tngRunning"
        :loading="launching"
        @click="onToggle"
      >{{ tngRunning ? '停止' : '启动' }}</a-button>
    </div>

    <!-- 3 StatusCards -->
    <a-row :gutter="[16, 16]">
      <a-col :span="8">
        <StatusCard
          :icon="CloudServerOutlined"
          label="本地 TNG 网关"
          :value="tngReady ? '运行中' : '未运行'"
          :detail="`v0.2.1 · ${listenAddress}`"
          :tone="tngReady ? 'success' : 'error'"
        />
      </a-col>
      <a-col :span="8">
        <StatusCard
          :icon="MessageOutlined"
          label="XMPP 控制信道"
          :value="tngReady ? '已连接' : '已断开'"
          :detail="tngReady ? '心跳正常' : '等待网关恢复'"
          :tone="tngReady ? 'success' : 'error'"
        />
      </a-col>
      <a-col :span="8">
        <StatusCard
          :icon="ApiOutlined"
          label="本地访问"
          :value="tngReady ? '可用' : '不可用'"
          :detail="localEndpoint"
          :tone="tngReady ? 'success' : 'error'"
        />
      </a-col>
    </a-row>

    <!-- Primary Card -->
    <a-card class="primary-card" :bordered="false">
      <a-row :gutter="40" align="middle">
        <a-col :span="14">
          <div style="display:flex;flex-direction:column;gap:18px">
            <a-tag :color="tngReady ? 'success' : 'error'">
              <CheckCircleOutlined v-if="tngReady" />
              <DisconnectOutlined v-else />
              {{ tngReady ? "网关运行正常" : "网关服务异常" }}
            </a-tag>
            <div>
              <h2 style="margin:0 0 4px">TNG Gateway 已在本机就绪</h2>
              <span style="color:var(--text-secondary)">应用只需访问本地地址，可信连接与加密过程由网关完成。</span>
            </div>
            <div class="endpoint-box">
              <div>
                <span style="color:var(--text-secondary)">本地 API Base URL</span>
                <div class="mono endpoint-text">{{ localEndpoint }}</div>
              </div>
              <a-button @click="copy(localEndpoint)"><CopyOutlined /> 复制</a-button>
            </div>
          </div>
        </a-col>
        <a-col :span="10">
          <div :class="['secure-badge', !tngReady ? 'error' : '']">
            <div class="pulse-ring" />
            <MessageOutlined />
            <b>{{ tngReady ? "已就绪" : "未就绪" }}</b>
            <span>{{ tngReady ? "信道已连接" : "请启动本地网关" }}</span>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- 配置 + 连接 / RA 状态 -->
    <a-row :gutter="[16, 16]" style="margin:16px 0">
      <a-col :span="12">
        <a-card size="small" :bordered="false">
          <div style="font-size:13px;color:var(--text-secondary);font-weight:600;margin-bottom:4px">配置 + 连接</div>
          <a-tag :color="connected ? 'green' : 'default'">{{ connected ? "已建立隧道 / 已连接服务端" : "未建立隧道" }}</a-tag>
        </a-card>
      </a-col>
      <a-col :span="12">
        <a-card size="small" :bordered="false">
          <div style="font-size:13px;color:var(--text-secondary);font-weight:600;margin-bottom:4px">RA 验证</div>
          <a-tag color="default">待接数据</a-tag>
          <div class="small-text" style="color:var(--text-tertiary);font-size:12px;margin-top:2px">TODO: 解析 attested=</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- /status/ JSON -->
    <a-card size="small" title="GET /status/" style="margin-bottom:16px">
      <pre class="mono" style="font-size:12px;white-space:pre-wrap;word-break:break-all">{{ statusJson }}</pre>
    </a-card>

    <!-- tng stdout/stderr -->
    <a-card size="small" title="tng 进程输出（stdout/stderr）">
      <pre class="mono" style="color:#6abf6a;font-size:12px;white-space:pre-wrap;word-break:break-all;min-height:80px;max-height:320px;overflow:auto">{{
        outputLines.length ? outputLines.join("\n") : "（暂无输出）"
      }}</pre>
    </a-card>

    <!-- 安全说明引导 -->
    <a-alert
      type="info" showIcon style="margin-top:18px"
      message="密态推理配置与安全说明已收敛到对应场景"
      description="API Key 在「设置」中统一管理；请求调试、AI 客户端接入和安全机制说明请进入「密态推理调试」。"
    >
      <template #action>
        <a-button size="small" @click="gotoDebug">进入调试</a-button>
      </template>
    </a-alert>
  </div>
</template>