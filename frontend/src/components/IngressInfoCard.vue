<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <div class="ingress-card ingress-card-info">
    <div class="ingress-card-body">
      <div class="ingress-card-title">
        <b>{{ title }}</b>
      </div>
      <div class="ingress-state-line">
        <span class="ingress-state-dot ingress-dot-neutral" />
        <b class="ingress-state-text">仅配置摘要</b>
      </div>
      <div class="ingress-info-list">
        <slot name="rows" />
      </div>
    </div>
  </div>
</template>
