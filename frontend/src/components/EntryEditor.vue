<script setup lang="ts">
import { computed } from "vue";
import {
  INGRESS_FIELDS,
  defaultFields,
  DEFAULT_VERIFY,
  LOCALHOST,
  type EntryModel,
  type IngressMode,
} from "../formspec";
import FieldRenderer from "./FieldRenderer.vue";

const props = defineProps<{ entry: EntryModel }>();
const emit = defineEmits<{ remove: [] }>();

const remoteTypeOptions = [
  { value: "mapping", label: "地址端口 (mapping)" },
  { value: "http_proxy", label: "域名 (http_proxy)" },
];

const listenSpec = computed(() => INGRESS_FIELDS[props.entry.mode][0]);
const remoteSpec = computed(() => INGRESS_FIELDS[props.entry.mode][1]);

function ensureMappingRule() {
  const rules = Array.isArray(props.entry.fields.rules) ? props.entry.fields.rules : [];
  const ok = rules.some((r) => r && typeof r.in === "object" && typeof r.out === "object");
  if (!ok) {
    props.entry.fields.rules = [
      { in: { host: LOCALHOST, port: 18443 }, out: { host: "", port: 10000 } },
    ];
  }
}
function ensureProxyListen() {
  const pl = props.entry.fields.proxy_listen;
  if (typeof pl !== "object" || pl === null) props.entry.fields.proxy_listen = { host: LOCALHOST, port: 18443 };
}
function ensureDstFilters() {
  const df = props.entry.fields.dst_filters;
  if (typeof df !== "object" || df === null) props.entry.fields.dst_filters = { domain: "" };
}

// 锁定形态的嵌套子对象（供 FieldRenderer 绑定）
const listenFields = computed<Record<string, any>>(() => {
  if (props.entry.mode === "mapping") {
    ensureMappingRule();
    return (props.entry.fields.rules as Record<string, any>[])[0].in;
  }
  ensureProxyListen();
  return props.entry.fields.proxy_listen as Record<string, any>;
});
const remoteFields = computed<Record<string, any>>(() => {
  if (props.entry.mode === "mapping") {
    ensureMappingRule();
    return (props.entry.fields.rules as Record<string, any>[])[0].out;
  }
  ensureDstFilters();
  return props.entry.fields.dst_filters as Record<string, any>;
});
const verifyFields = computed<Record<string, any>>(() => {
  if (!props.entry.verify) props.entry.verify = { ...DEFAULT_VERIFY };
  return props.entry.verify;
});

// 远程证明开关表示 "ra"（是否启用远程证明）：开=ra/`no_ra=false` 渲染 verify；关=`no_ra=true` 仅开关。
// 底层仍存储 `no_ra`，开关经取反 computed 与其绑定。
const raEnabled = computed<boolean>({
  get: () => !props.entry.no_ra,
  set: (v: boolean) => {
    props.entry.no_ra = !v;
  },
});

function onRemTypeChange(val: string | number) {
  const next = String(val) as IngressMode;
  if (next === props.entry.mode) return;
  props.entry.mode = next;
  props.entry.fields = defaultFields(next);
}
</script>

<template>
  <a-card size="small" :title="'ingress · ' + entry.mode">
    <template #extra>
      <a-button size="small" danger @click="emit('remove')">删除</a-button>
    </template>

    <a-form layout="vertical">
      <!-- 行1：本地监听 独立成行 -->
      <FieldRenderer :fields="listenFields" :spec="listenSpec" />

      <!-- 行2：远端类型 + 当前远端字段 同一横排 -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">
        <div style="flex:0 0 180px;max-width:180px">
          <a-form-item label="远端类型">
            <a-select
              :value="entry.mode"
              style="width:100%"
              :options="remoteTypeOptions"
              @update:value="onRemTypeChange"
            />
          </a-form-item>
        </div>
        <div style="flex:1;min-width:240px">
          <FieldRenderer :fields="remoteFields" :spec="remoteSpec" />
        </div>
      </div>

      <!-- 行3：远程证明开关（表示 ra）+ verify 配置 同一横排（开关开=no_ra=false 渲染 verify） -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">
        <div style="flex:0 0 140px;max-width:140px">
          <a-form-item label="远程证明">
            <a-switch v-model:checked="raEnabled" />
          </a-form-item>
        </div>
        <div v-if="raEnabled" style="flex:1;min-width:340px">
          <FieldRenderer
            :fields="verifyFields"
            :spec="{ key: 'verify', label: 'verify（model / as_provider，默认 passport / tpm）', type: 'verifyFields' }"
          />
        </div>
      </div>
    </a-form>
  </a-card>
</template>
