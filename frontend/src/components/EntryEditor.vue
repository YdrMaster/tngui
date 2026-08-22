<script setup lang="ts">
import { computed } from "vue";
import { Modal } from "ant-design-vue";
import {
  INGRESS_MODES,
  EGRESS_MODES,
  INGRESS_FIELDS,
  EGRESS_FIELDS,
  defaultFields,
  type EntryModel,
  type IngressMode,
  type EgressMode,
} from "../formspec";
import FieldRenderer from "./FieldRenderer.vue";

const props = defineProps<{ entry: EntryModel; kind: "ingress" | "egress" }>();
const emit = defineEmits<{ remove: [] }>();

const modes = computed(() => (props.kind === "ingress" ? INGRESS_MODES : EGRESS_MODES));
const fieldSpecs = computed(() =>
  props.kind === "ingress"
    ? INGRESS_FIELDS[props.entry.mode as IngressMode]
    : EGRESS_FIELDS[props.entry.mode as EgressMode],
);

function onModeChange(val: string | number) {
  const next = String(val);
  Modal.confirm({
    title: "切换模式将重置该条字段",
    content: `确认从 ${props.entry.mode} 切到 ${next}？未结构化字段（RA/ohttp 等）保留。`,
    onOk: () => {
      props.entry.mode = next;
      props.entry.fields = defaultFields(next);
    },
  });
}

// extra（RA/ohttp/rats_tls/quic 等）以原始 JSON 编辑，往返不丢。
const extraJson = computed({
  get: () => JSON.stringify(props.entry.extra ?? {}, null, 2),
  set: (v: string) => {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        props.entry.extra = parsed;
      }
    } catch {
      // 编辑中途非法，暂不写回，直到合法
    }
  },
});
</script>

<template>
  <a-card size="small" :title="kind + ' · ' + entry.mode">
    <template #extra>
      <a-button size="small" danger @click="emit('remove')">删除</a-button>
    </template>

    <a-space style="margin-bottom: 8px" wrap>
      <span>模式：</span>
      <a-select
        :value="entry.mode"
        style="width: 150px"
        :options="modes.map((m) => ({ value: m, label: m }))"
        @update:value="onModeChange"
      />
      <span>no_ra：</span>
      <a-switch v-model:checked="entry.no_ra" />
    </a-space>

    <a-form layout="vertical">
      <FieldRenderer
        v-for="f in fieldSpecs"
        :key="f.key"
        :fields="entry.fields"
        :spec="f"
      />
    </a-form>

    <a-collapse>
      <a-collapse-panel header="高级（原始 JSON：ohttp / rats_tls / quic / RA attest·verify 等）">
        <a-textarea v-model:value="extraJson" :rows="8" style="font-family: monospace" />
      </a-collapse-panel>
    </a-collapse>
  </a-card>
</template>