<script setup lang="ts">
defineProps<{ icon?: any; title: string; description: string; tag: string }>();
</script>
<template>
  <div class="protection-item">
    <div class="protection-icon"><component :is="icon" v-if="icon" /></div>
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>{{ title }}</strong>
        <a-tag color="blue" :bordered="false">{{ tag }}</a-tag>
      </div>
      <div class="small-text" style="color:var(--text-secondary);font-size:12px;margin-top:5px;line-height:1.6">
        {{ description }}
      </div>
    </div>
  </div>
</template>