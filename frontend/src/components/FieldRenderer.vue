<script setup lang="ts">
import { LOCALHOST, PORT_MAX, PORT_MIN, type FieldSpec } from "../formspec";
import PortInput from "./PortInput.vue";
const props = withDefaults(
  defineProps<{ fields: Record<string, any>; spec: FieldSpec; disabled?: boolean }>(),
  { disabled: false },
);

/** http_proxy 域名 / 主机名输入统一扣首尾空白；字符串内部字符与大小写保持原样。 */
function updateDomain(value: string): void {
  props.fields.domain = value.trim();
}
</script>

<template>
  <a-form-item :label="spec.label" :required="spec.required">
    <!-- 本地监听：host 只读 127.0.0.1 + port 可编辑 -->
    <a-input-group v-if="spec.type === 'listenHostPort'" compact>
      <a-input :value="LOCALHOST" disabled style="width: calc(100% - 112px); color: var(--text-secondary)" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <a-input-number v-model:value="fields.port" :disabled="disabled" :min="PORT_MIN" :max="PORT_MAX" :precision="0" style="width: 112px" placeholder="端口" />
    </a-input-group>

    <!-- 远端地址端口：host(IP) + port -->
    <a-input-group v-else-if="spec.type === 'outHostPort'" compact>
      <a-input v-model:value="fields.host" :disabled="disabled" style="width: calc(100% - 112px)" placeholder="远端 IP（按 TNG 约束须为 IP）" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <PortInput v-model="fields.port" required :disabled="disabled" width="112px" placeholder="远端端口（必填）" />
    </a-input-group>

    <!-- 远端域名端口：主机名(domain) + 端口，分两控件、主机名不含端口 -->
    <a-input-group v-else-if="spec.type === 'domainHostPort'" compact>
      <a-input :value="fields.domain" :disabled="disabled" style="width: calc(100% - 112px)" placeholder="如 https://inference.cloud.misuan.com（http:// 或 https:// 前缀决定 TLS）" autocapitalize="off" autocorrect="off" spellcheck="false" @update:value="updateDomain" />
      <PortInput v-model="fields.port" :disabled="disabled" width="112px" placeholder="远端端口（可留空）" />
    </a-input-group>
  </a-form-item>
</template>
