<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick, watch } from "vue";
import { message } from "ant-design-vue";
import {
  ExperimentOutlined, SendOutlined, InfoCircleOutlined, LockOutlined,
  SafetyCertificateOutlined, CloudServerOutlined, ApiOutlined, StopOutlined, CheckCircleOutlined,
} from "@ant-design/icons-vue";
import { useInferenceConfig } from "../composables/useInferenceConfig";
import { useIngressState } from "../composables/useIngressState";
import { listModels, proxyEndpoint, sendInferenceStream, stopInferenceStream, type InferenceDelta, type InferenceEffort, type InferenceMessage } from "../tauri";
import SecureFlow from "../components/SecureFlow.vue";
import ArchitectureFlow from "../components/ArchitectureFlow.vue";
import ProtectionItem from "../components/ProtectionItem.vue";
import hermesAgentConfigImage from "../assets/hermes-agent-config.png";

defineOptions({ name: "InferenceView" });

const {
  apiKey,
  model,
  modelIds,
  modelDiscoveryState,
  selectModel,
  replaceModelList,
  startModelDiscovery,
  failModelDiscovery,
} = useInferenceConfig();
const { tngRunning } = useIngressState();
type InferenceChatTab = "request" | "integration" | "security";
type ChatRole = "user" | "assistant";
type ChatStatus = "stage-playing" | "streaming" | "complete" | "failed" | "stopped";

interface UserChatMessage {
  id: string;
  role: "user";
  content: string;
}

interface AssistantChatMessage {
  id: string;
  role: "assistant";
  reasoning: string;
  content: string;
  status: ChatStatus;
  phase: number;
  diagnostic?: string;
  hasDelta: boolean;
  bufferedReasoning: string;
  bufferedContent: string;
  networkComplete: boolean;
  finalStageAt?: number;
}

type ChatMessage = UserChatMessage | AssistantChatMessage;

const STAGE_INTERVAL_MS = 520;
const FINAL_STAGE_INDEX = 4;
const FINAL_STAGE_HOLD_MS = 500;

const activeTab = ref<InferenceChatTab>("request");
const draft = ref("");
const messages = ref<ChatMessage[]>([]);
const sending = ref(false);
const activeAssistantId = ref<string | undefined>(undefined);
const transcriptEl = ref<HTMLElement | null>(null);
const proxyPort = ref<number | null>(null);
let proxyTimer: number | undefined;
let scrollFrame: number | undefined;
let messageSequence = 0;
const stageTimers = new Map<string, number>();
const revealTimers = new Map<string, number>();

const thinkingLevels = [
  { value: 0, label: "关", effort: "none" },
  { value: 1, label: "低", effort: "low" },
  { value: 2, label: "中", effort: "medium" },
  { value: 3, label: "高", effort: "high" },
] as const;
const thinkingLevel = ref(2);
const thinkingMarks: Record<number, string> = { 0: "关", 1: "低", 2: "中", 3: "高" };
const thinkingEffort = computed(() => thinkingLevels[thinkingLevel.value].effort);

function nextId(prefix: ChatRole): string {
  messageSequence += 1;
  return `${prefix}-${messageSequence}`;
}

async function fetchProxy() {
  try {
    const eps = await proxyEndpoint();
    proxyPort.value = eps?.[0]?.port ?? null;
  } catch {
    proxyPort.value = null;
  }
}

watch(
  proxyPort,
  async (port) => {
    if (port === null) { failModelDiscovery(); return; }
    startModelDiscovery();
    try {
      const ids = await listModels(port);
      replaceModelList(ids);
    } catch (error) {
      failModelDiscovery();
      message.error(`模型列表加载失败: ${String(error)}`);
    }
  },
  { immediate: true },
);

onMounted(() => {
  fetchProxy();
  proxyTimer = window.setInterval(fetchProxy, 2000);
});
onActivated(() => {
  void nextTick(scrollToBottom);
});
onDeactivated(() => {
  // Deliberately empty: switching pages must not reset state, stop timers,
  // or cancel an in-flight stream.
});
onBeforeUnmount(() => {
  if (proxyTimer) window.clearInterval(proxyTimer);
  clearAllTurnTimers();
  if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
});

const localEndpoint = computed(() =>
  proxyPort.value !== null
    ? `http://127.0.0.1:${proxyPort.value}/v1`
    : "未配置",
);

const modelOptions = computed(() =>
  modelIds.value.map((modelId) => ({ value: modelId, label: modelId })),
);

/** 搜索只用于过滤服务端返回的选项；任意输入文本永远不会成为模型 ID。 */
const filterModelOption = (input: string, option: unknown): boolean => {
  const label = (option as { label?: unknown } | undefined)?.label;
  return typeof label === "string" && label.toLowerCase().includes(input.toLowerCase());
};

const modelStateMessage = computed(() => {
  switch (modelDiscoveryState.value) {
    case "loading": return "正在获取模型列表…";
    case "loaded-empty": return "未检测到密态模型";
    case "failed": return "模型列表加载失败";
    default: return "";
  }
});

const canSelectModel = computed(() => modelDiscoveryState.value === "loaded-nonempty");
const usable = computed(() => tngRunning.value && !!apiKey.value && canSelectModel.value && !!model.value);

const curlExample = computed(() => `curl -N http://127.0.0.1:${proxyPort.value ?? 8080}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -d '{
    "model": "${modelStateMessage.value || model.value}",
    "messages": [{"role": "user", "content": "请分析这段文本"}],
    "stream": true
  }'`);

const hermesAgentConfig = computed(() => `model:
  default: ${modelStateMessage.value || model.value}
  provider: custom
  base_url: ${localEndpoint.value}
  api_key: sk-************************************`);

function buildRequestMessages(history: ChatMessage[]): InferenceMessage[] {
  const requestMessages: InferenceMessage[] = [];
  for (const chatMessage of history) {
    if (chatMessage.role === "user") {
      requestMessages.push({ role: "user", content: chatMessage.content });
    } else if (chatMessage.status === "complete" && chatMessage.content.length > 0) {
      requestMessages.push({ role: "assistant", content: chatMessage.content });
    }
  }
  return requestMessages;
}

function findAssistant(id: string): AssistantChatMessage | undefined {
  const found = messages.value.find((chatMessage) => chatMessage.id === id);
  return found?.role === "assistant" ? found : undefined;
}

function scrollToBottom(): void {
  const el = transcriptEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function scheduleScrollToBottom(): void {
  void nextTick(() => {
    if (scrollFrame !== undefined) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = undefined;
      scrollToBottom();
    });
  });
}

function clearTurnTimers(id: string): void {
  const stageTimer = stageTimers.get(id);
  if (stageTimer !== undefined) {
    window.clearInterval(stageTimer);
    stageTimers.delete(id);
  }
  const revealTimer = revealTimers.get(id);
  if (revealTimer !== undefined) {
    window.clearTimeout(revealTimer);
    revealTimers.delete(id);
  }
}

function clearAllTurnTimers(): void {
  for (const id of [...stageTimers.keys(), ...revealTimers.keys()]) {
    clearTurnTimers(id);
  }
}

function startStageAnimation(id: string): void {
  clearTurnTimers(id);
  const turn = findAssistant(id);
  if (!turn) return;
  turn.phase = 0;
  turn.finalStageAt = undefined;
  const timer = window.setInterval(() => {
    const current = findAssistant(id);
    if (!current || current.status !== "stage-playing") {
      clearTurnTimers(id);
      return;
    }
    current.phase = Math.min(current.phase + 1, FINAL_STAGE_INDEX);
    if (current.phase === FINAL_STAGE_INDEX) {
      const stageTimer = stageTimers.get(id);
      if (stageTimer !== undefined) {
        window.clearInterval(stageTimer);
        stageTimers.delete(id);
      }
      current.finalStageAt = Date.now();
      scheduleFinalHold(id);
    }
    scheduleScrollToBottom();
  }, STAGE_INTERVAL_MS);
  stageTimers.set(id, timer);
}

function scheduleFinalHold(id: string): void {
  if (revealTimers.has(id)) return;
  const timer = window.setTimeout(() => {
    revealTimers.delete(id);
    maybeReveal(id);
  }, FINAL_STAGE_HOLD_MS);
  revealTimers.set(id, timer);
}

function maybeReveal(id: string): void {
  const turn = findAssistant(id);
  if (!turn || turn.status !== "stage-playing") return;
  const finalAt = turn.finalStageAt;
  if (
    turn.phase !== FINAL_STAGE_INDEX ||
    finalAt === undefined ||
    Date.now() - finalAt < FINAL_STAGE_HOLD_MS ||
    !turn.hasDelta
  ) {
    return;
  }
  clearTurnTimers(id);
  turn.reasoning = turn.bufferedReasoning;
  turn.content = turn.bufferedContent;
  turn.status = "streaming";
  scheduleScrollToBottom();
  if (turn.networkComplete) finalizeComplete(id);
}

function finalizeComplete(id: string): void {
  const turn = findAssistant(id);
  if (!turn || turn.status === "failed" || turn.status === "stopped") return;
  clearTurnTimers(id);
  turn.status = "complete";
  if (activeAssistantId.value === id) {
    activeAssistantId.value = undefined;
    sending.value = false;
  }
  scheduleScrollToBottom();
}

function finalizeStopped(id: string): void {
  const turn = findAssistant(id);
  if (!turn || turn.status === "complete" || turn.status === "failed" || turn.status === "stopped") return;
  clearTurnTimers(id);
  if (turn.status === "stage-playing") {
    // 阶段动画中的一切后台缓冲都不揭示；对用户而言本轮如同没有收到任何 chunk。
    turn.reasoning = "";
    turn.content = "";
    turn.bufferedReasoning = "";
    turn.bufferedContent = "";
    turn.hasDelta = false;
    turn.networkComplete = false;
  }
  turn.status = "stopped";
  turn.diagnostic = undefined;
  if (activeAssistantId.value === id) {
    activeAssistantId.value = undefined;
    sending.value = false;
  }
  scheduleScrollToBottom();
}

function finalizeFailure(id: string, diagnostic: string): void {
  const turn = findAssistant(id);
  if (!turn || turn.status === "complete" || turn.status === "failed" || turn.status === "stopped") return;
  clearTurnTimers(id);
  if (turn.status === "stage-playing") {
    turn.reasoning = turn.bufferedReasoning;
    turn.content = turn.bufferedContent;
  }
  turn.status = "failed";
  turn.diagnostic = diagnostic;
  if (activeAssistantId.value === id) {
    activeAssistantId.value = undefined;
    sending.value = false;
  }
  scheduleScrollToBottom();
}

function applyDelta(id: string, delta: InferenceDelta): void {
  const turn = findAssistant(id);
  if (!turn || delta.text.length === 0) return;
  if (turn.status === "stage-playing") {
    if (delta.kind === "reasoning") turn.bufferedReasoning += delta.text;
    else turn.bufferedContent += delta.text;
    turn.hasDelta = true;
    maybeReveal(id);
    return;
  }
  if (turn.status === "streaming") {
    if (delta.kind === "reasoning") turn.reasoning += delta.text;
    else turn.content += delta.text;
  }
  scheduleScrollToBottom();
}

async function onSend(): Promise<void> {
  if (sending.value) return;
  if (!usable.value) {
    message.warning("请先在「概览」启动 TNG 网关（显示运行）、在「设置」配置 API Key，并确认存在可用的密态模型");
    return;
  }
  if (!draft.value.trim()) { message.warning("请输入消息内容"); return; }
  if (proxyPort.value === null) { message.warning("网关对外端口未就绪，无法发送"); return; }

  const originalInput = draft.value;
  const requestMessages = buildRequestMessages(messages.value);
  requestMessages.push({ role: "user", content: originalInput });

  const userTurn: UserChatMessage = { id: nextId("user"), role: "user", content: originalInput };
  const assistantId = nextId("assistant");
  const assistantTurn: AssistantChatMessage = {
    id: assistantId,
    role: "assistant",
    reasoning: "",
    content: "",
    status: "stage-playing",
    phase: 0,
    hasDelta: false,
    bufferedReasoning: "",
    bufferedContent: "",
    networkComplete: false,
  };
  messages.value.push(userTurn, assistantTurn);
  draft.value = "";
  sending.value = true;
  activeAssistantId.value = assistantId;
  scheduleScrollToBottom();
  startStageAnimation(assistantId);

  try {
    const outcome = await sendInferenceStream(
      assistantId,
      proxyPort.value,
      model.value,
      apiKey.value,
      requestMessages,
      thinkingEffort.value,
      (delta) => applyDelta(assistantId, delta),
    );
    const turn = findAssistant(assistantId);
    if (!turn || turn.status === "failed" || turn.status === "stopped") return;
    if (outcome === "stopped") {
      finalizeStopped(assistantId);
      return;
    }
    turn.networkComplete = true;
    if (turn.status === "streaming") finalizeComplete(assistantId);
    else maybeReveal(assistantId);
  } catch (error) {
    finalizeFailure(assistantId, String(error));
  }
}

/** 用户主动停止：本地先进入 stopped 终态，再请求后端取消并忽略迟到 delta。 */
async function onStop(): Promise<void> {
  const id = activeAssistantId.value;
  if (!id || !sending.value) return;
  const turn = findAssistant(id);
  if (!turn || turn.status === "complete" || turn.status === "failed" || turn.status === "stopped") return;
  finalizeStopped(id);
  try {
    await stopInferenceStream(id);
  } catch (error) {
    message.error(`停止推理请求失败: ${String(error)}`);
  }
}

function assistantStatusMeta(status: ChatStatus): { color: string; text: string } {
  switch (status) {
    case "stage-playing": return { color: "processing", text: "安全链路" };
    case "streaming": return { color: "processing", text: "生成中" };
    case "complete": return { color: "success", text: "200 OK" };
    case "failed": return { color: "error", text: "请求失败" };
    case "stopped": return { color: "warning", text: "已停止⚪响应不完整" };
  }
}

/** 正常对话的进行中与完整状态共用淡绿色；停止和失败使用专用警示色。 */
function assistantBubbleClass(status: ChatStatus): string {
  if (status === "complete") return "assistant-bubble-complete";
  if (status === "stopped") return "assistant-bubble-stopped";
  if (status === "failed") return "assistant-bubble-failed";
  return "assistant-bubble-pending";
}
</script>

<template>
  <div class="full-width inference-shell" style="max-width:1540px;margin:0 auto">
    <!-- PageHeader -->
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h3 style="margin:0 0 4px;font-size:24px;font-weight:650">密态推理调试</h3>
        <span style="color:var(--text-secondary)">在一个场景内完成多轮推理对话、AI 客户端接入和安全机制了解。</span>
      </div>
      <a-tag><InfoCircleOutlined /> 演示与接入工具</a-tag>
    </div>

    <a-card class="debug-workbench" :bordered="false">
      <a-tabs v-model:activeKey="activeTab" size="large">

        <!-- Tab: 请求调试 -->
        <a-tab-pane key="request" tab="请求调试">
          <div class="chat-shell">
            <div class="chat-toolbar">
              <div class="model-control">
                <a-select
                  :value="model"
                  :options="modelOptions"
                  :disabled="!canSelectModel"
                  :placeholder="modelStateMessage"
                  :allow-clear="false"
                  show-search
                  :filter-option="filterModelOption"
                  aria-label="选择推理模型"
                  @update:value="selectModel"
                />
              </div>
              <div class="thinking-control">
                <span class="control-label">思考强度</span>
                <a-slider
                  v-model:value="thinkingLevel"
                  class="thinking-slider"
                  :min="0"
                  :max="3"
                  :step="1"
                  :marks="thinkingMarks"
                  :tooltip-open="false"
                />
              </div>
            </div>

            <a-alert
              v-if="!usable"
              class="chat-gate"
              type="warning"
              show-icon
              message="当前无法发送推理请求"
              description="请先恢复网关运行状态、API Key 与模型清单。"
            />

            <div ref="transcriptEl" class="chat-transcript" aria-label="密态推理对话记录">
              <div v-if="messages.length === 0" class="empty-chat">
                <ExperimentOutlined />
                <span>发送一条消息，开始多轮密态推理验证</span>
              </div>
              <template v-else>
                <div
                  v-for="chatMessage in messages"
                  :key="chatMessage.id"
                  :class="['chat-message', chatMessage.role === 'user' ? 'user-message' : 'assistant-message']"
                >
                  <div v-if="chatMessage.role === 'user'" class="chat-bubble user-bubble">
                    {{ chatMessage.content }}
                  </div>
                  <div v-else :class="['chat-bubble', 'assistant-bubble', assistantBubbleClass(chatMessage.status)]">
                    <div class="assistant-meta">
                      <a-tag :color="assistantStatusMeta(chatMessage.status).color">
                        {{ assistantStatusMeta(chatMessage.status).text }}
                      </a-tag>
                      <span v-if="chatMessage.status === 'stage-playing'">正在建立安全链路</span>
                      <span v-else-if="chatMessage.status === 'streaming'">正在生成，响应已在本地解密</span>
                      <span v-else-if="chatMessage.status === 'complete'">响应已在本地解密</span>
                      <span v-else-if="chatMessage.status === 'stopped'">用户停止了本轮生成</span>
                      <span v-else-if="chatMessage.content || chatMessage.reasoning">
                        响应不完整（已保留部分输出）
                      </span>
                      <span v-else>流中断，未收到可显示输出</span>
                    </div>

                    <div v-if="chatMessage.status === 'stage-playing'" class="assistant-stage">
                      <a-progress
                        :percent="(chatMessage.phase + 1) * 20"
                        :show-info="false"
                      />
                      <SecureFlow :active-index="chatMessage.phase" />
                    </div>

                    <template v-else>
                      <section v-if="chatMessage.reasoning" class="reasoning-block">
                        <span class="section-label">思考过程</span>
                        <p class="reasoning-text">{{ chatMessage.reasoning }}</p>
                      </section>
                      <section
                        v-if="chatMessage.content || chatMessage.status !== 'stopped'"
                        class="assistant-content"
                      >
                        <span class="section-label">最终回答</span>
                        <p v-if="chatMessage.content" class="response-text">{{ chatMessage.content }}</p>
                        <p v-else class="empty-assistant-text">尚未返回最终回答</p>
                      </section>
                      <pre
                        v-if="chatMessage.status === 'failed' && chatMessage.diagnostic"
                        class="code-block assistant-debug"
                      >{{ chatMessage.diagnostic }}</pre>
                    </template>
                  </div>
                </div>
              </template>
            </div>

            <div class="chat-composer">
              <a-textarea
                v-model:value="draft"
                class="prompt-textarea"
                :auto-size="{ minRows: 1, maxRows: 8 }"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                @keydown.enter.exact.prevent="onSend"
              />
              <a-button
                :type="sending ? 'default' : 'primary'"
                :class="['send-button', { 'stop-button': sending }]"
                :disabled="!sending && !usable"
                :aria-label="sending ? '停止' : '发送'"
                :title="sending ? '停止' : '发送'"
                @click="sending ? onStop() : onSend()"
              >
                <span v-if="sending" class="stop-square-icon" aria-hidden="true"></span>
                <SendOutlined v-else />
              </a-button>
            </div>
          </div>
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
            <a-alert
              v-if="!usable"
              class="chat-gate"
              type="warning"
              show-icon
              message="当前无法发送推理请求"
              description="请先恢复网关运行状态、API Key 与模型清单。"
            />
            <a-row :gutter="24" style="margin-top:24px">
              <a-col :span="12">
                <div class="client-heading" style="display:flex;align-items:flex-start;gap:12px;margin-bottom:20px">
                  <div class="hermes-mark">H</div>
                  <div>
                    <h4 style="margin:0 0 2px;font-size:16px">Hermes Agent</h4>
                    <span class="client-subtitle">
                      Nous Research 开源自主 AI Agent ·
                      <a
                        class="client-home-link"
                        href="https://hermes-agent.nousresearch.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >官方主页</a>
                    </span>
                    <p class="client-description">Hermes Agent 支持持久记忆、技能自学习、工具调用和多种对话平台。它可通过 custom endpoint 将推理请求指向本机 TNG。</p>
                  </div>
                </div>
                <figure class="client-screenshot-wrap">
                  <img
                    class="client-screenshot"
                    :src="hermesAgentConfigImage"
                    alt="Hermes Agent custom endpoint 配置示例"
                  >
                  <figcaption>Hermes Agent 配置示例截图</figcaption>
                </figure>
              </a-col>
              <a-col :span="12">
                <div class="config-title" style="margin:2px 0 10px;font-weight:600">Hermes 配置示例</div>
                <pre class="code-block client-config" style="min-height:184px;display:flex;align-items:center">{{ hermesAgentConfig }}</pre>
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