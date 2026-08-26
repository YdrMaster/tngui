<script setup lang="ts">
import type { Component } from 'vue';
defineProps<{
  icon?: Component;
  label: string;
  value: string;
  detail: string;
  tone?: 'success' | 'processing' | 'error' | 'default';
  action?: any;
}>();
</script>
<template>
  <a-card :class="['status-card', `status-${tone || 'success'}`]" :bordered="false">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <span class="status-icon"><component :is="icon" v-if="icon" /></span>
        <div>
          <span style="color:var(--text-secondary);font-size:12px">{{ label }}</span>
          <div class="status-value">
            <a-badge :status="tone === 'default' ? 'default' : tone" />
            <strong>{{ value }}</strong>
          </div>
          <span class="small-text" style="color:var(--text-secondary);font-size:12px">{{ detail }}</span>
        </div>
      </div>
      <component :is="action" v-if="action" />
    </div>
  </a-card>
</template>