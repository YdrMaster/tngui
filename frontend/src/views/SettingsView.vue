<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  ApiOutlined, ExperimentOutlined, ImportOutlined, ExportOutlined,
} from "@ant-design/icons-vue";
import { defaultFields, DEFAULT_OUTWARD } from "../formspec";
import { parse } from "../configmodel";
import {
  pickLogPath, exportTngLog, pickImportPath, pickExportPath,
  importConfig, exportConfig, appInfo,
} from "../tauri";
import EntryEditor from "../components/EntryEditor.vue";
import IngressStateCard from "../components/IngressStateCard.vue";
import { useTngConfig } from "../composables/useTngConfig";
import { useIngressState } from "../composables/useIngressState";
import { deriveGatewayStateViews } from "../ingressStateViews";
import { useInferenceConfig } from "../composables/useInferenceConfig";

const { model, isDirty, markSaved, serializeCurrent } = useTngConfig();
const { apiKey } = useInferenceConfig();
const { states } = useIngressState();
const gatewayViews = computed(() => deriveGatewayStateViews(states.value));
const activeTab = ref<"form" | "raw">("form");
const rawEditing = ref(serializeCurrent());
const exportingLog = ref(false);

// 客户端信息：版本/操作系统取自后端编译期变量（app_info），不写死
const clientVersion = ref("…");
const clientOs = ref("…");
async function fetchAppInfo() {
  try {
    const i = await appInfo();
    clientVersion.value = i.version;
    clientOs.value = i.os;
  } catch {
    clientVersion.value = "未知";
    clientOs.value = "未知";
  }
}
fetchAppInfo();

function syncRaw() { rawEditing.value = serializeCurrent(); }
function onTabChange(key: string | number) { if (key === "raw") syncRaw(); activeTab.value = key as "form" | "raw"; }
function applyRaw() {
  const r = parse(rawEditing.value);
  if (r.error) { message.error("JSON 错误，未回填: " + r.error); return; }
  model.value = r.model!;
  if (r.warnings?.length) message.warning("已回填（部分条目被丢弃: " + r.warnings.join("; ") + "）");
  else message.success("已按原始 JSON 回填表单");
}
function addIngress() {
  model.value.add_ingress.push({
    mode: "mapping",
    fields: defaultFields("mapping"),
    no_ra: false,
    verify: { model: "passport", as_provider: "tpm" },
    outward: { ...DEFAULT_OUTWARD },
    extra: {},
  });
}
function removeIngress(i: number) { model.value.add_ingress.splice(i, 1); }

async function onExportLog() {
  exportingLog.value = true;
  try {
    const path = await pickLogPath(); if (!path) return;
    await exportTngLog(path);
    message.success("已导出: " + path);
  } catch (e) {
    message.error("导出日志失败: " + String(e));
  } finally { exportingLog.value = false; }
}
async function onImport() {
  try {
    const path = await pickImportPath(); if (!path) return;
    const json = await importConfig(path); const r = parse(json);
    if (r.error) { message.error("导入失败: " + r.error); return; }
    model.value = r.model!; syncRaw();
    if (r.warnings?.length) message.warning("已导入（部分条目被丢弃: " + r.warnings.join("; ") + "）");
    else message.success("已导入并回填");
  } catch (e) { message.error("导入出错: " + String(e)); }
}
async function onExport() {
  try {
    const path = await pickExportPath(); if (!path) return;
    await exportConfig(path, serializeCurrent()); message.success("已导出: " + path);
  } catch (e) { message.error("导出失败: " + String(e)); }
}

watch(() => model.value, () => { if (activeTab.value === "raw") syncRaw(); }, { deep: true });
</script>

<template>
  <div class="full-width" style="max-width:1540px;margin:0 auto">
    <div class="page-header" style="margin-bottom:22px">
      <h3 style="margin:0 0 4px;font-size:24px;font-weight:650">设置</h3>
      <span style="color:var(--text-secondary)">管理 TNG Gateway 基础能力、功能配置与客户端信息。</span>
    </div>

    <!-- TNG Gateway Card -->
    <a-card class="gateway-settings-card" title="TNG Gateway">
      <div class="gateway-status-strip">
        <IngressStateCard
          :key="gatewayViews.runtime.key"
          :title="gatewayViews.runtime.title"
          :state="gatewayViews.runtime.state"
          :state-text="gatewayViews.runtime.stateText"
          :subtitle="gatewayViews.runtime.subtitle"
        />
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
      <div class="gateway-actions">
        <a-button :loading="exportingLog" @click="onExportLog">导出日志</a-button>
      </div>
    </a-card>

    <!-- 功能配置 -->
    <div class="settings-section-heading">
      <div><h4 style="margin:0 0 3px;font-size:16px;font-weight:600">功能配置</h4><span style="color:var(--text-secondary)">按需配置 TNG Gateway 承载的功能。</span></div>
      <a-tag color="blue">已启用 1 个功能</a-tag>
    </div>

    <!-- 密态推理 Feature Card：只保留 API Key（Model 已移至密态推理视图）；本地端口与远端取自结构化 ingress -->
    <a-card class="feature-card">
      <template #title>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="feature-icon"><ExperimentOutlined /></div>
          <div><div style="font-weight:600">密态推理</div><div class="small-text" style="color:var(--text-secondary)">通过可信网关访问密态大模型服务</div></div>
        </div>
      </template>
      <a-form layout="vertical">
        <a-form-item label="API Key">
          <a-input-password v-model:value="apiKey" placeholder="请输入 API Key" autocapitalize="off" autocorrect="off" spellcheck="false">
            <template #prefix><ApiOutlined /></template>
          </a-input-password>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- TNG 配置 -->
    <div class="settings-section-heading" style="margin-top:20px">
      <div><h4 style="margin:0 0 3px;font-size:16px;font-weight:600">TNG 配置</h4><span style="color:var(--text-secondary)">结构化编辑客户端 ingress（锁定 OHTTP 形态）；本机不承载 egress。</span></div>
      <span style="display:flex;gap:8px">
        <a-button @click="onImport"><ImportOutlined /> 导入 JSON</a-button>
        <a-button @click="onExport"><ExportOutlined /> 导出 JSON</a-button>
      </span>
    </div>

    <a-tabs v-model:activeKey="activeTab" @change="onTabChange">
      <a-tab-pane key="form" tab="结构化">
        <a-form layout="vertical">
          <a-card size="small" title="add_ingress（客户端 OHTTP 形态）" style="margin-top:12px">
            <EntryEditor v-for="(e, i) in model.add_ingress" :key="i" :entry="e" @remove="removeIngress(i)" />
            <a-button style="margin-top:8px" @click="addIngress">添加 ingress</a-button>
          </a-card>
        </a-form>
      </a-tab-pane>
      <a-tab-pane key="raw" tab="原始 JSON" force-render>
        <a-space style="margin-bottom:8px">
          <a-button type="primary" @click="applyRaw">应用回填表单</a-button>
          <span style="color:var(--text-secondary)">编辑后点"应用"回填；未结构化字段（RA 等）在此编辑不丢；add_egress 与 ohttp 会被丢弃并由锁定值替代。</span>
        </a-space>
        <a-textarea v-model:value="rawEditing" :rows="18" class="json-editor" autocapitalize="off" autocorrect="off" spellcheck="false" />
      </a-tab-pane>
    </a-tabs>

    <!-- 客户端信息 -->
    <a-card title="客户端信息" class="client-info-card">
      <a-descriptions :column="2" bordered>
        <a-descriptions-item label="客户端版本">{{ clientVersion }}</a-descriptions-item>
        <a-descriptions-item label="操作系统">{{ clientOs }}</a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>
