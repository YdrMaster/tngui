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
  const actual = await vi.importActual<typeof import("ant-design-vue")>(
    "ant-design-vue",
  );
  return { ...actual, message: messageMocks };
});

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const tauriMocks = vi.hoisted(() => ({
  proxyEndpoint: vi.fn(),
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

async function preparePromptAndModel(model: string, prompt = "  hello prompt  ") {
  const wrapper = mountView();
  await flushPromises();

  const modelInput = wrapper.find("input.ant-input");
  await modelInput.setValue(model);
  const promptInput = wrapper.find("textarea.ant-input");
  await promptInput.setValue(prompt);

  return { wrapper, promptInput };
}

describe("InferenceView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tngRunningState.value = true;
    useInferenceConfig().initializeApiKey("test-key");
    useInferenceConfig().model.value = "";
    tauriMocks.proxyEndpoint.mockReset().mockResolvedValue([{ port: 18080 }]);
    invokeMock.mockReset().mockResolvedValue("ok");
  });

  it("trims the model input and uses that value in the request and examples", async () => {
    const { wrapper, promptInput } = await preparePromptAndModel("  gpt-4  ");

    expect((promptInput.element as HTMLTextAreaElement).value).toBe("  hello prompt  ");
    expect(useInferenceConfig().model.value).toBe("gpt-4");

    const integrationTab = wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "AI 客户端接入");
    await integrationTab!.trigger("click");
    await nextTick();

    const output = JSON.parse(serializeInferenceRequestDebug(wrapper));
    expect(output.model).toBe("gpt-4");
    expect(wrapper.find(".client-config").text()).toContain("Model ID       gpt-4");

    await wrapper.find("button.send-button").trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("send_inference", {
      port: 18080,
      model: "gpt-4",
      apiKey: "test-key",
      prompt: "  hello prompt  ",
    });
    expect(messageMocks.warning).not.toHaveBeenCalledWith(
      expect.stringContaining("模型"),
    );
  });

  it("normalizes a whitespace-only model to empty without changing the send gate", async () => {
    const { wrapper } = await preparePromptAndModel("   ", "  keep prompt  ");
    const sendButton = wrapper.find("button.send-button");

    expect(sendButton.attributes("disabled")).toBeUndefined();
    expect(useInferenceConfig().model.value).toBe("");
    const integrationTab = wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "AI 客户端接入");
    await integrationTab!.trigger("click");
    await nextTick();
    expect(wrapper.find(".client-config").text()).toContain("Model ID       model");

    await sendButton.trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("send_inference", {
      port: 18080,
      model: "",
      apiKey: "test-key",
      prompt: "  keep prompt  ",
    });
  });
});

/** Extract the JSON body from the cURL example rendered by the integration tab. */
function serializeInferenceRequestDebug(wrapper: ReturnType<typeof mountView>): string {
  const curlText = wrapper
    .findAll("pre.code-block")
    .map((code) => code.text())
    .find((text) => text.includes("curl http://127.0.0.1:18080/v1/chat/completions"));
  if (!curlText) throw new Error("cURL example was not rendered");
  const start = curlText.indexOf("-d '") + 4;
  const end = curlText.lastIndexOf("}'");
  return curlText.slice(start, end + 1);
}
