<script setup lang="ts">
import { computed } from "vue";
import {
  INGRESS_FIELDS,
  defaultFields,
  DEFAULT_VERIFY,
  DEFAULT_MAPPING_OUT_PORT,
  DEFAULT_LISTEN_PORT,
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

const remoteSpec = computed(() => INGRESS_FIELDS[props.entry.mode][1]);

function ensureMappingRule() {
  const rules = Array.isArray(props.entry.fields.rules) ? props.entry.fields.rules : [];
  const ok = rules.some((r) => r && typeof r.in === "object" && typeof r.out === "object");
  if (!ok) {
    props.entry.fields.rules = [
      { in: { host: LOCALHOST, port: DEFAULT_LISTEN_PORT }, out: { host: "", port: DEFAULT_MAPPING_OUT_PORT } },
    ];
  }
}
function ensureProxyListen() {
  const pl = props.entry.fields.proxy_listen;
  if (typeof pl !== "object" || pl === null) props.entry.fields.proxy_listen = { host: LOCALHOST, port: DEFAULT_LISTEN_PORT };
}
function ensureDstFilters() {
  const df = props.entry.fields.dst_filters;
  if (Array.isArray(df)) {
    const d0 = typeof df[0] === "object" && df[0] !== null ? (df[0] as Record<string, any>) : {};
    props.entry.fields.dst_filters = {
      domain: typeof d0.domain === "string" ? d0.domain : "",
      port: typeof d0.port === "number" ? d0.port : 0,
    };
    return;
  }
  if (typeof df !== "object" || df === null) props.entry.fields.dst_filters = { domain: "https://", port: 0 };
}

// 锁定形态的嵌套子对象（供 FieldRenderer 绑定 remote / verify）
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

// 行1：反代对外绑定——host 在 127.0.0.1/0.0.0.0 间 toggle（off=仅本机、on=对外网卡）+ 对外 port。
const outwardExternal = computed<boolean>({
  get: () => props.entry.outward.host === "0.0.0.0",
  set: (v: boolean) => {
    props.entry.outward.host = v ? "0.0.0.0" : "127.0.0.1";
  },
});

// 远程证明开关表示 "ra"（是否启用远程证明）：开=ra/`no_ra=false` 渲染 verify；关=`no_ra=true` 仅开关。
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
      <!-- 行1：本机端口 / 反代对外绑定（host toggle + 对外 port）独立成行 -->
      <a-form-item label="本机端口（反代对外绑定）">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <a-switch
            v-model:checked="outwardExternal"
            checked-children="0.0.0.0"
            un-checked-children="127.0.0.1"
          />
          <a-input-number
            v-model:value="entry.outward.port"
            :min="1"
            :max="65535"
            style="width:112px"
            placeholder="端口"
          />
          <span style="color:var(--text-secondary);font-size:12px">{{
            outwardExternal ? "对外网卡（0.0.0.0，须在受信网络下使用）" : "仅本机访问（127.0.0.1）"
          }}</span>
        </div>
      </a-form-item>

      <!-- 行2：远端类型 + 当前远端字段 同一横排 -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">
        <div style="flex:0 0 150px;max-width:150px">
          <a-form-item label="远端类型">
            <a-select
              :value="entry.mode"
              style="width:100%"
              :options="remoteTypeOptions"
              @update:value="onRemTypeChange"
            />
          </a-form-item>
        </div>
        <div style="flex:1;min-width:220px">
          <FieldRenderer :fields="remoteFields" :spec="remoteSpec" />
        </div>
      </div>

      <!-- 行3：远程证明开关（表示 ra）+ verify 配置 同一横排（开关开=no_ra=false 渲染 verify） -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">
        <div style="flex:0 0 118px;max-width:118px">
          <a-form-item label="远程证明">
            <a-switch v-model:checked="raEnabled" />
          </a-form-item>
        </div>
        <div v-if="raEnabled" style="flex:1;min-width:220px">
          <FieldRenderer
            :fields="verifyFields"
            :spec="{ key: 'verify', label: 'verify（model / as_provider，默认 passport / tpm）', type: 'verifyFields' }"
          />
        </div>
      </div>
    </a-form>
  </a-card>
</template>
