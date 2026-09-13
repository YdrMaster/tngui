<script setup lang="ts">
import { DesktopOutlined, SafetyCertificateOutlined, CloudServerOutlined, LockOutlined } from '@ant-design/icons-vue';
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
</script>
<template>
  <div :class="['architecture-flow', $props.compact ? 'compact' : '']">
    <div class="trust-zone client-zone">
      <div class="zone-heading">
        <span class="zone-icon"><DesktopOutlined /></span>
        <div><b>客户域</b><small>您控制的可信环境</small></div>
      </div>
      <div class="zone-components"><span>AI 应用</span><i>明文</i><span>客户端 TNG</span></div>
      <p v-if="!compact">提示词在本机交给 TNG，网关仅监听 127.0.0.1。</p>
    </div>
    <div class="secure-segment">
      <span class="segment-badge"><LockOutlined /> 网络密文</span>
      <b>OHTTP 段 1</b>
      <small>单向证明：客户端验证 Gateway TEE · OHTTP/HPKE 消息级加密</small>
      <div class="segment-line"><i /></div>
    </div>
    <div class="trust-zone gateway-zone">
      <div class="zone-heading">
        <span class="zone-icon"><SafetyCertificateOutlined /></span>
        <div><b>Gateway Pod TEE</b><small>硬件加密内存</small></div>
      </div>
      <div class="zone-components"><span>Gateway TNG</span><i>localhost</i><span>Envoy + EPP</span></div>
      <p v-if="!compact">在同一 TEE 边界内解密、选点，宿主机无法读取内存。</p>
    </div>
    <div class="secure-segment">
      <span class="segment-badge"><LockOutlined /> 网络密文</span>
      <b>RATS-TLS 段 2</b>
      <small>双向证明：两个 TEE 互相验证</small>
      <div class="segment-line"><i /></div>
    </div>
    <div class="trust-zone inference-zone">
      <div class="zone-heading">
        <span class="zone-icon"><CloudServerOutlined /></span>
        <div><b>推理引擎 TEE</b><small>CPU + GPU 使用中保护</small></div>
      </div>
      <div class="zone-components"><span>vLLM TNG</span><i>受保护</i><span>推理引擎 + GPU</span></div>
      <p v-if="!compact">TEE 内解密并推理，CPU-GPU 链路由硬件加密保护。</p>
    </div>
  </div>
</template>