import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
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
  Step,
  Steps,
  Select,
  TabPane,
  Tabs,
  Tag,
  Textarea,
  Spin,
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
    "a-step": Step,
    "a-steps": Steps,
    "a-tab-pane": TabPane,
    "a-tabs": Tabs,
    "a-tag": Tag,
    "a-textarea": Textarea,
    Spin,
  },
};

function mountView() {
  return mount(InferenceView, { global: globalComponents });
}

async function mountAndLoadModels(models: string[]) {
  tauriMocks.listModels.mockResolvedValueOnce(models);
  const wrapper = mountView();
  await flushPromises();
  const promptInput = wrapper.find("textarea.ant-input");
  await promptInput.setValue("请分析这段文本");
  return { wrapper, promptInput };
}

describe("InferenceView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tngRunningState.value = true;
    const inference = useInferenceConfig();
    inference.initializeApiKey("test-key");
    inference.model.value = "";
    inference.failModelDiscovery();
    tauriMocks.proxyEndpoint.mockReset().mockResolvedValue([{ port: 18080 }]);
    tauriMocks.listModels.mockReset().mockResolvedValue(["model-a"]);
    tauriMocks.sendInferenceStream.mockReset().mockResolvedValue(undefined);
  });

  it("disables the dropdown and send button when no models are detected", async () => {
    const { wrapper } = await mountAndLoadModels([]);
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

  it("auto selects a single model and sends exactly that ID", async () => {
    const { wrapper } = await mountAndLoadModels(["capi-model"]);
    const select = wrapper.findComponent(Select);
    expect(select.props("value")).toBe("capi-model");
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    const [port, modelId, apiKey, prompt, onDelta] =
      tauriMocks.sendInferenceStream.mock.calls[0];
    expect(port).toBe(18080);
    expect(modelId).toBe("capi-model");
    expect(apiKey).toBe("test-key");
    expect(prompt).toBe("请分析这段文本");
    expect(typeof onDelta).toBe("function");
  });

  it("defaults to the first of multiple models, preserves only in-list switches, and blocks custom text", async () => {
    const { wrapper } = await mountAndLoadModels(["first-model", "second-model"]);
    const select = wrapper.findComponent(Select);
    expect(select.props("value")).toBe("first-model");

    select.vm.$emit("update:value", "second-model");
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("second-model");

    select.vm.$emit("update:value", "not-from-capi");
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("second-model");

    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    expect(tauriMocks.sendInferenceStream).toHaveBeenCalledTimes(1);
    expect(tauriMocks.sendInferenceStream.mock.calls[0][1]).toBe("second-model");
  });

  it("falls back to the first model when a refreshed list removes current selection", async () => {
    const { wrapper } = await mountAndLoadModels(["first-model", "second-model"]);
    expect(useInferenceConfig().model.value).toBe("first-model");
    useInferenceConfig().replaceModelList(["new-model"]);
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("new-model");
    const select = wrapper.findComponent(Select);
    expect(select.props("value")).toBe("new-model");
  });

  it("keeps an in-list choice through a refresh and falls back only when it disappears", async () => {
    const { wrapper } = await mountAndLoadModels(["old-model", "second-model"]);
    useInferenceConfig().selectModel("second-model");
    useInferenceConfig().replaceModelList(["second-model", "third-model"]);
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("second-model");
    expect(wrapper.findComponent(Select).props("value")).toBe("second-model");

    useInferenceConfig().replaceModelList(["third-model"]);
    await nextTick();
    expect(useInferenceConfig().model.value).toBe("third-model");
    expect(wrapper.findComponent(Select).props("value")).toBe("third-model");
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
    expect(wrapper.find("button.send-button").attributes("disabled")).toBeDefined();

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
    expect(wrapper.find("button.send-button").attributes("disabled")).toBeDefined();
  });

  it("renders deltas progressively and clears output on resend", async () => {
    let releaseFirst!: () => void;
    tauriMocks.sendInferenceStream.mockImplementationOnce(
      (_p: number, _m: string, _k: string, _pr: string, onDelta: (d: string) => void) =>
        new Promise<void>((resolve) => {
          onDelta("你");
          onDelta("好");
          releaseFirst = () => resolve();
        }),
    );
    const { wrapper } = await mountAndLoadModels(["capi-model"]);

    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    await nextTick();

    // 首个/后续 delta 已渐进渲染（不等流结束）；阶段卡仍存在但停在当前阶段。
    expect(wrapper.find("p.response-text").text()).toBe("你好");
    expect(wrapper.findComponent(SecureFlow).props("activeIndex")).toBeLessThan(4);

    releaseFirst();
    await flushPromises();
    await nextTick();

    // 完成后：成功态 200 标签、无失败诊断。
    expect(wrapper.text()).toContain("200 OK");
    expect(wrapper.find("pre.response-debug").exists()).toBe(false);

    // 再次发送：首个 delta 未到前输出区清空、不残留上一次文本。
    tauriMocks.sendInferenceStream.mockImplementationOnce(
      () => new Promise<void>(() => {}),
    );
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    expect(wrapper.find("p.response-text").exists()).toBe(false);
  });

  it("keeps partial text and shows redacted diagnostics when the stream aborts", async () => {
    tauriMocks.sendInferenceStream.mockImplementationOnce(
      (_port, _model, _apiKey, _prompt, onDelta: (d: string) => void) =>
        new Promise<void>((_resolve, reject) => {
          onDelta("部分结");
          reject(
            "发送失败: 流中断: 连接关闭，未收到 [DONE]\n\n--- 发送请求（Authorization 已脱敏） ---\nAuthorization: Bearer <已隐藏>",
          );
        }),
    );
    const { wrapper } = await mountAndLoadModels(["capi-model"]);

    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    await nextTick();

    // 断流：部分文本保留 + 失败标签 + 诊断展示；已渲染文本不被清空或改写。
    expect(wrapper.find("p.response-text").text()).toBe("部分结");
    expect(wrapper.text()).toContain("请求失败");
    expect(wrapper.text()).toContain("响应不完整");
    expect(wrapper.find("pre.response-debug").text()).toContain("流中断");
    expect(wrapper.find("pre.response-debug").text()).toContain("Bearer <已隐藏>");
    // 诊断绝不含明文凭据。
    expect(wrapper.find("pre.response-debug").text()).not.toContain("Bearer test-key");
  });

  it("freezes the security stage progression at the first delayed delta", async () => {
    let firstDelta: ((d: string) => void) | undefined;
    let finishStream: (() => void) | undefined;
    tauriMocks.sendInferenceStream.mockImplementationOnce(
      (_port, _model, _apiKey, _prompt, onDelta: (d: string) => void) =>
        new Promise<void>((resolve) => {
          firstDelta = onDelta;
          finishStream = resolve;
        }),
    );
    const { wrapper } = await mountAndLoadModels(["capi-model"]);

    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();

    const flow = wrapper.findComponent(SecureFlow);
    // 发送中（无 delta 前）渲染阶段卡。
    expect(flow.exists()).toBe(true);

    // 阶段推进窗 直至首个 delta；捕获冻结时刻的阶段序号。
    await new Promise((r) => setTimeout(r, 700));
    const frozenIndex = flow.props("activeIndex");
    expect(frozenIndex).toBeGreaterThan(0);

    firstDelta?.("hi");
    await flushPromises();
    await nextTick();
    expect(wrapper.find("p.response-text").text()).toBe("hi");
    expect(wrapper.findComponent(SecureFlow).props("activeIndex")).toBe(frozenIndex);

    // 再等一个推进窗周期：阶段卡不再随时间推进（冻结在首个 delta 时刻）。
    await new Promise((r) => setTimeout(r, 700));
    expect(wrapper.findComponent(SecureFlow).props("activeIndex")).toBe(frozenIndex);

    finishStream?.();
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("200 OK");
  });

  it("renders the curl example with stream true", async () => {
    const { wrapper } = await mountAndLoadModels(["model-curl"]);
    // cURL 示例位于「AI 客户端接入」tab；切换后断言。
    wrapper.findComponent(Tabs).vm.$emit("update:activeKey", "integration");
    await nextTick();
    expect(wrapper.text()).toContain('"stream": true');
    expect(wrapper.text()).toContain("curl -N");
  });

  it("shows a distinct discovery failure instead of pretending the list is empty", async () => {
    tauriMocks.listModels.mockReset().mockRejectedValueOnce(new Error("gateway down"));
    const wrapper = mountView();
    await flushPromises();
    const select = wrapper.findComponent(Select);
    expect(select.props("disabled")).toBe(true);
    expect(select.props("placeholder")).toBe("模型列表加载失败");
    expect(messageMocks.error).toHaveBeenCalledWith(expect.stringContaining("gateway down"));
  });
});
