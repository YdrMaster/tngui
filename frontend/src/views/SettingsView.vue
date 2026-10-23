<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  ApiOutlined, ExperimentOutlined, ImportOutlined, ExportOutlined,
} from "@ant-design/icons-vue";
import { isRemoteAttestationEnabled } from "../formspec";
import { parse } from "../configmodel";
import {
  pickLogPath, exportTngLog, pickImportPath, pickExportPath,
  importConfig, exportConfig, appInfo,
} from "../tauri";
import EntryEditor from "../components/EntryEditor.vue";
import RemoteAttestationServiceConfig from "../components/RemoteAttestationServiceConfig.vue";
import IngressStateCard from "../components/IngressStateCard.vue";
import RemoteReportExportAction from "../components/RemoteReportExportAction.vue";
import { useTngConfig } from "../composables/useTngConfig";
import { useIngressState } from "../composables/useIngressState";
import { deriveGatewayStateViews } from "../ingressStateViews";
import { useInferenceConfig } from "../composables/useInferenceConfig";
import { useCacheSaltConfig } from "../composables/useCacheSaltConfig";
import {
  MAX_REFRESH_MINUTES,
  MIN_REFRESH_MINUTES,
  normalizeRefreshMinutes,
  randomSaltValue,
  type CacheSaltSettings,
} from "../cacheSaltConfig";

const { model, isDirty, markSaved, serializeCurrent } = useTngConfig();
const { apiKey } = useInferenceConfig();
const { cacheSalt, updateCacheSalt } = useCacheSaltConfig();

// 盐配置改动即时下发反代：不进 TNG dirty，不触发保存或重启。
function commitCacheSalt(patch: Partial<CacheSaltSettings>) {
  void updateCacheSalt({ ...cacheSalt.value, ...patch });
}
const saltMode = computed({
  get: () => cacheSalt.value.mode,
  set: (mode: CacheSaltSettings["mode"]) => commitCacheSalt({ mode }),
});
const saltRefreshMinutes = computed({
  get: () => cacheSalt.value.refreshMinutes,
  set: (value: number | null) =>
    commitCacheSalt({ refreshMinutes: normalizeRefreshMinutes(value) }),
});
const saltFixedValue = computed({
  get: () => cacheSalt.value.fixedValue,
  set: (value: string) => commitCacheSalt({ fixedValue: value }),
});
const saltOverwrite = computed({
  get: () => cacheSalt.value.overwrite,
  set: (value: boolean) => commitCacheSalt({ overwrite: value }),
});
function generateSaltValue() {
  commitCacheSalt({ fixedValue: randomSaltValue() });
}
const { ingressKeys, states } = useIngressState();
const gatewayViews = computed(() => deriveGatewayStateViews(states.value));
const showRemoteAttestationServiceConfig = computed(() => isRemoteAttestationEnabled(model.value));
const activeTab = ref<"form" | "raw">("form");
const rawEditing = ref(serializeCurrent());
const configLocked = ref(true);
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
        >
          <template #actions>
            <RemoteReportExportAction :report="ingressKeys" />
          </template>
        </IngressStateCard>
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

        <div style="height:1px;background:var(--border-subtle,#f0f0f0);margin:2px 0 16px"></div>

        <a-form-item label="缓存盐模式">
          <a-radio-group v-model:value="saltMode" button-style="solid" data-test="salt-mode">
            <a-radio-button value="off">关闭</a-radio-button>
            <a-radio-button value="fixed">固定值</a-radio-button>
            <a-radio-button value="auto">定时刷新</a-radio-button>
          </a-radio-group>
          <div class="small-text" style="color:var(--text-secondary);margin-top:6px">
            cache_salt 会作为顶层字段注入三类推理请求体做缓存隔离；只进请求体，不进请求头、日志与诊断。
          </div>
        </a-form-item>

        <a-form-item v-if="saltMode === 'auto'" label="刷新周期">
          <a-input-number
            v-model:value="saltRefreshMinutes"
            data-test="salt-refresh-minutes"
            :min="MIN_REFRESH_MINUTES"
            :max="MAX_REFRESH_MINUTES"
            :step="1"
            style="width:200px"
          />
          <span class="small-text" style="color:var(--text-secondary);margin-left:8px">分钟，到点后自动换新随机盐</span>
        </a-form-item>

        <a-form-item v-else-if="saltMode === 'fixed'" label="盐值">
          <a-input-group compact>
            <a-input
              v-model:value="saltFixedValue"
              data-test="salt-fixed-value"
              placeholder="固定盐值"
              style="width:320px"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
            />
            <a-button data-test="salt-generate" @click="generateSaltValue">生成随机值</a-button>
          </a-input-group>
        </a-form-item>

        <a-form-item label="覆盖已有 cache_salt">
          <a-switch v-model:checked="saltOverwrite" data-test="salt-overwrite" :disabled="saltMode === 'off'" />
          <span class="small-text" style="color:var(--text-secondary);margin-left:8px">
            默认关闭：请求体里已有 cache_salt 时保留原值。
          </span>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- TNG 配置 -->
    <div class="settings-section-heading" style="margin-top:20px">
      <div><h4 style="margin:0 0 3px;font-size:16px;font-weight:600">TNG 配置</h4><span style="color:var(--text-secondary)">结构化编辑客户端 ingress（锁定 OHTTP 形态）；本机不承载 egress。</span></div>
      <span style="display:flex;gap:14px;align-items:center">
        <span style="display:flex;gap:8px;align-items:center">
          <a-switch v-model:checked="configLocked" aria-label="锁定 TNG 配置" />
          <span style="color:var(--text-secondary);font-size:13px;white-space:nowrap">配置锁定</span>
        </span>
        <a-button @click="onImport"><ImportOutlined /> 导入 JSON</a-button>
        <a-button @click="onExport"><ExportOutlined /> 导出 JSON</a-button>
      </span>
    </div>

    <a-tabs v-model:activeKey="activeTab" @change="onTabChange">
      <a-tab-pane key="form" tab="结构化">
        <a-form layout="vertical">
          <EntryEditor :entry="model.ingress" :disabled="configLocked" />
        </a-form>
      </a-tab-pane>
      <a-tab-pane key="raw" tab="原始 JSON" force-render>
        <a-space style="margin-bottom:8px">
          <a-button type="primary" :disabled="configLocked" @click="applyRaw">应用回填表单</a-button>
          <span style="color:var(--text-secondary)">编辑后点"应用"回填；未结构化字段（RA 等）在此编辑不丢；add_egress 与 ohttp 会被丢弃并由锁定值替代。</span>
        </a-space>
        <a-textarea v-model:value="rawEditing" :disabled="configLocked" :rows="18" class="json-editor" autocapitalize="off" autocorrect="off" spellcheck="false" />
      </a-tab-pane>
    </a-tabs>

    <RemoteAttestationServiceConfig
      v-model:value="model.rvsUrl"
      :visible="showRemoteAttestationServiceConfig"
      :disabled="configLocked"
    />

    <!-- 客户端信息 -->
    <a-card title="客户端信息" class="client-info-card">
      <a-descriptions :column="2" bordered>
        <a-descriptions-item label="客户端版本">{{ clientVersion }}</a-descriptions-item>
        <a-descriptions-item label="操作系统">{{ clientOs }}</a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>
