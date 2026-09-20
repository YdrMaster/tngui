<script setup lang="ts">
import { DEFAULT_RVS_URL } from "../formspec";
defineProps<{
  visible: boolean;
  value: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:value": [value: string];
}>();
</script>

<template>
  <a-card
    v-if="visible"
    size="small"
    title="远程证明服务配置"
    style="margin-top:12px"
  >
    <a-form layout="vertical">
      <a-form-item
        label="参考值服务地址"
      >
        <a-input
          :value="value"
          :disabled="disabled"
          :placeholder="DEFAULT_RVS_URL"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          @update:value="emit('update:value', $event)"
        />
      </a-form-item>
    </a-form>
  </a-card>
</template>
