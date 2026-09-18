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

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const tauriMocks = vi.hoisted(() => ({
  proxyEndpoint: vi.fn(),
  listModels: vi.fn(),
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
    invokeMock.mockReset().mockResolvedValue("ok");
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
    expect(invokeMock).not.toHaveBeenCalled();
    expect(messageMocks.warning).not.toHaveBeenCalled();
  });

  it("auto selects a single model and sends exactly that ID", async () => {
    const { wrapper } = await mountAndLoadModels(["capi-model"]);
    const select = wrapper.findComponent(Select);
    expect(select.props("value")).toBe("capi-model");
    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("send_inference", {
      port: 18080,
      model: "capi-model",
      apiKey: "test-key",
      prompt: "请分析这段文本",
    });
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
    expect(invokeMock).toHaveBeenCalledWith("send_inference", {
      port: 18080,
      model: "second-model",
      apiKey: "test-key",
      prompt: "请分析这段文本",
    });
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
