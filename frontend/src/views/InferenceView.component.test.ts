import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { readFileSync } from "node:fs";
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Divider,
  Form,
  Input,
  Result,
  Row,
  Col,
  Select,
  Slider,
  Step,
  Steps,
  TabPane,
  Tabs,
  Tag,
  Textarea,
  Spin,
  Switch,
} from "ant-design-vue";
import { useInferenceConfig } from "../composables/useInferenceConfig";
import type { InferenceMessage } from "../tauri";
import InferenceView from "./InferenceView.vue";

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("ant-design-vue", async () => {
  const actual = await vi.importActual<typeof import("ant-design-vue")>("ant-design-vue");
  return { ...actual, message: messageMocks };
});

const tauriMocks = vi.hoisted(() => ({
  proxyEndpoint: vi.fn(),
  proxyDiagnostics: vi.fn(),
  listModels: vi.fn(),
  sendInferenceStream: vi.fn(),
  runAgentMessage: vi.fn(),
  stopInferenceStream: vi.fn(),
  flushSettingsCache: vi.fn(),
  saveConfig: vi.fn(),
  launchTng: vi.fn(),
}));
vi.mock("../tauri", () => tauriMocks);

const tngRunningState = vi.hoisted(() => ({ value: true }));
vi.mock("../composables/useIngressState", () => ({
  useIngressState: () => ({ tngRunning: tngRunningState }),
}));

const globalComponents = {
  components: {
    "a-alert": Alert,
    "a-badge": Badge,
    "a-button": Button,
    "a-card": Card,
    "a-col": Col,
    "a-descriptions": Descriptions,
    "a-descriptions-item": DescriptionsItem,
    "a-divider": Divider,
    "a-form": Form,
    "a-form-item": Form.Item,
    "a-input": Input,
    "a-result": Result,
    "a-row": Row,
    "a-select": Select,
    "a-slider": Slider,
    "a-step": Step,
    "a-switch": Switch,
    "a-steps": Steps,
    "a-tab-pane": TabPane,
    "a-tabs": Tabs,
    "a-tag": Tag,
    "a-textarea": Textarea,
    Spin,
  },
};

const expectedIdentityPrompt = [
  "你是由蚂蚁密算公司提供的密态推理方案驱动的 AI Agent。",
  "本应用中的 Agent 框架运行在用户终端上，处于用户信任域内，但在可信执行环境（TEE）之外。Agent 的编排和本地工具调用（例如文件读取、目录浏览、内容搜索）都发生在用户本地环境中，工具访问到的本地数据、工具参数与工具结果不受 TEE 保护。",
  "TEE（可信执行环境）是处理器提供的隔离运行区域，区域外的操作系统、平台运维和硬件管理员无法读取其中的明文数据。TNG（Trusted Network Gateway，可信网络网关）位于用户终端与远端推理服务之间，负责转发推理请求。建立加密链路前，它会通过远程证明校验对端确实运行在符合预期的 TEE 中，运行代码的度量（可验证摘要）和服务身份均可信；验证失败即拒绝通信，后续传输保持加密并绑定到该已验证环境。",
  "模型的推理请求与推理计算在该 TEE 中完成。在 TEE 内部，用户提示词、推理中间过程和模型输出都在加密状态下处理和传输，不会以明文泄露给推理宿主机操作系统、平台运维人员或硬件管理员；工具结果进入推理请求后，也只在 TEE 内处理和传输时受到保护。",
  "需要使用本地工具时，你应主动提醒用户确认工具范围和数据的敏感程度，避免读取不必要的敏感文件或目录。",
  "说明身份或运行背景时，可以描述自己运行在由远程证明验证的密态推理环境中，并说明 Agent 的工具执行发生在用户本地环境；但不要虚构具体硬件型号、证明服务实现细节或其他未提供的体系结构信息。",
].join("\n");

type StreamEvent =
  | { kind: "turnStart"; turn: number }
  | { kind: "reasoningDelta"; text: string }
  | { kind: "contentDelta"; text: string }
  | { kind: "toolStart"; id: string; name: string; arguments: string }
  | { kind: "toolEnd"; id: string; status: "running" | "ok" | "error" | "cancelled"; summary: string }
  | { kind: "notice"; message: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

type StreamCallback = (event: StreamEvent) => void;

interface ChatCapture {
  emit: StreamCallback;
  resolveChat: () => void;
  reject: (error: unknown) => void;
}

interface AgentCapture {
  emit: StreamCallback;
  resolveAgent: (result: { stopped: boolean; messages: InferenceMessage[] }) => void;
  reject: (error: unknown) => void;
}

let activeWrapper: VueWrapper | undefined;

function trackWrapper(wrapper: VueWrapper): VueWrapper {
  activeWrapper = wrapper;
  return wrapper;
}

function mountView() {
  return trackWrapper(mount(InferenceView, { global: globalComponents }));
}

async function mountAndLoadModels(models: string[]) {
  tauriMocks.listModels.mockResolvedValueOnce(models);
  const wrapper = mountView();
  await flushPromises();
  return wrapper;
}

function useSynchronousAnimationFrame(): void {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    void Promise.resolve().then(() => callback(0));
    return 1;
  });
}

function mockStreamOnce(): ChatCapture {
  const capture = {} as ChatCapture;
  tauriMocks.sendInferenceStream.mockImplementationOnce(
    (
      _requestId: string,
      _port: number,
      _model: string,
      _apiKey: string,
      _messages: unknown[],
      _systemPrompt: string | null,
      _reasoningEffort: string,
      onEvent: StreamCallback,
    ) =>
      new Promise<"completed" | "stopped">((resolve, reject) => {
        capture.emit = onEvent;
        capture.resolveChat = () => resolve("completed");
        capture.reject = reject;
      }),
  );
  return capture;
}

function mockAgentRunOnce(): AgentCapture {
  const capture = {} as AgentCapture;
  tauriMocks.runAgentMessage.mockImplementationOnce(
    (
      _requestId: string,
      _port: number,
      _model: string,
      _apiKey: string,
      _messages: unknown[],
      _systemPrompt: string | null,
      _reasoningEffort: string,
      onEvent: StreamCallback,
    ) =>
      new Promise<{ stopped: boolean; messages: InferenceMessage[] }>((resolve, reject) => {
        capture.emit = onEvent;
        capture.resolveAgent = (result) => resolve(result);
        capture.reject = reject;
      }),
  );
  return capture;
}

function mockResolvedStreamOnce(text = "最终回答"): void {
  tauriMocks.sendInferenceStream.mockImplementationOnce(
    (
      _requestId: string,
      _port: number,
      _model: string,
      _apiKey: string,
      _messages: unknown[],
      _systemPrompt: string | null,
      _reasoningEffort: string,
      onEvent: StreamCallback,
    ) => {
      onEvent({ kind: "contentDelta", text });
      return Promise.resolve("completed");
    },
  );
}

async function setDraft(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.find("textarea.prompt-textarea").setValue(text);
}

function composerValue(wrapper: VueWrapper): string {
  return (wrapper.get("textarea.prompt-textarea").element as HTMLTextAreaElement).value;
}

async function sendDraft(wrapper: VueWrapper, text: string): Promise<void> {
  await setDraft(wrapper, text);
  await wrapper.find("button.send-button").trigger("click");
  await flushPromises();
  await nextTick();
}

/** 完整跑完一轮对话模式：发一轮、回一段 content、resolve 为 completed。 */
async function completeChatTurn(wrapper: VueWrapper, text: string, answer = "回答"): Promise<void> {
  const capture = mockStreamOnce();
  await sendDraft(wrapper, text);
  capture.emit({ kind: "contentDelta", text: answer });
  capture.resolveChat();
  await flushPromises();
  await nextTick();
}

/** 把运行模式切到 Agent：直接驱动控件，验证切换本身也生效。 */
async function switchToAgentMode(wrapper: VueWrapper): Promise<void> {
  wrapper.findAllComponents(Switch)[1].vm.$emit("update:checked", true);
  await nextTick();
}

const KeepAliveHarness = defineComponent({
  name: "KeepAliveHarness",
  components: { InferenceView, BlankView: defineComponent({ name: "BlankView", template: "<div>other page</div>" }) },
  props: { show: { type: Boolean, required: true } },
  template: `
    <KeepAlive include="InferenceView">
      <InferenceView v-if="show" />
      <BlankView v-else />
    </KeepAlive>
  `,
});

function mountKeepAliveHarness(): VueWrapper {
  tauriMocks.listModels.mockResolvedValueOnce(["keepalive-model"]);
  return trackWrapper(mount(KeepAliveHarness, {
    props: { show: true },
    global: globalComponents,
  }));
}

describe("InferenceView", () => {
  /** 身份注入开关：工具条里的第一个 Switch。 */
  function identitySwitch(wrapper: VueWrapper) {
    return wrapper.findAllComponents(Switch)[0];
  }
  /** 运行模式开关：输入框左侧的第二个 Switch。 */
  function modeSwitch(wrapper: VueWrapper) {
    return wrapper.findAllComponents(Switch)[1];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.document.body.innerHTML = "";
    tngRunningState.value = true;
    const inference = useInferenceConfig();
    inference.initializeApiKey("test-key");
    inference.failModelDiscovery();
    // 共享会话与运行模式是模块级进程状态：每个用例都从干净状态开始。
    inference.newSession();
    inference.selectRunMode("chat");
    tauriMocks.proxyEndpoint.mockReset().mockResolvedValue([{ port: 18080 }]);
    tauriMocks.proxyDiagnostics.mockReset().mockResolvedValue({
      proxy_running: true,
      identity_valid_total: 3,
      identity_rejected_total: 1,
      payload_rejected_total: 2,
      discovery_success_total: 4,
      discovery_failure_total: 1,
      upstream_failure_total: 0,
    });
    tauriMocks.listModels.mockReset().mockResolvedValue(["model-a"]);
    tauriMocks.sendInferenceStream.mockReset().mockResolvedValue("completed");
    tauriMocks.runAgentMessage.mockReset().mockResolvedValue({ stopped: false, messages: [] });
    tauriMocks.stopInferenceStream.mockReset().mockResolvedValue(true);
    tauriMocks.flushSettingsCache.mockReset().mockResolvedValue(undefined);
    tauriMocks.saveConfig.mockReset().mockResolvedValue(undefined);
    tauriMocks.launchTng.mockReset().mockResolvedValue(0);
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("disables the dropdown and send button when no models are detected", async () => {
    const wrapper = await mountAndLoadModels([]);
    const select = wrapper.findComponent(Select);
    expect(select.props("disabled")).toBe(true);
    expect(select.props("placeholder")).toBe("未检测到密态模型");
    const sendButton = wrapper.find("button.send-button");
    expect(sendButton.attributes("disabled")).toBeDefined();
    await sendButton.trigger("click");
    await flushPromises();
    expect(tauriMocks.sendInferenceStream).not.toHaveBeenCalled();
    expect(messageMocks.warning).not.toHaveBeenCalled();
  });

  it("shows a distinct discovery failure instead of pretending the list is empty", async () => {
    tauriMocks.listModels.mockRejectedValueOnce(new Error("gateway down"));
    const wrapper = mountView();
    await flushPromises();
    const select = wrapper.findComponent(Select);
    expect(select.props("disabled")).toBe(true);
    expect(select.props("placeholder")).toBe("模型列表加载失败");
    expect(messageMocks.error).toHaveBeenCalledWith(expect.stringContaining("gateway down"));
  });

  it("renders read-only fixed proxy diagnostic categories and states", async () => {
    const wrapper = await mountAndLoadModels(["model-a"]);
    const section = wrapper.find('[aria-label="代理统计"]');
    expect(section.exists()).toBe(true);
    expect(section.text()).toContain("错误");
    expect(section.text()).toContain("身份拒绝");
    expect(section.text()).toContain("4");
    expect(section.attributes("title")).toContain("模型授权");
    expect(section.text()).not.toContain("model-a");
  });

  it("refreshes session diagnostics and resets them after restart polling", async () => {
    vi.useFakeTimers({ now: 0 });
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.find('[aria-label="代理统计"]').text()).toContain("错误");

    tauriMocks.proxyDiagnostics.mockResolvedValueOnce({
      proxy_running: false,
      identity_valid_total: 0,
      identity_rejected_total: 0,
      payload_rejected_total: 0,
      discovery_success_total: 0,
      discovery_failure_total: 0,
      upstream_failure_total: 0,
    });
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    await nextTick();

    const section = wrapper.find('[aria-label="代理统计"]');
    expect(section.text()).toContain("停止");
    expect(section.text()).not.toContain("错误");
    expect(tauriMocks.proxyDiagnostics.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps model discovery independent when diagnostic polling fails", async () => {
    tauriMocks.proxyDiagnostics.mockRejectedValue(new Error("diagnostics unavailable"));
    const wrapper = await mountAndLoadModels(["model-a"]);
    const select = wrapper.findComponent(Select);
    expect(select.props("disabled")).toBe(false);
    const section = wrapper.find('[aria-label="代理统计"]');
    expect(section.text()).toContain("停止");
    expect(messageMocks.error).not.toHaveBeenCalledWith(expect.stringContaining("diagnostics unavailable"));
  });

  it("shows the loading state before model discovery completes", async () => {
    let resolveModels: (ids: string[]) => void = () => {};
    tauriMocks.listModels.mockImplementationOnce(
      () => new Promise<string[]>((resolve) => { resolveModels = resolve; }),
    );
    const wrapper = mountView();
    await flushPromises();
    const select = wrapper.findComponent(Select);
    expect(select.props("disabled")).toBe(true);
    expect(select.props("placeholder")).toBe("正在获取模型列表…");
    resolveModels(["loaded-model"]);
    await flushPromises();
    expect(select.props("value")).toBe("loaded-model");
    expect(select.props("disabled")).toBe(false);
  });

  it("treats a missing proxy endpoint as discovery failure without selectable options", async () => {
    tauriMocks.proxyEndpoint.mockReset().mockResolvedValue([]);
    const wrapper = mountView();
    await flushPromises();
    const select = wrapper.findComponent(Select);
    expect(select.props("disabled")).toBe(true);
    expect(select.props("placeholder")).toBe("模型列表加载失败");
    expect(tauriMocks.listModels).not.toHaveBeenCalled();
  });

  it("renders the identity controls with defaults, fixed overlay sizing, and no persisted state", async () => {
    const wrapper = await mountAndLoadModels(["identity-model"]);
    const toolbar = wrapper.get(".chat-toolbar");
    const sectionClasses = toolbar
      .findAll(".model-control, .identity-control, .thinking-control")
      .map((section) => section.element.className);
    expect(sectionClasses).toEqual(["model-control", "identity-control", "thinking-control"]);
    expect(toolbar.findComponent(Switch).props("checked")).toBe(true);
    expect(toolbar.find(".identity-editor-backdrop").exists()).toBe(false);
    expect(toolbar.find("button.identity-edit-button").exists()).toBe(false);
    expect(toolbar.get("button.identity-label-trigger").text()).toBe("身份");

    await toolbar.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    const editor = toolbar.get(".identity-editor-backdrop");
    expect(editor.attributes("role")).toBe("dialog");
    const identityTextarea = wrapper
      .findAllComponents(Textarea)
      .find((component) => component.element.classList.contains("identity-prompt-textarea"));
    expect(identityTextarea).toBeTruthy();
    expect(identityTextarea?.props("autoSize")).toEqual({ minRows: 4, maxRows: 12 });
    expect((wrapper.get("textarea.identity-prompt-textarea").element as HTMLTextAreaElement).value).toBe(expectedIdentityPrompt);

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    const identityControlCss = themeCss.match(/\n\.identity-control \{[\s\S]*?\n\}/)?.[0] ?? "";
    const identityAnchorCss = themeCss.match(/\n\.identity-editor-anchor \{[\s\S]*?\n\}/)?.[0] ?? "";
    const identityControlsRowCss = themeCss.match(/\n\.identity-controls-row \{[\s\S]*?\n\}/)?.[0] ??
      "";
    const overlayCss = themeCss.match(/\n\.identity-editor-overlay \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(identityControlCss).toContain("flex: 1 1 auto");
    expect(identityControlCss).toContain("min-width: 0");
    expect(identityAnchorCss).toContain("justify-content: flex-end");
    expect(identityControlsRowCss).toContain("justify-content: flex-end");
    expect(overlayCss).toContain("width: 480px");
    expect(overlayCss).toContain("position: absolute");
    expect(readFileSync("src/assets/theme.css", "utf8")).toContain("body { min-width: 1120px;");
    expect(tauriMocks.flushSettingsCache).not.toHaveBeenCalled();
    expect(tauriMocks.saveConfig).not.toHaveBeenCalled();

    await toolbar.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    expect(toolbar.find(".identity-editor-backdrop").exists()).toBe(false);
  });

  it("turns identity injection off without adding a system message to the debug request", async () => {
    const wrapper = await mountAndLoadModels(["identity-off"]);
    identitySwitch(wrapper).vm.$emit("update:checked", false);
    await nextTick();
    expect(identitySwitch(wrapper).props("checked")).toBe(false);
    expect(wrapper.find(".identity-editor-backdrop").exists()).toBe(false);

    mockResolvedStreamOnce("无身份回答");
    await sendDraft(wrapper, "关闭身份");
    const [, , , , requestMessages, systemPrompt] = tauriMocks.sendInferenceStream.mock.calls[0];
    expect(systemPrompt).toBeNull();
    expect(requestMessages).toEqual([{ role: "user", content: "关闭身份" }]);
  });

  it("sends an edited identity prompt verbatim and only on the next request", async () => {
    useSynchronousAnimationFrame();
    const customPrompt = "  自定义身份\n\t保留空白  ";
    const first = await mountAndLoadModels(["identity-edit"]);
    await first.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    await first.get("textarea.identity-prompt-textarea").setValue(customPrompt);
    expect((first.get("textarea.identity-prompt-textarea").element as HTMLTextAreaElement).value).toBe(customPrompt);

    mockResolvedStreamOnce("修改后的回答");
    await sendDraft(first, "第一轮身份");
    expect(tauriMocks.sendInferenceStream.mock.calls[0][5]).toBe(customPrompt);

    await first.get("textarea.identity-prompt-textarea").setValue("发送后修改的身份");
    expect(tauriMocks.sendInferenceStream.mock.calls[0][5]).toBe(customPrompt);

    mockResolvedStreamOnce("下一轮回答");
    await sendDraft(first, "第二轮身份");
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(2);
    expect(tauriMocks.sendInferenceStream.mock.calls[1][5]).toBe("发送后修改的身份");
  });

  it("keeps an in-flight request unchanged while the identity state is edited", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["identity-flight"]);
    await sendDraft(wrapper, "进行中身份");
    const firstPrompt = tauriMocks.sendInferenceStream.mock.calls[0][5];
    expect(firstPrompt).toBe(expectedIdentityPrompt);

    await wrapper.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    await wrapper.get("textarea.identity-prompt-textarea").setValue("  进行中被编辑  ");
    expect(tauriMocks.sendInferenceStream.mock.calls[0][5]).toBe(expectedIdentityPrompt);
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);

    capture.resolveChat();
    await flushPromises();
    await nextTick();

    mockResolvedStreamOnce("下一轮回答");
    await sendDraft(wrapper, "下一轮");
    expect(tauriMocks.sendInferenceStream.mock.calls[1][5]).toBe("  进行中被编辑  ");
  });

  it("retains identity state through KeepAlive and resets it after a process-like remount", async () => {
    const kept = mountKeepAliveHarness();
    await flushPromises();
    identitySwitch(kept).vm.$emit("update:checked", false);
    await nextTick();
    await kept.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    await kept.get("textarea.identity-prompt-textarea").setValue("  页内保留身份  ");

    await kept.setProps({ show: false });
    await nextTick();
    await kept.setProps({ show: true });
    await nextTick();
    await flushPromises();

    expect(identitySwitch(kept).props("checked")).toBe(false);
    expect(kept.find(".identity-editor-backdrop").exists()).toBe(true);
    expect((kept.get("textarea.identity-prompt-textarea").element as HTMLTextAreaElement).value).toBe("  页内保留身份  ");
    expect(tauriMocks.flushSettingsCache).not.toHaveBeenCalled();

    kept.unmount();
    activeWrapper = undefined;
    const fresh = await mountAndLoadModels(["identity-fresh"]);
    expect(identitySwitch(fresh).props("checked")).toBe(true);
    expect(fresh.find(".identity-editor-backdrop").exists()).toBe(false);
    await fresh.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    expect((fresh.get("textarea.identity-prompt-textarea").element as HTMLTextAreaElement).value).toBe(expectedIdentityPrompt);
    expect(tauriMocks.flushSettingsCache).not.toHaveBeenCalled();
  });

  it("sends one untrimmed turn with default medium effort and renders both bubbles immediately", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);

    expect(wrapper.findComponent(Slider).props("value")).toBe(2);
    expect(wrapper.findComponent(Textarea).props("autoSize")).toEqual({ minRows: 1, maxRows: 8 });
    await sendDraft(wrapper, "  保留首尾空白  ");

    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    const [requestId, port, modelId, apiKey, requestMessages, systemPrompt, effort, onEvent] =
      tauriMocks.sendInferenceStream.mock.calls[0];
    expect(requestId).toBe("assistant-2");
    expect(port).toBe(18080);
    expect(modelId).toBe("capi-model");
    expect(apiKey).toBe("test-key");
    expect(requestMessages).toEqual([
      { role: "user", content: "  保留首尾空白  " },
    ]);
    expect(systemPrompt).toBe(expectedIdentityPrompt);
    expect(effort).toBe("medium");
    expect(typeof onEvent).toBe("function");

    // 滑块调整只影响下一轮，不改已发出请求。
    wrapper.findComponent(Slider).vm.$emit("update:value", 3);
    await nextTick();
    expect(effort).toBe("medium");

    expect(composerValue(wrapper)).toBe("");

    // 请求非终态时气泡保持正常淡绿色并显示解密中指示，主操作切换为停止而不是并行发送。
    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-pending");
    expect(wrapper.get(".decrypting-indicator").text()).toBe("▶解密中");
    await setDraft(wrapper, "第二条");
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    expect(tauriMocks.stopInferenceStream).toHaveBeenCalledWith(requestId);
    expect(wrapper.find(".user-message .user-bubble").text()).toBe("保留首尾空白");
    expect(wrapper.find(".assistant-message .assistant-bubble").exists()).toBe(true);
    expect(wrapper.find(".user-bubble").classes()).toContain("user-bubble");
    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-stopped");
    expect(wrapper.find(".decrypting-indicator").exists()).toBe(false);
    expect(wrapper.text()).toContain("已停止⚪响应不完整");
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);

    capture.resolveChat();
    await flushPromises();
  });

  it("keeps user, in-flight, and complete bubbles on the same soft-green visual state", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);

    await sendDraft(wrapper, "正常对话");
    const assistantBubble = wrapper.get(".assistant-message .chat-bubble");
    expect(assistantBubble.classes()).toContain("assistant-bubble-pending");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-stopped");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-failed");
    expect(wrapper.text()).toContain("解密中");

    capture.emit({ kind: "reasoningDelta", text: "思考增量" });
    await flushPromises();
    await nextTick();

    expect(assistantBubble.classes()).toContain("assistant-bubble-pending");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-stopped");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-failed");
    expect(wrapper.text()).toContain("生成中");

    capture.resolveChat();
    await flushPromises();
    await nextTick();

    expect(assistantBubble.classes()).toContain("assistant-bubble-complete");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-pending");

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    const normalGroup = themeCss.match(
      /\/\* 正常对话[\s\S]*?\.user-bubble,\s*\.assistant-bubble-pending,\s*\.assistant-bubble-complete\s*\{[\s\S]*?\}/,
    );
    expect(normalGroup).toBeTruthy();
    expect(normalGroup?.[0]).toContain("var(--chat-bubble-success-bg)");
    expect(normalGroup?.[0]).toContain("var(--chat-bubble-success-border)");
    expect(normalGroup?.[0]).not.toContain("background: #fff");
    expect(normalGroup?.[0]).not.toContain("var(--split)");
  });

  it("defaults to the first model, preserves in-list switches, and blocks custom text", async () => {
    const wrapper = await mountAndLoadModels(["first-model", "second-model"]);
    const select = wrapper.findComponent(Select);
    expect(select.props("value")).toBe("first-model");

    select.vm.$emit("update:value", "second-model");
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("second-model");

    select.vm.$emit("update:value", "not-from-capi");
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("second-model");
  });

  it("preserves a model through refresh and falls back when it disappears", async () => {
    const wrapper = await mountAndLoadModels(["old-model", "second-model"]);
    const inference = useInferenceConfig();
    inference.selectModel("second-model");
    inference.replaceModelList(["second-model", "third-model"]);
    await nextTick();
    expect(wrapper.findComponent(Select).props("value")).toBe("second-model");

    inference.replaceModelList(["third-model"]);
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("third-model");
    expect(wrapper.findComponent(Select).props("value")).toBe("third-model");
  });

  it("shows ▶解密中 until the first delta replaces it and removes it at terminal state", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    const transcript = wrapper.get(".chat-transcript");
    Object.defineProperty(transcript.element, "scrollHeight", { configurable: true, value: 987 });
    Object.defineProperty(transcript.element, "scrollTop", { configurable: true, writable: true, value: 0 });

    await sendDraft(wrapper, "解密中");
    expect(wrapper.get(".decrypting-indicator").text()).toBe("▶解密中");
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);
    expect(wrapper.find(".assistant-decrypting").exists()).toBe(true);

    capture.emit({ kind: "reasoningDelta", text: "先分析安全边界" });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".decrypting-indicator").exists()).toBe(false);
    expect(wrapper.find(".assistant-decrypting").exists()).toBe(false);
    expect(wrapper.find(".reasoning-text").text()).toBe("先分析安全边界");
    expect(wrapper.find(".streaming-caret").exists()).toBe(true);
    expect(wrapper.text()).toContain("生成中");

    capture.emit({ kind: "contentDelta", text: "这是开头" });
    await flushPromises();
    await nextTick();
    expect(wrapper.find(".response-text").text()).toBe("这是开头");

    capture.resolveChat();
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".decrypting-indicator").exists()).toBe(false);
    expect(wrapper.find(".streaming-caret").exists()).toBe(false);
    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-complete");
    expect(wrapper.text()).toContain("200 OK");
    expect(wrapper.find("button.send-button").attributes("disabled")).toBeUndefined();
    expect(transcript.element.scrollTop).toBe(987);

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    const decryptCss = themeCss.match(/\n\.assistant-decrypting \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(decryptCss).toContain("min-height");
    // 五步阶段动画的样式与节点已整体移除。
    expect(themeCss).not.toContain(".secure-flow");
    expect(themeCss).not.toContain(".stage-card");
    expect(themeCss).not.toContain(".stage-dot");
    expect(themeCss).not.toContain(".assistant-stage");
    expect(wrapper.find(".assistant-stage").exists()).toBe(false);
  });

  it("shows ▶解密中 in agent mode too and removes it once output arrives", async () => {
    useSynchronousAnimationFrame();
    const capture = mockAgentRunOnce();
    const wrapper = await mountAndLoadModels(["agent-decrypt"]);
    await switchToAgentMode(wrapper);
    await sendDraft(wrapper, "Agent 解密中");

    expect(wrapper.get(".decrypting-indicator").text()).toBe("▶解密中");
    capture.emit({ kind: "turnStart", turn: 1 });
    await flushPromises();
    await nextTick();
    expect(wrapper.get(".decrypting-indicator").text()).toBe("▶解密中");

    capture.emit({ kind: "contentDelta", text: "Agent 输出" });
    await flushPromises();
    await nextTick();
    expect(wrapper.find(".decrypting-indicator").exists()).toBe(false);
    expect(wrapper.find(".response-text").text()).toBe("Agent 输出");
    capture.resolveAgent({ stopped: false, messages: [] });
    await flushPromises();
  });

  it("appends streaming deltas in order and always scrolls the transcript", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    const transcript = wrapper.get(".chat-transcript");
    let scrollHeight = 100;
    Object.defineProperty(transcript.element, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(transcript.element, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    await sendDraft(wrapper, "流式输出");
    capture.emit({ kind: "reasoningDelta", text: "思考-1" });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".reasoning-text").text()).toBe("思考-1");
    expect(wrapper.find(".response-text").exists()).toBe(false);
    expect(transcript.element.scrollTop).toBe(100);

    scrollHeight = 240;
    capture.emit({ kind: "contentDelta", text: "回答-1" });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".reasoning-text").text()).toBe("思考-1");
    expect(wrapper.find(".response-text").text()).toBe("回答-1");
    expect(transcript.element.scrollTop).toBe(240);

    scrollHeight = 360;
    capture.emit({ kind: "contentDelta", text: "-2" });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".response-text").text()).toBe("回答-1-2");
    expect(transcript.element.scrollTop).toBe(360);

    capture.resolveChat();
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("200 OK");
  });

  it("maps all four thinking levels and keeps an in-flight request unchanged", async () => {
    useSynchronousAnimationFrame();
    const wrapper = await mountAndLoadModels(["thinking-model"]);
    const efforts: string[] = [];
    const inputs = ["off", "low", "medium-default", "high"];
    const levels = [0, 1, 2, 3];
    const expected = ["none", "low", "medium", "high"];

    for (let index = 0; index < 4; index += 1) {
      mockResolvedStreamOnce(`回答-${index}`);
      wrapper.findComponent(Slider).vm.$emit("update:value", levels[index]);
      await nextTick();
      await sendDraft(wrapper, inputs[index]);
      const call = tauriMocks.sendInferenceStream.mock.calls[index];
      efforts.push(call[6]);
    }

    expect(efforts).toEqual(expected);
    expect(wrapper.findComponent(Slider).props("value")).toBe(3);
    expect(wrapper.text()).not.toContain("thinking_token_budget");
    expect(wrapper.text()).not.toContain("本客户端不是聊天工具");
    expect(tauriMocks.flushSettingsCache).not.toHaveBeenCalled();
    expect(tauriMocks.saveConfig).not.toHaveBeenCalled();
    expect(tauriMocks.launchTng).not.toHaveBeenCalled();
  });

  it("builds later context from completed content only and serializes one request at a time", async () => {
    useSynchronousAnimationFrame();
    const firstCapture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "第一轮");
    firstCapture.emit({ kind: "reasoningDelta", text: "不进入上下文" });
    firstCapture.emit({ kind: "contentDelta", text: "第一轮回答" });
    firstCapture.resolveChat();
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("200 OK");

    // 完成后才能进入下轮，本轮生成中不可并行发送。
    const secondCapture = mockStreamOnce();
    await sendDraft(wrapper, "  第二轮原文  ");
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(2);
    const [, , , , secondMessages, , effort] = tauriMocks.sendInferenceStream.mock.calls[1];
    expect(secondMessages).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "第一轮回答" },
      { role: "user", content: "  第二轮原文  " },
    ]);
    expect(JSON.stringify(secondMessages)).not.toContain("不进入上下文");
    expect(effort).toBe("medium");

    await setDraft(wrapper, "第三轮");
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(2);
    secondCapture.resolveChat();
    await flushPromises();
  });

  it("shows a failed turn with partial text, redacted diagnostics, and excludes it from later context", async () => {
    useSynchronousAnimationFrame();
    const firstCapture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "失败轮");

    firstCapture.emit({ kind: "reasoningDelta", text: "部分思考" });
    firstCapture.emit({ kind: "contentDelta", text: "部分回答" });
    firstCapture.reject("发送失败: 流中断\nAuthorization: Bearer <已隐藏>");
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".reasoning-text").text()).toBe("部分思考");
    expect(wrapper.find(".response-text").text()).toBe("部分回答");
    expect(wrapper.text()).toContain("请求失败");
    expect(wrapper.text()).toContain("响应不完整");
    expect(wrapper.find("pre.assistant-debug").text()).toContain("流中断");
    expect(wrapper.find("pre.assistant-debug").text()).toContain("Bearer <已隐藏>");
    expect(wrapper.find("pre.assistant-debug").text()).not.toContain("Bearer test-key");
    expect(wrapper.find("button.send-button").attributes("disabled")).toBeUndefined();

    const secondCapture = mockStreamOnce();
    await sendDraft(wrapper, "下一轮");
    const [, , , , secondMessages] = tauriMocks.sendInferenceStream.mock.calls[1];
    expect(secondMessages).toEqual([
      { role: "user", content: "失败轮" },
      { role: "user", content: "下一轮" },
    ]);
    secondCapture.resolveChat();
    await flushPromises();
  });

  it("enters terminal failure immediately when no delta arrives", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "无输出失败");

    capture.reject("发送失败: HTTP 502\nAuthorization: Bearer <已隐藏>");
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-failed");
    expect(wrapper.find(".decrypting-indicator").exists()).toBe(false);
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);
    expect(wrapper.text()).toContain("请求失败");
    expect(wrapper.find("pre.assistant-debug").text()).toContain("HTTP 502");
    expect(wrapper.find("button.send-button").attributes("disabled")).toBeUndefined();
  });

  it("keeps displayed text when the user stops after output is revealed", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "流式中停止");
    capture.emit({ kind: "reasoningDelta", text: "已显示思考" });
    capture.emit({ kind: "contentDelta", text: "已显示回答" });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".assistant-bubble").classes()).toContain("assistant-bubble-pending");
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    await nextTick();

    const requestId = tauriMocks.sendInferenceStream.mock.calls[0][0];
    expect(tauriMocks.stopInferenceStream).toHaveBeenCalledWith(requestId);
    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-stopped");
    expect(wrapper.text()).toContain("已停止⚪响应不完整");
    expect(wrapper.find(".reasoning-text").text()).toBe("已显示思考");
    expect(wrapper.find(".response-text").text()).toBe("已显示回答");

    capture.emit({ kind: "reasoningDelta", text: "迟到思考" });
    capture.emit({ kind: "contentDelta", text: "迟到回答" });
    capture.resolveChat();
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".reasoning-text").text()).toBe("已显示思考");
    expect(wrapper.find(".response-text").text()).toBe("已显示回答");
    const actionButton = wrapper.get("button.send-button");
    expect(actionButton.attributes("aria-label")).toBe("发送");
    expect(actionButton.find(".anticon-send").exists()).toBe(true);
    expect(actionButton.text()).toBe("");

    const secondCapture = mockStreamOnce();
    await sendDraft(wrapper, "下一轮");
    const [, , , , secondMessages] = tauriMocks.sendInferenceStream.mock.calls[1];
    expect(secondMessages).toEqual([
      { role: "user", content: "流式中停止" },
      { role: "user", content: "下一轮" },
    ]);
    secondCapture.resolveChat();
    await flushPromises();
  });

  it("stops while still decrypting and keeps a blank stopped bubble", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "解密中停止");

    expect(wrapper.get(".decrypting-indicator").text()).toBe("▶解密中");
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    await nextTick();

    const requestId = tauriMocks.sendInferenceStream.mock.calls[0][0];
    expect(tauriMocks.stopInferenceStream).toHaveBeenCalledWith(requestId);
    expect(wrapper.find(".decrypting-indicator").exists()).toBe(false);
    expect(wrapper.find(".reasoning-text").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);
    expect(wrapper.text()).toContain("已停止⚪响应不完整");

    capture.emit({ kind: "contentDelta", text: "迟到输出" });
    capture.resolveChat();
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).not.toContain("迟到输出");

    const secondCapture = mockStreamOnce();
    await sendDraft(wrapper, "停止后的下一轮");
    const [, , , , secondMessages] = tauriMocks.sendInferenceStream.mock.calls[1];
    expect(secondMessages).toEqual([
      { role: "user", content: "解密中停止" },
      { role: "user", content: "停止后的下一轮" },
    ]);
    secondCapture.resolveChat();
    await flushPromises();
  });

  it("does not stop automatically when navigating away and can stop after returning", async () => {
    useSynchronousAnimationFrame();
    mockStreamOnce();
    const wrapper = mountKeepAliveHarness();
    await flushPromises();
    await sendDraft(wrapper, "切页后停止");

    await wrapper.setProps({ show: false });
    await nextTick();
    expect(tauriMocks.stopInferenceStream).not.toHaveBeenCalled();

    await wrapper.setProps({ show: true });
    await nextTick();
    await flushPromises();
    const stopButton = wrapper.get("button.send-button");
    expect(stopButton.classes()).toContain("stop-button");
    expect(stopButton.attributes("aria-label")).toBe("停止");
    expect(stopButton.find(".stop-square-icon").exists()).toBe(true);
    await stopButton.trigger("click");
    await flushPromises();
    const requestId = tauriMocks.sendInferenceStream.mock.calls[0][0];
    expect(tauriMocks.stopInferenceStream).toHaveBeenCalledWith(requestId);
  });

  it("retains draft, slider, and in-flight stream through KeepAlive page switches", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = mountKeepAliveHarness();
    await flushPromises();

    await sendDraft(wrapper, "离开页面期间继续");
    wrapper.findComponent(Slider).vm.$emit("update:value", 3);
    await nextTick();
    await setDraft(wrapper, "保留的未发送草稿");

    await wrapper.setProps({ show: false });
    await nextTick();
    expect(wrapper.text()).toContain("other page");

    capture.emit({ kind: "reasoningDelta", text: "后台思考" });
    capture.emit({ kind: "contentDelta", text: "后台回答" });
    capture.resolveChat();
    await flushPromises();

    await wrapper.setProps({ show: true });
    await nextTick();
    await flushPromises();

    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    expect(composerValue(wrapper)).toBe("保留的未发送草稿");
    expect(wrapper.findComponent(Slider).props("value")).toBe(3);
    expect(wrapper.find(".reasoning-text").text()).toBe("后台思考");
    expect(wrapper.find(".response-text").text()).toBe("后台回答");
    expect(wrapper.text()).toContain("200 OK");
    expect(tauriMocks.flushSettingsCache).not.toHaveBeenCalled();
  });

  it("returns to fresh in-memory state after a process-like remount", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const first = await mountAndLoadModels(["restart-model"]);
    await sendDraft(first, "旧进程消息");
    capture.resolveChat();
    await flushPromises();

    first.unmount();
    activeWrapper = undefined;
    // 模拟进程重启：模块级共享会话也应随之清空。
    useInferenceConfig().newSession();
    const second = await mountAndLoadModels(["restart-model"]);
    expect(second.find(".user-message").exists()).toBe(false);
    expect(composerValue(second)).toBe("");
    expect(second.findComponent(Slider).props("value")).toBe(2);
    expect(second.text()).toContain("发送一条消息，开始多轮密态推理验证");
  });

  it("renders 新会话 left of the model dropdown and the run-mode switch at the old reset position", async () => {
    const wrapper = await mountAndLoadModels(["layout-model"]);
    const toolbar = wrapper.get(".chat-toolbar");
    const children = Array.from(toolbar.element.children);
    expect(children[0].classList.contains("new-session-button")).toBe(true);
    expect(children[1].classList.contains("model-control")).toBe(true);
    expect(toolbar.get("button.new-session-button").text()).toBe("新会话");
    expect(toolbar.find(".reset-button").exists()).toBe(false);

    // 输入框左侧原先的"重置"位置改为运行模式分段切换控件。
    const composer = wrapper.get(".chat-composer");
    expect(composer.find(".reset-button").exists()).toBe(false);
    const mode = modeSwitch(wrapper);
    expect(mode.props("checkedChildren")).toBe("Agent 模式");
    expect(mode.props("unCheckedChildren")).toBe("对话模式");
    expect(composer.find(".run-mode-control").exists()).toBe(true);

    // 与设置页入口配置的本机端口切换控件同款：a-switch + checked/un-checked children。
    const entryEditor = readFileSync("src/components/EntryEditor.vue", "utf8");
    expect(entryEditor).toContain('checked-children="0.0.0.0"');
    expect(entryEditor).toContain('un-checked-children="127.0.0.1"');
    const viewSource = readFileSync("src/views/InferenceView.vue", "utf8");
    expect(viewSource).toContain('checked-children="Agent 模式"');
    expect(viewSource).toContain('un-checked-children="对话模式"');

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    const newSessionCss = themeCss.match(/\n\.new-session-button \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(newSessionCss).toContain("height: 32px");
    expect(themeCss).not.toContain(".reset-button");
    // `新对话` 分隔线仍是 `新会话` 的生效标记，保留低对比样式。
    const boundaryCss = themeCss.match(/\n\.conversation-boundary \{[\s\S]*?\n\}/)?.[0] ?? "";
    const boundaryLineCss = themeCss.match(
      /\n\.conversation-boundary::before,\s*\.conversation-boundary::after \{[\s\S]*?\n\}/,
    )?.[0] ?? "";
    expect(boundaryCss).toContain("color: var(--text-tertiary)");
    expect(boundaryLineCss).toContain("background: rgba(90, 103, 126, .18)");
  });

  it("keeps the run-mode switch centered with the send button and pinned when the input grows", async () => {
    const wrapper = await mountAndLoadModels(["composer-layout"]);

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    // 输入栏整行贴底：文本域增高时按钮与模式切换都不会跟着上移。
    const composerCss = themeCss.match(/\n\.chat-composer \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(composerCss).toContain("align-items: flex-end");

    // 模式切换与发送按钮同为 32px 高、同样贴底，因此两者竖向居中对齐。
    const runModeCss = themeCss.match(/\n\.run-mode-control \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(runModeCss).toContain("align-self: flex-end");
    expect(runModeCss).toContain("height: var(--composer-control-size, 32px)");
    expect(runModeCss).toContain("align-items: center");
    const sendCss = themeCss.match(/\n\.send-button \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(sendCss).toContain("height: var(--composer-control-size, 32px)");

    const composer = wrapper.get(".chat-composer");
    expect(composer.find(".run-mode-control .ant-switch").exists()).toBe(true);
    expect(composer.find("button.send-button").exists()).toBe(true);
    // 模式切换在输入框左侧，发送按钮在右侧。
    const children = Array.from(composer.element.children);
    expect(children[0].classList.contains("run-mode-control")).toBe(true);
    expect(children[children.length - 1].classList.contains("send-button")).toBe(true);
  });

  it("inserts a 新对话 boundary on 新会话, cutting the request context but keeping history", async () => {
    useSynchronousAnimationFrame();
    const wrapper = await mountAndLoadModels(["new-session-model"]);
    await completeChatTurn(wrapper, "旧用户", "旧回答");

    const newSessionButton = wrapper.get("button.new-session-button");
    expect(newSessionButton.text()).toBe("新会话");
    expect(newSessionButton.attributes("disabled")).toBeUndefined();

    await setDraft(wrapper, "保留的草稿");
    wrapper.findComponent(Slider).vm.$emit("update:value", 3);
    await nextTick();
    await newSessionButton.trigger("click");
    await nextTick();

    // 既有聊天记录仍可见，末尾插入一条"新对话"分隔线。
    expect(wrapper.get(".user-message .user-bubble").text()).toBe("旧用户");
    expect(wrapper.get(".assistant-message .assistant-content").text()).toContain("旧回答");
    const boundary = wrapper.get(".conversation-boundary");
    expect(boundary.attributes("aria-label")).toBe("新对话分隔");
    expect(boundary.get(".new-conversation-label").text()).toBe("新对话");
    expect(wrapper.findAll(".conversation-boundary")).toHaveLength(1);

    // 只切请求上下文：共享会话被清空，聊天显示不受影响。
    expect(useInferenceConfig().toRequestMessages()).toEqual([]);

    // 调试参数与草稿保留。
    expect(wrapper.findComponent(Select).props("value")).toBe("new-session-model");
    expect(wrapper.findComponent(Slider).props("value")).toBe(3);
    expect(composerValue(wrapper)).toBe("保留的草稿");

    mockStreamOnce();
    await sendDraft(wrapper, "新用户");
    const [, , , , requestMessages, , effort] = tauriMocks.sendInferenceStream.mock.calls[1];
    expect(requestMessages).toEqual([{ role: "user", content: "新用户" }]);
    expect(effort).toBe("high");
    expect(wrapper.findAll(".conversation-boundary")).toHaveLength(1);
    expect(wrapper.text()).toContain("旧用户");
    expect(wrapper.text()).toContain("旧回答");
  });

  it("only inserts another boundary after a new conversation completes", async () => {
    useSynchronousAnimationFrame();
    const wrapper = await mountAndLoadModels(["multiple-boundary-model"]);
    await completeChatTurn(wrapper, "第一段", "第一段回答");

    await wrapper.get("button.new-session-button").trigger("click");
    await nextTick();
    expect(wrapper.findAll(".conversation-boundary")).toHaveLength(1);
    expect(wrapper.get("button.new-session-button").attributes("disabled")).toBeDefined();

    await wrapper.get("button.new-session-button").trigger("click");
    await nextTick();
    expect(wrapper.findAll(".conversation-boundary")).toHaveLength(1);

    await completeChatTurn(wrapper, "第二段", "第二段回答");
    expect(wrapper.get("button.new-session-button").attributes("disabled")).toBeUndefined();
    await wrapper.get("button.new-session-button").trigger("click");
    await nextTick();

    expect(wrapper.findAll(".conversation-boundary")).toHaveLength(2);
    expect(wrapper.findAll(".user-message")).toHaveLength(2);
    expect(wrapper.findAll(".assistant-message")).toHaveLength(2);
  });
  it("disables 新会话 while a request is in flight", async () => {
    useSynchronousAnimationFrame();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["inflight-model"]);
    await sendDraft(wrapper, "进行中");

    const newSessionButton = wrapper.get("button.new-session-button");
    expect(newSessionButton.attributes("disabled")).toBeDefined();
    await newSessionButton.trigger("click");
    await nextTick();
    expect(useInferenceConfig().toRequestMessages()).toEqual([{ role: "user", content: "进行中" }]);

    capture.resolveChat();
    await flushPromises();
    await nextTick();
    expect(wrapper.get("button.new-session-button").attributes("disabled")).toBeUndefined();
  });

  it("switches run mode per request and keeps the shared context", async () => {
    useSynchronousAnimationFrame();
    const wrapper = await mountAndLoadModels(["mode-model"]);
    await completeChatTurn(wrapper, "第一轮", "第一轮回答");

    expect(modeSwitch(wrapper).props("checked")).toBe(false);
    await switchToAgentMode(wrapper);
    expect(useInferenceConfig().runMode.value).toBe("agent");
    // 切换模式不清空上下文。
    expect(useInferenceConfig().toRequestMessages()).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "第一轮回答" },
    ]);
    expect(wrapper.find(".user-message").exists()).toBe(true);

    const capture = mockAgentRunOnce();
    await sendDraft(wrapper, "Agent 轮");
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    expect(tauriMocks.runAgentMessage).toHaveBeenCalledTimes(1);
    const [, port, modelId, apiKey, messages, systemPrompt, effort] = tauriMocks.runAgentMessage.mock.calls[0];
    expect(port).toBe(18080);
    expect(modelId).toBe("mode-model");
    expect(apiKey).toBe("test-key");
    expect(messages).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "第一轮回答" },
      { role: "user", content: "Agent 轮" },
    ]);
    expect(systemPrompt).toBe(expectedIdentityPrompt);
    expect(effort).toBe("medium");

    capture.resolveAgent({ stopped: false, messages: [{ role: "assistant", content: "Agent 回答" }] });
    await flushPromises();
    await nextTick();
    expect(useInferenceConfig().toRequestMessages()).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "第一轮回答" },
      { role: "user", content: "Agent 轮" },
      { role: "assistant", content: "Agent 回答" },
    ]);
  });

  it("renders an agent run as one assistant bubble with an inline tool timeline", async () => {
    useSynchronousAnimationFrame();
    const capture = mockAgentRunOnce();
    const wrapper = await mountAndLoadModels(["agent-model"]);
    await switchToAgentMode(wrapper);
    await sendDraft(wrapper, "读文件");

    expect(wrapper.findAll(".assistant-message")).toHaveLength(1);
    capture.emit({ kind: "turnStart", turn: 1 });
    capture.emit({ kind: "reasoningDelta", text: "先看看文件" });
    capture.emit({ kind: "toolStart", id: "c1", name: "read", arguments: '{"path":"/tmp/a"}' });
    await flushPromises();
    await nextTick();

    let step = wrapper.get(".tool-step");
    expect(step.get(".tool-step-name").text()).toBe("read");
    expect(step.get(".tool-step-args").text()).toContain('"path":"/tmp/a"');
    expect(step.text()).toContain("进行中");
    expect(step.classes()).toContain("tool-step-running");
    expect(wrapper.get(".reasoning-text").text()).toBe("先看看文件");

    capture.emit({ kind: "toolEnd", id: "c1", status: "ok", summary: "文件内容" });
    await flushPromises();
    await nextTick();
    step = wrapper.get(".tool-step");
    expect(step.text()).toContain("成功");
    expect(step.get(".tool-step-summary").text()).toBe("文件内容");
    expect(step.classes()).toContain("tool-step-ok");

    capture.emit({ kind: "toolStart", id: "c2", name: "grep", arguments: '{"pattern":"x"}' });
    capture.emit({ kind: "toolEnd", id: "c2", status: "error", summary: "无权限" });
    capture.emit({ kind: "contentDelta", text: "最终回答" });
    await flushPromises();
    await nextTick();

    expect(wrapper.findAll(".tool-step")).toHaveLength(2);
    expect(wrapper.get(".tool-step-error").text()).toContain("失败");
    expect(wrapper.get(".response-text").text()).toBe("最终回答");
    // 整轮交互只在一个 assistant 气泡内。
    expect(wrapper.findAll(".assistant-message")).toHaveLength(1);

    capture.resolveAgent({
      stopped: false,
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: '{"path":"/tmp/a"}' } }],
        },
        { role: "tool", content: "文件内容", tool_call_id: "c1" },
        { role: "assistant", content: "最终回答" },
      ],
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("200 OK");
    expect(useInferenceConfig().toRequestMessages()).toEqual([
      { role: "user", content: "读文件" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: '{"path":"/tmp/a"}' } }],
      },
      { role: "tool", content: "文件内容", tool_call_id: "c1" },
      { role: "assistant", content: "最终回答" },
    ]);
  });

  it("renders a round-limit notice inside the agent bubble", async () => {
    useSynchronousAnimationFrame();
    const capture = mockAgentRunOnce();
    const wrapper = await mountAndLoadModels(["agent-budget"]);
    await switchToAgentMode(wrapper);
    await sendDraft(wrapper, "跑满轮数");

    capture.emit({ kind: "contentDelta", text: "部分输出" });
    capture.emit({ kind: "notice", message: "已达轮数上限（30）" });
    await flushPromises();
    await nextTick();

    expect(wrapper.get(".tool-notice").text()).toContain("已达轮数上限");
    expect(wrapper.get(".response-text").text()).toBe("部分输出");
    expect(wrapper.findAll(".assistant-message")).toHaveLength(1);

    capture.resolveAgent({ stopped: false, messages: [] });
    await flushPromises();
  });

  it("marks a stopped agent run as cancelled and keeps the partial timeline", async () => {
    useSynchronousAnimationFrame();
    const capture = mockAgentRunOnce();
    const wrapper = await mountAndLoadModels(["agent-stop"]);
    await switchToAgentMode(wrapper);
    await sendDraft(wrapper, "停止轮");

    capture.emit({ kind: "toolStart", id: "c1", name: "read", arguments: "{}" });
    await flushPromises();
    await nextTick();
    expect(wrapper.get(".tool-step").text()).toContain("进行中");

    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    await nextTick();
    const requestId = tauriMocks.runAgentMessage.mock.calls[0][0];
    expect(tauriMocks.stopInferenceStream).toHaveBeenCalledWith(requestId);

    // 停止后后端迟到的 toolEnd(cancelled) 被终态过滤，步骤仍显示已取消。
    capture.emit({ kind: "toolEnd", id: "c1", status: "cancelled", summary: "" });
    capture.resolveAgent({ stopped: true, messages: [] });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-stopped");
    expect(wrapper.text()).toContain("已停止⚪响应不完整");
    expect(wrapper.get(".tool-step").text()).toContain("已取消");
    // 被停止的运行不进入后续上下文，只有用户消息保留。
    expect(useInferenceConfig().toRequestMessages()).toEqual([{ role: "user", content: "停止轮" }]);
  });

  it("renders compact request controls and an icon-only circular composer action", async () => {
    const wrapper = await mountAndLoadModels(["compact-style"]);
    expect(wrapper.get(".model-control").find(".control-label").exists()).toBe(false);
    expect(wrapper.get(".model-control").attributes("aria-label")).toBeUndefined();

    const sendButton = wrapper.get("button.send-button");
    expect(sendButton.attributes("aria-label")).toBe("发送");
    expect(sendButton.find(".anticon-send").exists()).toBe(true);
    expect(sendButton.text()).toBe("");

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    const modelControlCss = themeCss.match(/\n\.model-control \{[\s\S]*?\n\}/);
    const thinkingControlCss = themeCss.match(/\n\.thinking-control \{[\s\S]*?\n\}/);
    const buttonCss = themeCss.match(/\n\.send-button \{[\s\S]*?\n\}/);

    expect(modelControlCss?.[0]).toContain("flex: 0 0 200px");
    expect(modelControlCss?.[0]).toContain("min-width: 200px");
    expect(thinkingControlCss?.[0]).toContain("flex: 0 0 280px");
    expect(thinkingControlCss?.[0]).toContain("min-width: 280px");
    expect(themeCss).not.toContain(".chat-toolbar { flex-direction: column; align-items: stretch; }");
    const toolbarCss = themeCss.match(/\n\.chat-toolbar \{[\s\S]*?\n\}/);
    expect(toolbarCss?.[0]).toContain("flex-wrap: nowrap");
    const identityControlCss = themeCss.match(/\n\.identity-control \{[\s\S]*?\n\}/)?.[0] ?? "";
    const identityOverlayCss = themeCss.match(/\n\.identity-editor-overlay \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(identityControlCss).toContain("flex: 1 1 auto");
    expect(identityControlCss).toContain("min-width: 0");
    expect(identityOverlayCss).toContain("width: 480px");

    expect(themeCss).toContain(".chat-composer { --composer-control-size: 32px; }");
    expect(buttonCss?.[0]).toContain("width: var(--composer-control-size, 32px)");
    expect(buttonCss?.[0]).toContain("height: var(--composer-control-size, 32px)");
    expect(buttonCss?.[0]).toContain("border-radius: 50%");

    expect(themeCss).toContain(".overview-shell,\n.inference-shell {");
    expect(themeCss).toContain("height: calc(100vh - 32px)");
    expect(themeCss).toContain(".inference-shell .debug-workbench {\n  flex: 1;");
    expect(themeCss).toContain(".chat-shell {\n  height: 100%;\n  min-height: 500px;");
    expect(themeCss).not.toContain("clamp(500px, calc(100vh - 360px), 720px)");
  });

  it("renders the Hermes Agent integration guide with a dynamic local endpoint", async () => {
    const wrapper = await mountAndLoadModels(["model-curl"]);
    wrapper.findComponent(Tabs).vm.$emit("update:activeKey", "integration");
    await nextTick();

    const renderedText = wrapper.text();
    expect(renderedText).toContain("Hermes Agent");
    expect(renderedText).toContain("Nous Research 开源自主 AI Agent");
    expect(renderedText).not.toContain("运行模型配置命令");
    expect(wrapper.find("a-steps").exists()).toBe(false);
    expect(renderedText).toContain("不要填写云端服务地址");

    const homeLink = wrapper.get('a[href="https://hermes-agent.nousresearch.com/"]');
    expect(homeLink.attributes("target")).toBe("_blank");
    expect(homeLink.attributes("rel")).toBe("noopener noreferrer");

    const configExample = wrapper.get("pre.client-config").text();
    expect(configExample).toContain("default: model-curl");
    expect(configExample).toContain("provider: custom");
    expect(configExample).toContain("base_url: http://127.0.0.1:18080/v1");
    expect(configExample).toContain("api_key: sk-************************************");

    expect(wrapper.text()).not.toContain("请先恢复网关运行状态、API Key 与模型清单。");
    expect(wrapper.find(".integration-panel .chat-gate").exists()).toBe(false);

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    const screenshot = wrapper.get("img.client-screenshot");
    const screenshotWrapCss = themeCss.match(/\n\.client-screenshot-wrap \{[\s\S]*?\}/);
    expect(screenshotWrapCss?.[0]).toContain("max-width: 100%");
    expect(screenshotWrapCss?.[0]).toContain("overflow: hidden");
    expect(screenshot.attributes("src")).toBeTruthy();
    expect(screenshot.attributes("alt")).toContain("Hermes Agent custom endpoint 配置示例");

    expect(wrapper.find(".hermes-mark").text()).toBe("H");
    expect(renderedText).not.toContain(["DeepSeek", "Client"].join(" "));
    expect(renderedText).toContain('"stream": true');
    expect(renderedText).toContain("curl -N");
  });

  it("shows the integration readiness gate before TNG is running", async () => {
    tngRunningState.value = false;
    const wrapper = mountView();
    await flushPromises();
    wrapper.findComponent(Tabs).vm.$emit("update:activeKey", "integration");
    await nextTick();

    const gate = wrapper.get(".integration-panel .chat-gate");
    expect(gate.text()).toContain("当前无法发送推理请求");
    expect(gate.text()).toContain("请先恢复网关运行状态、API Key 与模型清单。");
  });

  it("shows an unavailable endpoint as unconfigured in the Hermes example", async () => {
    tauriMocks.proxyEndpoint.mockReset().mockResolvedValue([]);
    const wrapper = mountView();
    await flushPromises();
    wrapper.findComponent(Tabs).vm.$emit("update:activeKey", "integration");
    await nextTick();

    const configExample = wrapper.get("pre.client-config").text();
    expect(configExample).toContain("default: 模型列表加载失败");
    expect(configExample).toContain("base_url: 未配置");
    expect(configExample).not.toContain("http://127.0.0.1:");
    expect(configExample).not.toContain("model-curl");
  });

  it("keeps Hermes model discovery failures visible without inventing a model ID", async () => {
    tauriMocks.listModels.mockRejectedValueOnce(new Error("model discovery unavailable"));
    const wrapper = mountView();
    await flushPromises();
    wrapper.findComponent(Tabs).vm.$emit("update:activeKey", "integration");
    await nextTick();

    const configExample = wrapper.get("pre.client-config").text();
    expect(configExample).toContain("default: 模型列表加载失败");
    expect(configExample).toContain("base_url: http://127.0.0.1:18080/v1");
    expect(configExample).not.toContain("model-a");
    expect(configExample).not.toContain("model-curl");
  });
});
