<script setup lang="ts">
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import { defaultFields } from "../formspec";
import { parse } from "../configmodel";
import { launchTng, pickImportPath, pickExportPath, importConfig, exportConfig } from "../tauri";
import EntryEditor from "../components/EntryEditor.vue";
import { useTngConfig } from "../composables/useTngConfig";
import { useInferenceConfig } from "../composables/useInferenceConfig";

// TNG 配置 model 由共享 composable 管理（全景/概览/设置共用同一份内存态）
const { model, isDirty, markSaved, serializeCurrent } = useTngConfig();
// 密态推理凭据（不持久化，仅本会话）
const { model: inferenceModel, apiKey } = useInferenceConfig();

const activeTab = ref<"form" | "raw">("form");
const rawEditing = ref(serializeCurrent());

function syncRaw() {
  rawEditing.value = serializeCurrent();
}

function onTabChange(key: string | number) {
  if (key === "raw") syncRaw();
  activeTab.value = key as "form" | "raw";
}

function applyRaw() {
  const r = parse(rawEditing.value);
  if (r.error) {
    message.error("JSON 错误，未回填: " + r.error);
    return;
  }
  model.value = r.model!;
  message.success("已按原始 JSON 回填表单");
}

function addIngress() {
  model.value.add_ingress.push({
    mode: "mapping",
    fields: defaultFields("mapping"),
    no_ra: true,
    extra: {},
  });
}
function addEgress() {
  model.value.add_egress.push({
    mode: "mapping",
    fields: defaultFields("mapping"),
    no_ra: true,
    extra: {},
  });
}
function removeIngress(i: number) {
  model.value.add_ingress.splice(i, 1);
}
function removeEgress(i: number) {
  model.value.add_egress.splice(i, 1);
}

async function onSaveConfig() {
  if (!isDirty()) {
    message.info("配置未变");
    return;
  }
  const json = serializeCurrent();
  try {
    const status = await invoke<{ reachable: boolean }>("get_status");
    if (status.reachable) {
      await invoke("launch_tng", { configJson: json });
      message.success("已保存并重启 tng");
    } else {
      await invoke("save_config", { configJson: json });
      message.success("已保存");
    }
    markSaved();
  } catch (e) {
    message.error("保存失败: " + String(e));
  }
}

async function onImport() {
  try {
    const path = await pickImportPath();
    if (!path) return;
    const json = await importConfig(path);
    const r = parse(json);
    if (r.error) {
      message.error("导入失败，当前配置未改: " + r.error);
      return;
    }
    model.value = r.model!;
    syncRaw();
    message.success("已导入并回填");
  } catch (e) {
    message.error("导入出错: " + String(e));
  }
}

async function onExport() {
  try {
    const path = await pickExportPath();
    if (!path) return;
    await exportConfig(path, serializeCurrent());
    message.success("已导出: " + path);
  } catch (e) {
    message.error("导出失败: " + String(e));
  }
}

// 表单编辑时，若 raw 视图已打开则同步
watch(
  () => model.value,
  () => {
    if (activeTab.value === "raw") syncRaw();
  },
  { deep: true }
);
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 12px; height: 100%">
    <a-space wrap>
      <a-button type="primary" @click="onSaveConfig">保存</a-button>
      <a-button @click="onImport">导入 JSON</a-button>
      <a-button @click="onExport">导出 JSON</a-button>
    </a-space>

    <a-tabs v-model:activeKey="activeTab" @change="onTabChange" style="flex: 1; overflow: auto">
      <a-tab-pane key="form" tab="结构化">
        <a-form layout="vertical">
          <a-card size="small" title="control_interface（host 强制 127.0.0.1）">
            <a-form-item label="restful.host">
              <a-input :value="model.control_interface.restful.host" disabled />
            </a-form-item>
            <a-form-item label="restful.port" required>
              <a-input-number
                v-model:value="model.control_interface.restful.port"
                :min="1"
                :max="65535"
                style="width: 100%"
              />
            </a-form-item>
          </a-card>

          <a-card size="small" title="add_ingress" style="margin-top: 12px">
            <EntryEditor
              v-for="(e, i) in model.add_ingress"
              :key="i"
              :entry="e"
              kind="ingress"
              @remove="removeIngress(i)"
            />
            <a-button style="margin-top: 8px" @click="addIngress">添加 ingress</a-button>
          </a-card>

          <a-card size="small" title="add_egress" style="margin-top: 12px">
            <EntryEditor
              v-for="(e, i) in model.add_egress"
              :key="i"
              :entry="e"
              kind="egress"
              @remove="removeEgress(i)"
            />
            <a-button style="margin-top: 8px" @click="addEgress">添加 egress</a-button>
          </a-card>

          <a-card
            size="small"
            title="密态推理（model + API Key，直接填写，不持久化）"
            style="margin-top: 12px"
          >
            <a-form-item label="Model">
              <a-input v-model:value="inferenceModel" placeholder="如 gpt-4 / vllm-model" />
            </a-form-item>
            <a-form-item label="API Key">
              <a-input-password v-model:value="apiKey" placeholder="推理 API Key（仅本会话使用）" />
            </a-form-item>
          </a-card>
        </a-form>
      </a-tab-pane>

      <a-tab-pane key="raw" tab="原始 JSON" force-render>
        <a-space style="margin-bottom: 8px">
          <a-button type="primary" @click="applyRaw">应用回填表单</a-button>
          <span style="color: #888">编辑后点"应用"回填；未结构化字段（RA 等）在此编辑不丢。</span>
        </a-space>
        <a-textarea
          v-model:value="rawEditing"
          :rows="24"
          style="font-family: monospace"
        />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>