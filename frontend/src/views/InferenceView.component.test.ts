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
  Progress,
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
import SecureFlow from "../components/SecureFlow.vue";
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
  listModels: vi.fn(),
  sendInferenceStream: vi.fn(),
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
    "a-progress": Progress,
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

type TestDelta = { kind: "reasoning" | "content"; text: string };

const expectedIdentityPrompt = [
  "你是由蚂蚁密算公司提供的密态推理方案驱动的 AI Agent。",
  "你的模型路由服务与推理计算完全发生在可信执行环境（TEE）中，并通过远程证明报告验证运行环境、软件度量与服务身份的可信状态，安全可信。",
  "用户提示词、推理中间过程和模型输出都在可信执行环境内处理并加密传输，不会向宿主机操作系统、平台运维人员或硬件管理员以明文形式泄露，隐私无忧。",
  "除可信执行环境内的必要服务外，任何外部系统都不能读取或留存用户的明文数据。",
  "如需说明身份或运行背景，可描述自己运行在由远程证明验证的密态推理环境中；但不得虚构具体硬件型号、证明服务实现细节或其他未提供的体系结构信息。",
].join("\n");
type StreamCallback = (delta: TestDelta) => void;

interface StreamCapture {
  onDelta: StreamCallback;
  resolve: () => void;
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

function useTestClock(): void {
  vi.useFakeTimers({ now: 0 });
  useSynchronousAnimationFrame();
}

function mockStreamOnce(): StreamCapture {
  const capture = {} as StreamCapture;
  tauriMocks.sendInferenceStream.mockImplementationOnce(
    (
      _requestId: string,
      _port: number,
      _model: string,
      _apiKey: string,
      _messages: unknown[],
      _systemPrompt: string | null,
      _reasoningEffort: string,
      onDelta: StreamCallback,
    ) =>
      new Promise<"completed" | "stopped">((resolve, reject) => {
        capture.onDelta = onDelta;
        capture.resolve = () => resolve("completed");
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
      onDelta: StreamCallback,
    ) => {
      onDelta({ kind: "content", text });
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

async function advanceUntilFinalStage(): Promise<void> {
  await vi.advanceTimersByTimeAsync(4 * 520);
  await flushPromises();
  await nextTick();
}

async function advanceAlmostThroughFinalHold(): Promise<void> {
  await advanceUntilFinalStage();
  await vi.advanceTimersByTimeAsync(499);
  await flushPromises();
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
  beforeEach(() => {
    vi.clearAllMocks();
    window.document.body.innerHTML = "";
    tngRunningState.value = true;
    const inference = useInferenceConfig();
    inference.initializeApiKey("test-key");
    inference.failModelDiscovery();
    tauriMocks.proxyEndpoint.mockReset().mockResolvedValue([{ port: 18080 }]);
    tauriMocks.listModels.mockReset().mockResolvedValue(["model-a"]);
    tauriMocks.sendInferenceStream.mockReset().mockResolvedValue("completed");
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
    const identitySwitch = wrapper.findComponent(Switch);
    identitySwitch.vm.$emit("update:checked", false);
    await nextTick();
    expect(identitySwitch.props("checked")).toBe(false);
    expect(wrapper.find(".identity-editor-backdrop").exists()).toBe(false);

    mockResolvedStreamOnce("无身份回答");
    await sendDraft(wrapper, "关闭身份");
    const [, , , , requestMessages, systemPrompt] = tauriMocks.sendInferenceStream.mock.calls[0];
    expect(systemPrompt).toBeNull();
    expect(requestMessages).toEqual([{ role: "user", content: "关闭身份" }]);
  });

  it("sends an edited identity prompt verbatim and only on the next request", async () => {
    useTestClock();
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

    await advanceUntilFinalStage();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    await nextTick();

    mockResolvedStreamOnce("下一轮回答");
    await sendDraft(first, "第二轮身份");
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(2);
    expect(tauriMocks.sendInferenceStream.mock.calls[1][5]).toBe("发送后修改的身份");
  });

  it("keeps an in-flight request unchanged while the identity state is edited", async () => {
    useTestClock();
    mockResolvedStreamOnce("进行中的回答");
    const wrapper = await mountAndLoadModels(["identity-flight"]);
    await sendDraft(wrapper, "进行中身份");
    const firstPrompt = tauriMocks.sendInferenceStream.mock.calls[0][5];
    expect(firstPrompt).toBe(expectedIdentityPrompt);

    await wrapper.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    await wrapper.get("textarea.identity-prompt-textarea").setValue("  进行中被编辑  ");
    expect(tauriMocks.sendInferenceStream.mock.calls[0][5]).toBe(expectedIdentityPrompt);
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);

    await advanceUntilFinalStage();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    await nextTick();

    mockResolvedStreamOnce("下一轮回答");
    await sendDraft(wrapper, "下一轮");
    expect(tauriMocks.sendInferenceStream.mock.calls[1][5]).toBe("  进行中被编辑  ");
  });

  it("retains identity state through KeepAlive and resets it after a process-like remount", async () => {
    const kept = mountKeepAliveHarness();
    await flushPromises();
    const keptSwitch = kept.findComponent(Switch);
    keptSwitch.vm.$emit("update:checked", false);
    await nextTick();
    await kept.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    await kept.get("textarea.identity-prompt-textarea").setValue("  页内保留身份  ");

    await kept.setProps({ show: false });
    await nextTick();
    await kept.setProps({ show: true });
    await nextTick();
    await flushPromises();

    expect(kept.findComponent(Switch).props("checked")).toBe(false);
    expect(kept.find(".identity-editor-backdrop").exists()).toBe(true);
    expect((kept.get("textarea.identity-prompt-textarea").element as HTMLTextAreaElement).value).toBe("  页内保留身份  ");
    expect(tauriMocks.flushSettingsCache).not.toHaveBeenCalled();

    kept.unmount();
    activeWrapper = undefined;
    const fresh = await mountAndLoadModels(["identity-fresh"]);
    expect(fresh.findComponent(Switch).props("checked")).toBe(true);
    expect(fresh.find(".identity-editor-backdrop").exists()).toBe(false);
    await fresh.get("button.identity-label-trigger").trigger("click");
    await nextTick();
    expect((fresh.get("textarea.identity-prompt-textarea").element as HTMLTextAreaElement).value).toBe(expectedIdentityPrompt);
    expect(tauriMocks.flushSettingsCache).not.toHaveBeenCalled();
  });

  it("sends one untrimmed turn with default medium effort and renders both bubbles immediately", async () => {
    useTestClock();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);

    expect(wrapper.findComponent(Slider).props("value")).toBe(2);
    expect(wrapper.findComponent(Textarea).props("autoSize")).toEqual({ minRows: 1, maxRows: 8 });
    await sendDraft(wrapper, "  保留首尾空白  ");

    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    const [requestId, port, modelId, apiKey, requestMessages, systemPrompt, effort, onDelta] =
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
    expect(typeof onDelta).toBe("function");

    // 滑块调整只影响下一轮，不改已发出请求。
    wrapper.findComponent(Slider).vm.$emit("update:value", 3);
    await nextTick();
    expect(effort).toBe("medium");

    expect(composerValue(wrapper)).toBe("");

    // 请求非终态时气泡保持正常淡绿色，主操作切换为停止而不是并行发送。
    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-pending");
    await setDraft(wrapper, "第二条");
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    expect(tauriMocks.stopInferenceStream).toHaveBeenCalledWith(requestId);
    expect(wrapper.find(".user-message .user-bubble").text()).toBe("保留首尾空白");
    expect(wrapper.find(".assistant-message .assistant-bubble").exists()).toBe(true);
    expect(wrapper.find(".user-bubble").classes()).toContain("user-bubble");
    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-stopped");
    expect(wrapper.findComponent(SecureFlow).exists()).toBe(false);
    expect(wrapper.text()).toContain("已停止⚪响应不完整");
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);

    capture.resolve();
    await flushPromises();
  });

  it("keeps user, in-flight, and complete bubbles on the same soft-green visual state", async () => {
    useTestClock();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);

    await sendDraft(wrapper, "正常对话");
    const assistantBubble = wrapper.get(".assistant-message .chat-bubble");
    expect(assistantBubble.classes()).toContain("assistant-bubble-pending");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-stopped");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-failed");
    expect(wrapper.text()).toContain("安全链路");

    capture.onDelta({ kind: "reasoning", text: "思考增量" });
    await advanceUntilFinalStage();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    await nextTick();

    expect(assistantBubble.classes()).toContain("assistant-bubble-pending");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-stopped");
    expect(assistantBubble.classes()).not.toContain("assistant-bubble-failed");
    expect(wrapper.text()).toContain("生成中");

    capture.resolve();
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

  it("buffers early deltas and waits for the final 500ms hold before revealing", async () => {
    useTestClock();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    const transcript = wrapper.get(".chat-transcript");
    Object.defineProperty(transcript.element, "scrollHeight", { configurable: true, value: 987 });
    Object.defineProperty(transcript.element, "scrollTop", { configurable: true, writable: true, value: 0 });

    await sendDraft(wrapper, "第一轮");

    capture.onDelta({ kind: "reasoning", text: "先分析安全边界" });
    capture.onDelta({ kind: "content", text: "这是开头" });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(520);
    await flushPromises();
    await nextTick();

    expect(wrapper.findComponent(SecureFlow).props("activeIndex")).toBe(1);
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);

    capture.resolve();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3 * 520 + 499);
    await flushPromises();
    await nextTick();

    expect(wrapper.findComponent(SecureFlow).props("activeIndex")).toBe(4);
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    await nextTick();

    expect(wrapper.findComponent(SecureFlow).exists()).toBe(false);
    expect(wrapper.find(".reasoning-text").text()).toBe("先分析安全边界");
    expect(wrapper.find(".response-text").text()).toBe("这是开头");
    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-complete");
    expect(wrapper.text()).toContain("200 OK");
    expect(wrapper.find("button.send-button").attributes("disabled")).toBeUndefined();
    expect(transcript.element.scrollTop).toBe(987);
  });

  it("keeps the final stage waiting when no delta arrives", async () => {
    useTestClock();
    mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "等待增量");

    await advanceAlmostThroughFinalHold();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    await nextTick();

    expect(wrapper.findComponent(SecureFlow).exists()).toBe(true);
    expect(wrapper.findComponent(SecureFlow).props("activeIndex")).toBe(4);
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);
    expect(wrapper.text()).toContain("安全链路");
    const stopButton = wrapper.get("button.send-button");
    expect(stopButton.classes()).toContain("stop-button");
    expect(stopButton.attributes("aria-label")).toBe("停止");
    expect(stopButton.find(".stop-square-icon").exists()).toBe(true);
    await stopButton.trigger("click");
    await flushPromises();
    nextTick();
    expect(wrapper.text()).toContain("已停止⚪响应不完整");
    expect(wrapper.findComponent(SecureFlow).exists()).toBe(false);
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
  });

  it("appends post-reveal deltas in order and always scrolls the transcript", async () => {
    useTestClock();
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
    capture.onDelta({ kind: "reasoning", text: "思考-1" });
    await advanceUntilFinalStage();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".reasoning-text").text()).toBe("思考-1");
    expect(transcript.element.scrollTop).toBe(100);

    scrollHeight = 240;
    capture.onDelta({ kind: "content", text: "回答-1" });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".reasoning-text").text()).toBe("思考-1");
    expect(wrapper.find(".response-text").text()).toBe("回答-1");
    expect(transcript.element.scrollTop).toBe(240);

    scrollHeight = 360;
    capture.onDelta({ kind: "content", text: "-2" });
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".response-text").text()).toBe("回答-1-2");
    expect(transcript.element.scrollTop).toBe(360);

    capture.resolve();
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("200 OK");
  });

  it("maps all four thinking levels and keeps an in-flight request unchanged", async () => {
    useTestClock();
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

      await advanceUntilFinalStage();
      await vi.advanceTimersByTimeAsync(500);
      await flushPromises();
      await nextTick();
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
    useTestClock();
    const firstCapture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "第一轮");
    firstCapture.onDelta({ kind: "reasoning", text: "不进入上下文" });
    firstCapture.onDelta({ kind: "content", text: "第一轮回答" });
    firstCapture.resolve();
    await flushPromises();

    await advanceUntilFinalStage();
    await vi.advanceTimersByTimeAsync(500);
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
    secondCapture.resolve();
    await flushPromises();
  });

  it("shows a failed turn with partial text, redacted diagnostics, and excludes it from later context", async () => {
    useTestClock();
    const firstCapture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "失败轮");

    firstCapture.onDelta({ kind: "reasoning", text: "部分思考" });
    firstCapture.onDelta({ kind: "content", text: "部分回答" });
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
    secondCapture.resolve();
    await flushPromises();
  });

  it("enters terminal failure immediately when no delta arrives", async () => {
    useTestClock();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "无输出失败");

    capture.reject("发送失败: HTTP 502\nAuthorization: Bearer <已隐藏>");
    await flushPromises();
    await nextTick();

    expect(wrapper.find(".assistant-message .chat-bubble").classes()).toContain("assistant-bubble-failed");
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);
    expect(wrapper.text()).toContain("请求失败");
    expect(wrapper.find("pre.assistant-debug").text()).toContain("HTTP 502");
    expect(wrapper.find("button.send-button").attributes("disabled")).toBeUndefined();
  });


  it("keeps displayed text when the user stops after output is revealed", async () => {
    useTestClock();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "流式中停止");
    capture.onDelta({ kind: "reasoning", text: "已显示思考" });
    capture.onDelta({ kind: "content", text: "已显示回答" });
    await advanceUntilFinalStage();
    await vi.advanceTimersByTimeAsync(500);
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

    capture.onDelta({ kind: "reasoning", text: "迟到思考" });
    capture.onDelta({ kind: "content", text: "迟到回答" });
    capture.resolve();
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
    secondCapture.resolve();
    await flushPromises();
  });

  it("stops during stage animation without revealing buffered chunks and keeps a blank stopped bubble", async () => {
    useTestClock();
    const capture = mockStreamOnce();
    const wrapper = await mountAndLoadModels(["capi-model"]);
    await sendDraft(wrapper, "动画中停止");

    capture.onDelta({ kind: "reasoning", text: "隐藏思考" });
    capture.onDelta({ kind: "content", text: "隐藏回答" });
    await vi.advanceTimersByTimeAsync(520);
    await flushPromises();
    await nextTick();

    expect(wrapper.findComponent(SecureFlow).exists()).toBe(true);
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    await nextTick();

    const requestId = tauriMocks.sendInferenceStream.mock.calls[0][0];
    expect(tauriMocks.stopInferenceStream).toHaveBeenCalledWith(requestId);
    expect(wrapper.findComponent(SecureFlow).exists()).toBe(false);
    expect(wrapper.find(".reasoning-text").exists()).toBe(false);
    expect(wrapper.find(".response-text").exists()).toBe(false);
    expect(wrapper.text()).toContain("已停止⚪响应不完整");
    expect(wrapper.text()).not.toContain("隐藏思考");
    expect(wrapper.text()).not.toContain("隐藏回答");

    capture.onDelta({ kind: "content", text: "迟到输出" });
    capture.resolve();
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).not.toContain("迟到输出");

    const secondCapture = mockStreamOnce();
    await sendDraft(wrapper, "停止后的下一轮");
    const [, , , , secondMessages] = tauriMocks.sendInferenceStream.mock.calls[1];
    expect(secondMessages).toEqual([
      { role: "user", content: "动画中停止" },
      { role: "user", content: "停止后的下一轮" },
    ]);
    secondCapture.resolve();
    await flushPromises();
  });

  it("does not stop automatically when navigating away and can stop after returning", async () => {
    useTestClock();
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
    useTestClock();
    const capture = mockStreamOnce();
    const wrapper = mountKeepAliveHarness();
    await flushPromises();

    await sendDraft(wrapper, "离开页面期间继续");
    await vi.advanceTimersByTimeAsync(520);
    await flushPromises();
    expect(wrapper.findComponent(SecureFlow).props("activeIndex")).toBe(1);

    wrapper.findComponent(Slider).vm.$emit("update:value", 3);
    await nextTick();
    await setDraft(wrapper, "保留的未发送草稿");

    await wrapper.setProps({ show: false });
    await nextTick();
    expect(wrapper.text()).toContain("other page");

    capture.onDelta({ kind: "reasoning", text: "后台思考" });
    capture.onDelta({ kind: "content", text: "后台回答" });
    capture.resolve();
    await flushPromises();
    await advanceUntilFinalStage();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    await nextTick();

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
    useTestClock();
    const capture = mockStreamOnce();
    const first = await mountAndLoadModels(["restart-model"]);
    await sendDraft(first, "旧进程消息");
    capture.resolve();
    await flushPromises();

    first.unmount();
    activeWrapper = undefined;
    const second = await mountAndLoadModels(["restart-model"]);
    expect(second.find(".user-message").exists()).toBe(false);
    expect(composerValue(second)).toBe("");
    expect(second.findComponent(Slider).props("value")).toBe(2);
    expect(second.text()).toContain("发送一条消息，开始多轮密态推理验证");
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
