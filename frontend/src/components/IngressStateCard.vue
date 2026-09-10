<script setup lang="ts">
defineProps<{
  title: string;
  state?: "ok" | "warn" | "err" | "neutral";
  stateText?: string;
  subtitle?: string;
}>();
</script>

<template>
  <div :class="['ingress-card', state ? `ingress-card-${state}` : '']">
    <div class="ingress-card-body">
      <div class="ingress-card-title">
        <b>{{ title }}</b>
      </div>
      <div v-if="stateText" class="ingress-state-line">
        <span :class="['ingress-state-dot', state ? `ingress-dot-${state}` : '']" />
        <b class="ingress-state-text">{{ stateText }}</b>
      </div>
      <div v-if="subtitle" class="ingress-state-sub">{{ subtitle }}</div>
      <slot name="info" />
    </div>
  </div>
</template>
