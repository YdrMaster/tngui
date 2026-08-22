<script setup lang="ts">
import { ref } from "vue";
import Home from "./views/Home.vue";
import Config from "./views/Config.vue";

type View = "home" | "config";
const view = ref<View>("home");
function onMenuClick(e: { key: string }) {
  view.value = e.key as View;
}
</script>

<template>
  <a-layout style="height: 100vh">
    <a-layout-sider width="160" theme="light">
      <div style="padding: 16px; font-weight: 600">TNG GUI</div>
      <a-menu :selectedKeys="[view]" mode="inline" @click="onMenuClick">
        <a-menu-item key="home">首页</a-menu-item>
        <a-menu-item key="config">配置</a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout-content style="padding: 16px; overflow: auto">
      <Home v-if="view === 'home'" />
      <Config v-else />
    </a-layout-content>
  </a-layout>
</template>