<script setup lang="ts">
import { computed } from "vue";
import {
  INGRESS_FIELDS,
  defaultFields,
  DEFAULT_MAPPING_OUT_PORT,
  DEFAULT_LISTEN_PORT,
  LOCALHOST,
  type EntryModel,
  type IngressMode,
} from "../formspec";
import FieldRenderer from "./FieldRenderer.vue";
import PortInput from "./PortInput.vue";

const props = withDefaults(defineProps<{ entry: EntryModel; disabled?: boolean }>(), { disabled: false });
const remoteTypeOptions = [
  { value: "mapping", label: "端点映射" },
  { value: "http_proxy", label: "域名代理" },
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
      port: typeof d0.port === "number" ? d0.port : null,
    };
    return;
  }
  if (typeof df !== "object" || df === null) props.entry.fields.dst_filters = { domain: "https://", port: null };
}

// 锁定形态的嵌套子对象（供 FieldRenderer 绑定 remote 字段）。
const remoteFields = computed<Record<string, any>>(() => {
  if (props.entry.mode === "mapping") {
    ensureMappingRule();
    return (props.entry.fields.rules as Record<string, any>[])[0].out;
  }
  ensureDstFilters();
  return props.entry.fields.dst_filters as Record<string, any>;
});
// 行1：反代对外绑定——host 在 127.0.0.1/0.0.0.0 间 toggle（off=仅本机、on=对外网卡）+ 对外 port。
const outwardExternal = computed<boolean>({
  get: () => props.entry.outward.host === "0.0.0.0",
  set: (v: boolean) => {
    props.entry.outward.host = v ? "0.0.0.0" : "127.0.0.1";
  },
});

// 远程证明开关表示 "ra"（是否启用远程证明）：开=ra/`no_ra=false`；关=`no_ra=true`。
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
  <a-card size="small" title="入口配置">
    <template #extra>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:12px;color:var(--text-secondary);white-space:nowrap">远程证明</span>
        <a-switch v-model:checked="raEnabled" :disabled="disabled" aria-label="远程证明" />
      </div>
    </template>

    <a-form layout="vertical">
      <!-- 行1：本机端口 / 反代对外绑定（host toggle + 对外 port）独立成行 -->
      <a-form-item label="本机端口（反代对外绑定）">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <a-switch
            v-model:checked="outwardExternal"
            :disabled="disabled"
            checked-children="0.0.0.0"
            un-checked-children="127.0.0.1"
          />
          <PortInput
            v-model="entry.outward.port"
            required
            :disabled="disabled"
            width="112px"
            placeholder="端口（必填）"
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
              :disabled="disabled"
              @update:value="onRemTypeChange"
            />
          </a-form-item>
        </div>
        <div style="flex:1;min-width:220px">
          <FieldRenderer :fields="remoteFields" :spec="remoteSpec" :disabled="disabled" />
        </div>
      </div>

    </a-form>
  </a-card>
</template>
