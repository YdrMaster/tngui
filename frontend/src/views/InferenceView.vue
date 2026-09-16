<script setup lang="ts">
import { ref, computed, inject, onMounted, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { message } from "ant-design-vue";
import {
  ExperimentOutlined, SendOutlined, InfoCircleOutlined, LockOutlined, LoadingOutlined,
  SafetyCertificateOutlined, CloudServerOutlined, ApiOutlined, StopOutlined, CheckCircleOutlined,
  DownloadOutlined, ImportOutlined, ExportOutlined, GlobalOutlined,
} from "@ant-design/icons-vue";
import { useInferenceConfig } from "../composables/useInferenceConfig";
import { useIngressState } from "../composables/useIngressState";
import { proxyEndpoint } from "../tauri";
import SecureFlow from "../components/SecureFlow.vue";
import ArchitectureFlow from "../components/ArchitectureFlow.vue";
import ProtectionItem from "../components/ProtectionItem.vue";

const { model: inferenceModel, apiKey } = useInferenceConfig();
const { tngRunning } = useIngressState();
const navigate = inject<(target: "overview" | "inference" | "settings") => void>(
  "navigate",
  () => {},
);

const activeTab = ref<"request" | "integration" | "security">("request");
const prompt = ref("请用三点说明密态推理如何保护我的输入数据。");
const output = ref("");
const sending = ref(false);
const phase = ref(4);
const phaseTimer = ref<number | undefined>(undefined);
const statusCode = ref(0);
const failed = ref(false);
// 反代对外端口（取自 proxy_endpoint[0].port）：tng 未启动时为 null。
const proxyPort = ref<number | null>(null);
let proxyTimer: number | undefined;

async function fetchProxy() {
  try {
    const eps = await proxyEndpoint();
    proxyPort.value = eps?.[0]?.port ?? null;
  } catch {
    proxyPort.value = null;
  }
}
onMounted(() => {
  fetchProxy();
  proxyTimer = window.setInterval(fetchProxy, 2000);
});
onBeforeUnmount(() => {
  if (proxyTimer) window.clearInterval(proxyTimer);
});

const localEndpoint = computed(() =>
  proxyPort.value !== null
    ? `http://127.0.0.1:${proxyPort.value}/v1`
    : "未配置",
);
// “可发”门锁：与概览左上角“运行状态”卡同口径（tngRunning）AND api-key 已配置；不再查 readyz/model/端口。
const usable = computed(() => tngRunning.value && !!apiKey.value);

const curlExample = computed(() => `curl http://127.0.0.1:${proxyPort.value ?? 8080}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -d '{
    "model": "${inferenceModel.value || "model"}",
    "messages": [{"role": "user", "content": "请分析这段文本"}]
  }'`);

const deepSeekClientConfig = computed(() => `API 类型       OpenAI Compatible
API Base URL   ${localEndpoint.value}
API Key        <从 1 号节点控制台获取>
Model ID       ${inferenceModel.value || "model"}`);

async function onSend() {
  if (!usable.value) { message.warning("请先在「概览」启动 TNG 网关（显示运行）并在「设置」配置 API Key"); return; }
  if (!prompt.value.trim()) { message.warning("请输入测试内容"); return; }
  if (proxyPort.value === null) { message.warning("网关对外端口未就绪，无法发送"); return; }
  sending.value = true; output.value = ""; statusCode.value = 0; failed.value = false; phase.value = 0;
  let step = 0;
  phaseTimer.value = window.setInterval(() => {
    step += 1; phase.value = step;
    if (step >= 4) window.clearInterval(phaseTimer.value);
  }, 520);
  try {
    const result = await invoke<string>("send_inference", {
      port: proxyPort.value, model: inferenceModel.value, apiKey: apiKey.value, prompt: prompt.value,
    });
    window.clearInterval(phaseTimer.value); phase.value = 4; statusCode.value = 200; failed.value = false;
    output.value = result;
  } catch (e) {
    window.clearInterval(phaseTimer.value); phase.value = 1;
    statusCode.value = 0; failed.value = true;
    output.value = String(e);
  } finally { sending.value = false; }
}
</script>

<template>
  <div class="full-width" style="max-width:1540px;margin:0 auto">
    <!-- PageHeader -->
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h3 style="margin:0 0 4px;font-size:24px;font-weight:650">密态推理调试</h3>
        <span style="color:var(--text-secondary)">在一个场景内完成单次请求验证、AI 客户端接入和安全机制了解。</span>
      </div>
      <a-tag><InfoCircleOutlined /> 演示与接入工具</a-tag>
    </div>

    <a-card class="debug-workbench" :bordered="false">
      <a-tabs v-model:activeKey="activeTab" size="large">

        <!-- Tab: 请求调试 -->
        <a-tab-pane key="request" tab="请求调试">
          <div class="tab-intro" style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <h4 style="margin:0 0 4px;font-size:16px;font-weight:600">单次请求调试</h4>
              <span style="color:var(--text-secondary);font-size:13px">关闭页面后不保留测试内容和响应，不提供多轮对话。</span>
            </div>
            <a-tag><InfoCircleOutlined /> 单次请求模式</a-tag>
          </div>
          <a-result v-if="!usable" status="warning" title="当前无法发送测试请求"
            subTitle="请先恢复网关、API Key 与可信通道状态。"
          >
            <template #extra>
              <a-button type="primary" @click="navigate('settings')">前往设置</a-button>
            </template>
          </a-result>
          <a-row v-else :gutter="[16, 16]">
            <a-col :span="11">
              <a-card title="请求">
                <a-form layout="vertical">
                  <a-form-item label="模型"><a-input v-model:value="inferenceModel" placeholder="如 gpt-4 / vllm-model" autocapitalize="off" autocorrect="off" spellcheck="false" /></a-form-item>
                  <a-form-item label="输入内容">
                    <a-textarea
                      v-model:value="prompt"
                      class="prompt-textarea"
                      :auto-size="{ minRows: 4, maxRows: 16 }"
                      :maxlength="4000"
                      showCount
                      autocapitalize="off"
                      autocorrect="off"
                      spellcheck="false"
                      placeholder="输入一段用于连通性测试的内容"
                    />
                  </a-form-item>
                  <a-button block size="large" type="primary" class="send-button" :loading="sending" @click="onSend">
                    <SendOutlined />
                    <span>{{ sending ? "正在安全发送" : "发送测试请求" }}</span>
                  </a-button>
                </a-form>
              </a-card>
            </a-col>
            <a-col :span="13">
              <a-card title="响应">
                <template #extra>
                  <span v-if="output && statusCode === 200" style="display:flex;gap:8px;align-items:center">
                    <a-tag color="success">200 OK</a-tag>
                    <span style="color:var(--text-secondary)">响应已在本地解密</span>
                  </span>
                  <span v-else-if="failed" style="display:flex;gap:8px;align-items:center">
                    <a-tag color="error">请求失败</a-tag>
                    <span style="color:var(--text-secondary)">调试详情（Authorization 已脱敏）</span>
                  </span>
                </template>
                <div class="response-panel">
                  <div v-if="sending" class="sending-state">
                    <Spin size="large" />
                    <a-progress :percent="(phase + 1) * 20" :showInfo="false" style="width:min(360px,100%)" />
                    <SecureFlow :active-index="phase" />
                  </div>
                  <div v-else-if="output" style="padding:8px">
                    <pre v-if="failed" class="code-block response-debug" style="white-space:pre-wrap;overflow:auto;max-height:560px;margin:0">{{ output }}</pre>
                    <p v-else class="response-text" style="white-space:pre-line;font-size:15px;line-height:1.85">{{ output }}</p>
                  </div>
                  <div v-else class="empty-response">
                    <ExperimentOutlined style="font-size:46px;color:#bfbfbf" />
                    <span style="color:var(--text-secondary)">发送一条请求以验证连接</span>
                  </div>
                </div>
              </a-card>
            </a-col>
          </a-row>
          <a-alert type="warning" showIcon style="margin-top:16px"
            message="本客户端不是聊天工具"
            description="不提供会话历史、多轮对话管理或长期内容存储。业务应用请通过本地 API Base URL 接入。" />
        </a-tab-pane>

        <!-- Tab: AI 客户端接入 -->
        <a-tab-pane key="integration" tab="AI 客户端接入">
          <div class="integration-panel" style="padding:2px">
            <a-alert type="info" showIcon
              message="客户端通过本地 TNG Gateway 访问密态大模型"
              description="客户端只连接 127.0.0.1，不直接访问云端。RIVS 与推理网关域名均由网关内置。" />
            <a-descriptions class="section-card" :column="2" bordered style="margin-top:16px">
              <a-descriptions-item label="API Base URL">{{ localEndpoint }}</a-descriptions-item>
              <a-descriptions-item label="网关状态">
                <a-badge :status="tngRunning ? 'success' : 'error'" :text="tngRunning ? '运行中' : '未运行'" />
              </a-descriptions-item>
              <a-descriptions-item label="监听范围"><a-tag color="blue">仅本机 127.0.0.1</a-tag></a-descriptions-item>
              <a-descriptions-item label="兼容协议">OpenAI-compatible API</a-descriptions-item>
            </a-descriptions>
            <a-row :gutter="24" style="margin-top:24px">
              <a-col :span="13">
                <div class="client-heading" style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
                  <div class="deepseek-mark">D</div>
                  <div>
                    <h4 style="margin:0 0 2px;font-size:16px">DeepSeek Client</h4>
                    <span style="color:var(--text-secondary);font-size:13px">OpenAI-compatible 接入方式</span>
                  </div>
                </div>
                <a-steps direction="vertical" size="small">
                  <a-step title="打开模型服务设置" description="进入 Settings → Model Provider，新增 OpenAI Compatible 服务。" />
                  <a-step title="填写本地网关信息" description="API Base URL 指向 127.0.0.1；API Key 使用 1 号节点分发的密态推理 Key。" />
                  <a-step title="选择模型并测试" description="保存后发送一条测试消息。" />
                  <a-step title="确认安全状态" description="回到可信网关查看验证结果；验证失败时请求不会离开本机。" />
                </a-steps>
                <span class="small-text" style="color:var(--text-secondary);font-size:12px">不同版本的设置入口名称可能略有差异，以客户端实际界面为准。</span>
              </a-col>
              <a-col :span="11">
                <div class="config-title" style="margin:2px 0 10px;font-weight:600">配置项</div>
                <pre class="code-block client-config" style="min-height:184px;display:flex;align-items:center">{{ deepSeekClientConfig }}</pre>
                <a-divider orientation="left">cURL 示例</a-divider>
                <pre class="code-block">{{ curlExample }}</pre>
                <a-alert class="client-tip" type="warning" showIcon style="margin-top:14px"
                  message="不要填写云端服务地址"
                  description="必须使用本地 TNG 地址，才能获得远程证明、链路加密和验证失败阻断能力。" />
              </a-col>
            </a-row>
          </div>
        </a-tab-pane>

        <!-- Tab: 安全说明 -->
        <a-tab-pane key="security" tab="安全说明">
          <div class="tab-intro" style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <h4 style="margin:0 0 4px;font-size:16px">密态安全如何发生</h4>
              <span style="color:var(--text-secondary);font-size:13px">从客户本地到云端推理引擎，查看传输中与使用中的保护过程。</span>
            </div>
          </div>
          <!-- Security Hero -->
          <a-card class="security-hero">
            <a-row align="middle" :gutter="24">
              <a-col :span="7">
                <a-result
                  status="success"
                  title="链路可信机制"
                  subTitle="两段加密：Seg1 OHTTP + Seg2 RA-TLS，均经远程证明"
                >
                  <template #extra>
                    <a-tag color="success">RA</a-tag>
                  </template>
                </a-result>
              </a-col>
              <a-col :span="17">
                <div class="security-promise" style="padding:24px 26px;border-left:1px solid var(--split)">
                  <h3 style="margin:0 0 10px;font-size:20px">网络看不到，宿主机读不到，伪造节点连不上</h3>
                  <p style="max-width:780px;line-height:1.75;color:var(--text-secondary)">TNG 使用 RATS-TLS 将远程证明与加密会话绑定。即使网络、宿主机 OS 或 K8s 控制面不可信，也不能读取提示词或把请求引流到未经验证的节点。</p>
                  <div style="display:flex;flex-wrap:wrap;gap:8px">
                    <a-tag color="blue">网络全程密文</a-tag>
                    <a-tag color="green">TEE 使用中保护</a-tag>
                    <a-tag color="purple">硬件信任根</a-tag>
                    <a-tag color="cyan">可离线审计</a-tag>
                  </div>
                </div>
              </a-col>
            </a-row>
          </a-card>
          <!-- Architecture Flow -->
          <a-card title="端到端保护架构" style="margin-bottom:16px">
            <template #extra><span style="color:var(--text-secondary)">响应沿原链路加密返回</span></template>
            <ArchitectureFlow />
            <a-alert type="info" showIcon style="margin-top:18px"
              message="明文只存在于三个可信边界"
              description="客户域、Gateway Pod TEE、推理引擎 TEE（含 GPU 显存）。跨边界的两段网络通信均为密文。" />
          </a-card>
          <!-- Two Protection Cards -->
          <a-row :gutter="[16, 16]">
            <a-col :span="12">
              <a-card title="两段链路如何验证" class="protection-card">
                <ProtectionItem :icon="SafetyCertificateOutlined" title="客户端 → Gateway" tag="单向证明" description="客户端验证 Gateway TEE 的硬件身份与软件度量，防止提示词被发送到伪造网关。" />
                <ProtectionItem :icon="LockOutlined" title="Gateway → 推理引擎" tag="双向证明" description="Gateway TEE 与推理引擎 TEE 互相验证，K8s 返回的 endpoint 只作为候选，不作为授权依据。" />
                <ProtectionItem :icon="StopOutlined" title="验证失败即阻断" tag="Fail closed" description="任一节点身份或度量不满足策略时拒绝连接，业务数据不会继续发送。" />
              </a-card>
            </a-col>
            <a-col :span="12">
              <a-card title="推理过程中如何保护" class="protection-card">
                <ProtectionItem :icon="CloudServerOutlined" title="TEE 加密内存" tag="内存保护" description="Gateway 和推理引擎运行在可信执行环境中，宿主机 OS 无法读取正在处理的数据。" />
                <ProtectionItem :icon="ApiOutlined" title="CPU-GPU 加密链路" tag="PCIe 链路加密" description="模型权重、KV cache 和中间激活值在 PCIe 总线上保持加密。" />
                <ProtectionItem :icon="SafetyCertificateOutlined" title="密码学证明可审计" tag="Attestation" description="每次握手生成可验证的证明声明，可由审计方独立核验。" />
              </a-card>
            </a-col>
          </a-row>
          <!-- Security Details: Tabs (加密边界 / TLS 对比 / 证据) -->
          <a-card class="security-details" style="margin-top:16px">
            <a-tabs>
              <a-tab-pane key="boundary" tab="加密边界">
                <div class="boundary-list">
                  <div class="boundary-row"><b>User App → 客户端 TNG</b><a-tag>明文</a-tag><span>客户域内，仅本机</span></div>
                  <div class="boundary-row encrypted"><b>客户端 TNG → Gateway TNG</b><a-tag color="blue">密文</a-tag><span>OHTTP/HPKE 段 1 · 单向证明</span></div>
                  <div class="boundary-row"><b>Gateway TNG → Envoy → EPP</b><a-tag>明文</a-tag><span>同 Pod localhost，共享 TEE 边界</span></div>
                  <div class="boundary-row encrypted"><b>Gateway TNG → vLLM TNG</b><a-tag color="blue">密文</a-tag><span>RATS-TLS 段 2 · 双向证明</span></div>
                  <div class="boundary-row"><b>vLLM TNG → 推理引擎</b><a-tag>明文</a-tag><span>同 Pod localhost，共享 TEE 边界</span></div>
                </div>
              </a-tab-pane>
              <a-tab-pane key="compare" tab="与普通 TLS 对比">
                <div class="compare-grid">
                  <div class="compare-head">能力</div><div class="compare-head">传统 TLS</div><div class="compare-head rats">RATS-TLS</div>
                  <b>传输加密</b><span><CheckCircleOutlined /> 支持</span><span class="rats"><CheckCircleOutlined /> 支持</span>
                  <b>对端身份</b><span>X.509 证书</span><span class="rats">验证 TEE 硬件身份</span>
                  <b>代码完整性</b><span style="color:var(--error)">无法验证</span><span class="rats">验证软件度量</span>
                  <b>防止节点冒充</b><span>依赖 CA 信任链</span><span class="rats">依赖硬件信任根</span>
                  <b>审计证据</b><span style="color:var(--error)">无</span><span class="rats">证明声明可独立验证</span>
                </div>
              </a-tab-pane>
              <a-tab-pane key="evidence" tab="本次可信证据">
                <a-descriptions bordered :column="2">
                  <a-descriptions-item label="证明 ID"><span class="mono">RA-260824-7C21</span></a-descriptions-item>
                  <a-descriptions-item label="验证时间">2026-08-24 14:26:08</a-descriptions-item>
                  <a-descriptions-item label="可信执行环境"><a-tag color="success">远程证明（RA）</a-tag></a-descriptions-item>
                  <a-descriptions-item label="软件度量"><a-tag color="success">参考值匹配</a-tag></a-descriptions-item>
                  <a-descriptions-item label="可信策略"><span class="mono">policy-prod-2026.08</span></a-descriptions-item>
                  <a-descriptions-item label="加密协议">Seg1 OHTTP/HPKE + Seg2 RA-TLS(TLS 1.3)</a-descriptions-item>
                </a-descriptions>
                <a-alert type="success" showIcon style="margin-top:12px"
                  message="中心控制面只负责服务开通与 API Key 管理，不承载本次请求正文。" />
              </a-tab-pane>
            </a-tabs>
          </a-card>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>