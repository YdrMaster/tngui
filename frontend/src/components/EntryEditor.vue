<script setup lang="ts">
import { computed } from "vue";
import { Modal } from "ant-design-vue";
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

function onRemTypeChange(val: string | number) {
  const next = String(val) as IngressMode;
  if (next === props.entry.mode) return;
  Modal.confirm({
    title: "切换远端类型将重置该条字段",
    content: `确认从 ${props.entry.mode} 切到 ${next}？ohttp（常开）与 no_ra/verify 保留。`,
    onOk: () => {
      props.entry.mode = next;
      props.entry.fields = defaultFields(next);
    },
  });
}
</script>

<template>
  <a-card size="small" :title="'ingress · ' + entry.mode">
    <template #extra>
      <a-button size="small" danger @click="emit('remove')">删除</a-button>
    </template>

    <a-space style="margin-bottom: 8px" wrap>
      <span>远端类型：</span>
      <a-select
        :value="entry.mode"
        style="width: 180px"
        :options="remoteTypeOptions"
        @update:value="onRemTypeChange"
      />
      <span>no_ra：</span>
      <a-switch v-model:checked="entry.no_ra" />
    </a-space>

    <a-form layout="vertical">
      <FieldRenderer :fields="listenFields" :spec="listenSpec" />
      <FieldRenderer :fields="remoteFields" :spec="remoteSpec" />
      <FieldRenderer
        v-if="!entry.no_ra"
        :fields="verifyFields"
        :spec="{ key: 'verify', label: 'verify（model / as_provider，默认 passport / tpm）', type: 'verifyFields' }"
      />
    </a-form>
  </a-card>
</template>
