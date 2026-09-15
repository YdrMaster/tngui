<script setup lang="ts">
import { LOCALHOST, type FieldSpec } from "../formspec";
const props = defineProps<{ fields: Record<string, any>; spec: FieldSpec }>();
</script>

<template>
  <a-form-item :label="spec.label" :required="spec.required">
    <!-- 本地监听：host 只读 127.0.0.1 + port 可编辑 -->
    <a-input-group v-if="spec.type === 'listenHostPort'" compact>
      <a-input :value="LOCALHOST" disabled style="width: calc(100% - 130px); color: var(--text-secondary)" />
      <a-input-number v-model:value="fields.port" style="width: 130px" placeholder="端口" />
    </a-input-group>

    <!-- 远端地址端口：host(IP) + port -->
    <a-input-group v-else-if="spec.type === 'outHostPort'" compact>
      <a-input v-model:value="fields.host" style="width: calc(100% - 130px)" placeholder="远端 IP（按 TNG 约束须为 IP）" />
      <a-input-number v-model:value="fields.port" style="width: 130px" placeholder="远端端口" />
    </a-input-group>

    <!-- 远端域名端口：主机名(domain) + 端口，分两控件、主机名不含端口 -->
    <a-input-group v-else-if="spec.type === 'domainHostPort'" compact>
      <a-input v-model:value="fields.domain" style="width: calc(100% - 130px)" placeholder="远端域名（主机名，如 inference.example.com）" />
      <a-input-number v-model:value="fields.port" style="width: 130px" placeholder="远端端口" />
    </a-input-group>

    <!-- verify：model + as_provider -->
    <a-space v-else-if="spec.type === 'verifyFields'" wrap>
      <a-input v-model:value="fields.model" style="width: 160px" placeholder="verify.model（默认 passport）" />
      <a-input v-model:value="fields.as_provider" style="width: 160px" placeholder="verify.as_provider（默认 tpm）" />
    </a-space>
  </a-form-item>
</template>
