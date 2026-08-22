<script setup lang="ts">
import { ref, watch } from "vue";
import { message } from "ant-design-vue";
import {
  defaultModel,
  defaultFields,
  type ConfigModel,
  type EntryModel,
} from "../formspec";
import { serialize, parse } from "../configmodel";
import {
  launchTng,
  pickImportPath,
  pickExportPath,
  importConfig,
  exportConfig,
} from "../tauri";
import EntryEditor from "../components/EntryEditor.vue";

// 不持久化：每次进入即默认模板
const model = ref<ConfigModel>(defaultModel());

const activeTab = ref<"form" | "raw">("form");
const rawEditing = ref(serialize(model.value));
const launching = ref(false);

function syncRaw() {
  rawEditing.value = serialize(model.value);
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

async function onLaunch() {
  launching.value = true;
  try {
    await launchTng(serialize(model.value));
    message.success("已拉起 tng（启动/重启）");
  } catch (e) {
    message.error("启动失败: " + String(e));
  } finally {
    launching.value = false;
  }
}

async function onImport() {
  try {
    const path = await pickImportPath();
    if (!path) return; // 取消
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
    if (!path) return; // 取消
    await exportConfig(path, serialize(model.value));
    message.success("已导出: " + path);
  } catch (e) {
    message.error("导出失败: " + String(e));
  }
}

// 表单编辑时，若 raw 视图已打开则同步（便于观察），但不覆盖用户在 raw 的未应用编辑
watch(
  () => model.value,
  () => {
    if (activeTab.value === "raw") syncRaw();
  },
  { deep: true },
);
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 12px; height: 100%">
    <a-space wrap>
      <a-button type="primary" :loading="launching" @click="onLaunch">启动 / 重启</a-button>
      <a-button @click="onImport">导入 JSON</a-button>
      <a-button @click="onExport">导出 JSON</a-button>
    </a-space>

    <a-tabs v-model:activeKey="activeTab" @change="onTabChange" style="flex: 1; overflow: auto">
      <!-- 结构化表单 -->
      <a-tab-pane key="form" tab="结构化">
        <a-form layout="vertical">
          <a-card size="small" title="control_interface（GUI 私有，host 强制 127.0.0.1）">
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
        </a-form>
      </a-tab-pane>

      <!-- 原始 JSON -->
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