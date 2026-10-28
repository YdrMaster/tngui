// 密态推理页的进程内状态：模型清单、选中模型、apiKey，以及两种运行模式共享的唯一会话。
// apiKey 可由启动 bootstrap 从设置缓存恢复；会话与模式只存在于 GUI 进程内存。
import { ref, type Ref } from "vue";
import type { InferenceMessage, ToolCall } from "../tauri";

export type ModelDiscoveryState = "loading" | "loaded-nonempty" | "loaded-empty" | "failed";

/** 运行模式：`chat` 一次点击恰好一次推理请求；`agent` 一次点击内多轮推理 + 工具调用。 */
export type RunMode = "chat" | "agent";

const model: Ref<string> = ref("");
const modelIds: Ref<string[]> = ref([]);
const modelDiscoveryState: Ref<ModelDiscoveryState> = ref("loading");
const apiKey: Ref<string> = ref("");

function startModelDiscovery(): void {
  modelDiscoveryState.value = "loading";
}

/** 以服务端返回清单驱动选择器，保持“当前选择必须属于最新清单”的不变量。 */
function replaceModelList(nextModelIds: string[]): void {
  modelIds.value = [...nextModelIds];
  if (nextModelIds.length === 0) {
    model.value = "";
    modelDiscoveryState.value = "loaded-empty";
    return;
  }
  if (!nextModelIds.includes(model.value)) {
    model.value = nextModelIds[0];
  }
  modelDiscoveryState.value = "loaded-nonempty";
}

function failModelDiscovery(): void {
  modelIds.value = [];
  model.value = "";
  modelDiscoveryState.value = "failed";
}

/** 只接受当前模型清单中的值；搜索筛选产生的任意文本不能进入状态。 */
function selectModel(value: string): void {
  if (modelIds.value.includes(value)) {
    model.value = value;
  }
}

const runMode: Ref<RunMode> = ref("chat");

/** 唯一共享会话：对话模式与 Agent 模式都从这里取上下文。 */
const sessionMessages: Ref<InferenceMessage[]> = ref([]);

function cloneToolCall(toolCall: ToolCall): ToolCall {
  return {
    id: toolCall.id,
    type: toolCall.type,
    function: { name: toolCall.function.name, arguments: toolCall.function.arguments },
  };
}

/**
 * 深拷贝一条会话消息。上下文必须逐字携带：不 trim、不裁剪、不把工具往来拍平成文本，
 * 也不因运行模式不同而改写既有消息。
 */
export function cloneSessionMessage(message: InferenceMessage): InferenceMessage {
  const cloned: InferenceMessage = { role: message.role, content: message.content };
  if (message.tool_calls) cloned.tool_calls = message.tool_calls.map(cloneToolCall);
  if (message.tool_call_id !== undefined) cloned.tool_call_id = message.tool_call_id;
  return cloned;
}

/** 追加一条已完成消息到共享会话（原样保存）。 */
function appendSessionMessage(message: InferenceMessage): void {
  sessionMessages.value.push(cloneSessionMessage(message));
}

/** 请求上下文：当前共享会话的逐字副本。 */
function toRequestMessages(): InferenceMessage[] {
  return sessionMessages.value.map(cloneSessionMessage);
}

/** 运行模式按请求生效：只影响下一次发送，不改变进行中请求，也不清空会话。 */
function selectRunMode(next: RunMode): void {
  runMode.value = next;
}

/** 开始新会话：清空共享会话（两种模式共用的请求上下文），不清聊天显示与调试参数。 */
function newSession(): void {
  sessionMessages.value = [];
}

export function useInferenceConfig() {
  return {
    apiKey,
    initializeApiKey,
    model,
    modelIds,
    modelDiscoveryState,
    selectModel,
    replaceModelList,
    startModelDiscovery,
    failModelDiscovery,
    runMode,
    selectRunMode,
    sessionMessages,
    appendSessionMessage,
    toRequestMessages,
    newSession,
  };
}

function initializeApiKey(next: string): void {
  apiKey.value = next;
}
