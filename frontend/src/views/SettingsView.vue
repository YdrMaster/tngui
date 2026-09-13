<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import {
  ApiOutlined, ExperimentOutlined, EyeOutlined, EyeInvisibleOutlined,
  ImportOutlined, ExportOutlined, CopyOutlined,
} from "@ant-design/icons-vue";
import { defaultFields } from "../formspec";
import { parse } from "../configmodel";
import { launchTng, pickImportPath, pickExportPath, importConfig, exportConfig } from "../tauri";
import EntryEditor from "../components/EntryEditor.vue";
import { useTngConfig } from "../composables/useTngConfig";
import { useInferenceConfig } from "../composables/useInferenceConfig";

const { model, isDirty, markSaved, serializeCurrent } = useTngConfig();
const { model: inferenceModel, apiKey } = useInferenceConfig();
const activeTab = ref<"form" | "raw">("form");
const rawEditing = ref(serializeCurrent());
const showKey = ref(false);
const tngReady = ref(true);
let statusTimer: number | undefined;

// 轮询 tng 状态
async function pollStatus() {
  try { const s = await invoke<{ ready: boolean }>("get_status"); tngReady.value = s.ready; }
  catch { tngReady.value = false; }
}
pollStatus();
statusTimer = window.setInterval(pollStatus, 2000);
if (typeof window !== "undefined") window.addEventListener("beforeunload", () => clearInterval(statusTimer));

// 本地 URL 取自结构化 ingress 的第一条监听端口（与 InferenceView 同源）
const localUrl = computed(() => {
  const e = model.value.add_ingress[0];
  if (!e) return "未配置 ingress";
  const port = e.mode === "mapping"
    ? (e.fields.rules as { in?: { port?: number } }[] | undefined)?.[0]?.in?.port
    : (e.fields.proxy_listen as { port?: number } | undefined)?.port;
  return port ? `http://127.0.0.1:${port}/v1` : "未配置端口";
});

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
    mode: "mapping", fields: defaultFields("mapping"), no_ra: false, verify: { model: "passport", as_provider: "tpm" }, extra: {},
  });
}
function removeIngress(i: number) { model.value.add_ingress.splice(i, 1); }

async function onSaveConfig() {
  if (!isDirty()) { message.info("配置未变"); return; }
  const json = serializeCurrent();
  try {
    const status = await invoke<{ reachable: boolean }>("get_status");
    if (status.reachable) { await invoke("launch_tng", { configJson: json }); message.success("已保存并重启 tng"); }
    else { await invoke("save_config", { configJson: json }); message.success("已保存"); }
    markSaved();
  } catch (e) { message.error("保存失败: " + String(e)); }
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
async function onRestart() {
  try { await invoke("launch_tng", { configJson: serializeCurrent() }); message.success("已重启并检测"); }
  catch (e) { message.error("重启失败: " + String(e)); }
}
function copyLocal() {
  navigator.clipboard?.writeText(localUrl.value);
  message.success("已复制 " + localUrl.value);
}
function clearFeature() {
  apiKey.value = "";
  inferenceModel.value = "";
  message.success("已清除本机推理凭据（model / API Key），中心侧 Key 不受影响");
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
      <a-row :gutter="[24, 16]" align="middle">
        <a-col :span="14">
          <a-row :gutter="[16, 16]">
            <a-col :span="8">
              <div class="gateway-state">
                <a-badge :status="tngReady ? 'success' : 'error'" />
                <div><strong>{{ tngReady ? "运行中" : "未运行" }}</strong><div style="color:var(--text-secondary)">TNG v0.2.1</div></div>
              </div>
            </a-col>
            <a-col :span="8">
              <div class="gateway-state">
                <a-badge :status="tngReady ? 'success' : 'error'" />
                <div><strong>{{ tngReady ? "已连接" : "已断开" }}</strong><div style="color:var(--text-secondary)">控制信道</div></div>
              </div>
            </a-col>
          </a-row>
        </a-col>
        <a-col :span="10" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end">
          <a-button @click="message.info('Mock: tng-gateway.log 已导出')">导出日志</a-button>
          <a-button @click="message.info('Mock: 诊断包 已导出')">导出诊断包</a-button>
        </a-col>
      </a-row>
    </a-card>

    <!-- 功能配置 -->
    <div class="settings-section-heading">
      <div><h4 style="margin:0 0 3px;font-size:16px;font-weight:600">功能配置</h4><span style="color:var(--text-secondary)">按需配置 TNG Gateway 承载的功能。</span></div>
      <a-tag color="blue">已启用 1 个功能</a-tag>
    </div>

    <!-- 密态推理 Feature Card：只保留 API Key / Model；本地端口与远端取自结构化 ingress -->
    <a-card class="feature-card">
      <template #title>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="feature-icon"><ExperimentOutlined /></div>
          <div><div style="font-weight:600">密态推理</div><div class="small-text" style="color:var(--text-secondary)">通过可信网关访问密态大模型服务</div></div>
        </div>
      </template>
      <template #extra><a-tag color="success">已启用</a-tag></template>
      <a-alert type="info" showIcon message="API Key 在中心侧管理，本机只保存使用凭据" description="申请、查看和重置在 1 号节点完成；重置后旧 Key 立即失效。本地端口与远端在下方「高级 TNG 配置」的结构化 ingress 中配置。" />
      <div class="connection-form" style="margin-top:24px">
        <a-form layout="vertical">
          <a-form-item label="API Key" required :validateStatus="apiKey ? 'success' : 'error'" :help="apiKey ? '凭据有效' : '请粘贴有效的 API Key'">
            <a-input size="large" v-model:value="apiKey" :type="showKey ? 'text' : 'password'">
              <template #prefix><ApiOutlined /></template>
              <template #suffix>
                <a-button type="text" size="small" @click="showKey = !showKey">
                  <EyeInvisibleOutlined v-if="showKey" /><EyeOutlined v-else />
                </a-button>
              </template>
            </a-input>
          </a-form-item>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span style="display:flex;gap:8px">
              <a-button type="primary" @click="onSaveConfig">保存并验证</a-button>
              <a-button @click="copyLocal"><CopyOutlined /> 复制本地 URL</a-button>
            </span>
            <span style="display:flex;gap:8px">
              <a-button @click="onImport"><ImportOutlined /> 导入配置</a-button>
              <a-button @click="onExport"><ExportOutlined /> 导出配置</a-button>
            </span>
          </div>
        </a-form>
        <a-form layout="vertical" style="margin-top:16px">
          <a-form-item label="Model（推理模型名，发送时用，不持久化）">
            <a-input v-model:value="inferenceModel" placeholder="如 gpt-4 / vllm-model" />
          </a-form-item>
        </a-form>
      </div>
      <a-divider />
      <div class="feature-danger" style="display:flex;justify-content:space-between;align-items:center;padding:2px 0 4px">
        <div><strong>清除本机推理凭据</strong><br><span style="color:var(--text-secondary)">移除本机 API Key 与 Model，中心侧 Key 不会被删除。</span></div>
        <a-button danger @click="clearFeature">清除本机凭据</a-button>
      </div>
    </a-card>

    <!-- 高级 TNG 配置 -->
    <div class="settings-section-heading" style="margin-top:24px">
      <div><h4 style="margin:0 0 3px;font-size:16px;font-weight:600">高级 TNG 配置</h4><span style="color:var(--text-secondary)">结构化编辑客户端 ingress（锁定 OHTTP 形态）；本机不承载 egress。</span></div>
      <span style="display:flex;gap:8px">
        <a-button type="primary" @click="onSaveConfig">保存</a-button>
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
        <a-textarea v-model:value="rawEditing" :rows="24" class="json-editor" />
      </a-tab-pane>
    </a-tabs>

    <!-- 客户端信息 -->
    <a-card title="客户端信息" class="client-info-card">
      <a-descriptions :column="3" bordered>
        <a-descriptions-item label="客户端版本">v0.2.1-dev</a-descriptions-item>
        <a-descriptions-item label="操作系统">Desktop</a-descriptions-item>
        <a-descriptions-item label="更新通道">稳定版(OTA)</a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>
