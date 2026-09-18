<script setup lang="ts">
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
        label="RVS 地址"
        extra="启动远程证明版 TNG 时通过 RATS_TEE_VERIFIER_URL 环境变量使用；该地址写入设置缓存，不写入 tng 配置 JSON。"
      >
        <a-input
          :value="value"
          :disabled="disabled"
          placeholder="https://rvs.tsk.com"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          @update:value="emit('update:value', $event)"
        />
      </a-form-item>
    </a-form>
  </a-card>
</template>
