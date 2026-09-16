<script setup lang="ts">
import { computed } from "vue";
import { CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons-vue';
import { secureSteps } from '../data/secureSteps';

const props = withDefaults(defineProps<{ activeIndex?: number }>(), { activeIndex: 4 });

const activeIndex = computed(() => Math.min(Math.max(props.activeIndex, 0), secureSteps.length - 1));
const stage = computed(() => secureSteps[activeIndex.value]);
</script>

<template>
  <div
    class="secure-flow"
    role="status"
    :aria-label="`已到达第 ${activeIndex + 1} / ${secureSteps.length} 阶段：${stage.title}`"
  >
    <div class="stage-dots" aria-hidden="true">
      <span
        v-for="(step, index) in secureSteps"
        :key="step.key"
        :class="[
          'stage-dot',
          index < activeIndex ? 'done' : '',
          index === activeIndex ? 'active' : '',
        ]"
      />
    </div>

    <div class="stage-viewport">
      <Transition name="stage-slide" mode="out-in">
        <div :key="stage.key" class="stage-card active">
          <div class="stage-card-icon">
            <CheckCircleOutlined v-if="activeIndex === secureSteps.length - 1" />
            <LoadingOutlined v-else />
          </div>
          <div class="stage-card-title">{{ stage.title }}</div>
          <p class="stage-card-desc">{{ stage.description }}</p>
        </div>
      </Transition>
    </div>
  </div>
</template>
