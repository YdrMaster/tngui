<script setup lang="ts">
import type { FieldSpec } from "../formspec";

const props = defineProps<{ fields: Record<string, any>; spec: FieldSpec }>();

// 确保容器存在
function ensure<T>(def: T): T {
  if (props.fields[props.spec.key] === undefined || props.fields[props.spec.key] === null) {
    props.fields[props.spec.key] = def;
  }
  return props.fields[props.spec.key] as T;
}
function asEndpoint() {
  return ensure({ host: "", port: 0 });
}
function asList<T>(): T[] {
  return ensure<T[]>([]);
}

function addRule() {
  asList<any>().push({ in: { port: 0 }, out: { host: "127.0.0.1", port: 0 } });
}
function addFilter() {
  asList<any>().push({ host: "", port: undefined, port_end: undefined });
}
function addCapture() {
  asList<any>().push({ host: "", ipset: "", port: undefined, port_end: undefined });
}
function addIntercept() {
  asList<any>().push({ host: "", ifname: "", port: undefined, port_end: undefined, redirect_to_port: undefined });
}
function addString() {
  asList<string>().push("");
}
function removeAt(arr: any[], i: number) {
  arr.splice(i, 1);
}
</script>

<template>
  <a-form-item :label="spec.label" :required="spec.required">
    <!-- number -->
    <a-input-number
      v-if="spec.type === 'number'"
      v-model:value="fields[spec.key]"
      style="width: 100%"
      placeholder="可选"
    />

    <!-- text -->
    <a-input v-else-if="spec.type === 'text'" v-model:value="fields[spec.key]" />

    <!-- bool -->
    <a-switch v-else-if="spec.type === 'bool'" v-model:checked="fields[spec.key]" />

    <!-- endpoint: host + port -->
    <a-input-group v-else-if="spec.type === 'endpoint'" compact>
      <a-input
        v-model:value="asEndpoint().host"
        style="width: calc(100% - 110px)"
        placeholder="host（可省）"
      />
      <a-input-number v-model:value="asEndpoint().port" style="width: 110px" placeholder="port" />
    </a-input-group>

    <!-- stringList -->
    <div v-else-if="spec.type === 'stringList'">
      <div v-for="(item, i) in asList<string>()" :key="i" class="field-row">
        <a-input v-model:value="asList<string>()[i]" style="flex: 1; min-width: 200px" />
        <a-button danger @click="removeAt(asList<string>(), i)">删</a-button>
      </div>
      <a-button @click="addString">添加</a-button>
    </div>

    <!-- ruleList（mapping rules：in / out） -->
    <div v-else-if="spec.type === 'ruleList'">
      <div v-for="(rule, i) in asList<any>()" :key="i" class="rule-row">
        <span class="lbl">in:</span>
        <a-input v-model:value="rule.in.host" style="width: 120px" placeholder="host可省" />
        <a-input-number v-model:value="rule.in.port" style="width: 90px" placeholder="port" />
        <a-input-number v-model:value="rule.in.port_end" style="width: 100px" placeholder="port_end" />
        <span class="lbl">→ out:</span>
        <a-input v-model:value="rule.out.host" style="width: 120px" placeholder="host" />
        <a-input-number v-model:value="rule.out.port" style="width: 90px" placeholder="port" />
        <a-input-number v-model:value="rule.out.port_end" style="width: 100px" placeholder="port_end" />
        <a-button danger @click="removeAt(asList<any>(), i)">删</a-button>
      </div>
      <a-button @click="addRule">添加规则</a-button>
    </div>

    <!-- filterList（dst_filters：host + port 范围） -->
    <div v-else-if="spec.type === 'filterList'">
      <div v-for="(f, i) in asList<any>()" :key="i" class="field-row">
        <a-input v-model:value="f.host" style="width: 180px" placeholder="domain/ip/cidr/正则/all" />
        <a-input-number v-model:value="f.port" style="width: 90px" placeholder="port" />
        <a-input-number v-model:value="f.port_end" style="width: 100px" placeholder="port_end" />
        <a-button danger @click="removeAt(asList<any>(), i)">删</a-button>
      </div>
      <a-button @click="addFilter">添加过滤</a-button>
    </div>

    <!-- captureList（netfilter/hook capture_dst：host|ipset + port 范围） -->
    <div v-else-if="spec.type === 'captureList'">
      <div v-for="(c, i) in asList<any>()" :key="i" class="field-row">
        <a-input v-model:value="c.host" style="width: 140px" placeholder="host(cidr)" />
        <a-input v-model:value="c.ipset" style="width: 140px" placeholder="ipset(二选一)" />
        <a-input-number v-model:value="c.port" style="width: 90px" placeholder="port" />
        <a-input-number v-model:value="c.port_end" style="width: 100px" placeholder="port_end" />
        <a-button danger @click="removeAt(asList<any>(), i)">删</a-button>
      </div>
      <a-button @click="addCapture">添加捕获</a-button>
    </div>

    <!-- interceptList（egress hook capture_listen） -->
    <div v-else-if="spec.type === 'interceptList'">
      <div v-for="(h, i) in asList<any>()" :key="i" class="field-row">
        <a-input v-model:value="h.host" style="width: 110px" placeholder="host" />
        <a-input v-model:value="h.ifname" style="width: 100px" placeholder="ifname" />
        <a-input-number v-model:value="h.port" style="width: 80px" placeholder="port" />
        <a-input-number v-model:value="h.port_end" style="width: 90px" placeholder="port_end" />
        <a-input-number v-model:value="h.redirect_to_port" style="width: 110px" placeholder="redirect" />
        <a-button danger @click="removeAt(asList<any>(), i)">删</a-button>
      </div>
      <a-button @click="addIntercept">添加拦截</a-button>
    </div>
  </a-form-item>
</template>

<style scoped>
/* 行内控件：flex 居中对齐，统一行高，避免 a-input / a-input-number / a-button 高度不一 */
.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.rule-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  border-left: 2px solid #444;
  padding-left: 8px;
}
.lbl {
  white-space: nowrap;
}
</style>