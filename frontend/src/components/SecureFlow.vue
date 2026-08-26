<script setup lang="ts">
import { CheckCircleOutlined, LoadingOutlined, LockOutlined, StopOutlined } from '@ant-design/icons-vue';
import { secureSteps } from '../data/secureSteps';
const props = withDefaults(defineProps<{ activeIndex?: number; failed?: boolean }>(), { activeIndex: 4, failed: false });
</script>
<template>
  <div class="secure-flow">
    <template v-for="(step, index) in secureSteps" :key="step.key">
      <div class="flow-fragment">
        <div
          :class="['flow-node', index <= props.activeIndex ? 'active' : '', props.failed && index === 1 ? 'failed' : '']"
        >
          <div class="flow-node-icon">
            <StopOutlined v-if="props.failed && index === 1" />
            <CheckCircleOutlined v-else-if="index < props.activeIndex || (props.activeIndex === 4 && index === 4)" />
            <LoadingOutlined v-else-if="index === props.activeIndex" />
            <LockOutlined v-else />
          </div>
          <b>{{ step.shortTitle }}</b>
          <small>{{
            index === 0 || index === 4 ? '本机明文' : index === 2 ? '传输密文' : index === 3 ? 'TEE 内明文' : '先验证后连接'
          }}</small>
        </div>
        <div
          v-if="index < secureSteps.length - 1"
          :class="['flow-line', index >= 1 && index <= 3 ? 'encrypted' : '']"
        >
          <span v-if="index === 1">加密发送</span>
          <span v-else-if="index === 3">密文返回</span>
        </div>
      </div>
    </template>
  </div>
</template>