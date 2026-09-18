import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Form,
  Input,
  InputGroup,
  InputNumber,
  InputPassword,
  Select,
  Space,
  Switch,
  TabPane,
  Tabs,
  Tag,
  Textarea,
  Tooltip,
} from "ant-design-vue";
import SettingsView from "./SettingsView.vue";
import EntryEditor from "../components/EntryEditor.vue";
import RemoteReportExportAction from "../components/RemoteReportExportAction.vue";
import {
  DEFAULT_HTTP_PROXY_DOMAIN,
  DEFAULT_RVS_URL,
  defaultModel,
} from "../formspec";
import { useTngConfig } from "../composables/useTngConfig";

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

const tauriMocks = vi.hoisted(() => ({
  appInfo: vi.fn(),
  exportConfig: vi.fn(),
  exportTngLog: vi.fn(),
  getStatus: vi.fn(),
  getOutput: vi.fn(),
  importConfig: vi.fn(),
  pickExportPath: vi.fn(),
  pickImportPath: vi.fn(),
  pickLogPath: vi.fn(),
}));

vi.mock("../tauri", () => tauriMocks);

const ingressKeys = {
  servers: [{ server_public_key: "key", server_attestation: "jwt" }],
};

const statusReport = {
  reachable: true,
  livez_ok: true,
  ready: true,
  status_json: ["ingress"],
  ingress_ids: ["ingress-1"],
  ingress_keys: ingressKeys,
  ingress_keys_error: null,
  process_error: null,
  error: null,
};

const globalComponents = {
  components: {
    "a-button": Button,
    "a-card": Card,
    "a-descriptions": Descriptions,
    "a-descriptions-item": DescriptionsItem,
    "a-form": Form,
    "a-form-item": Form.Item,
    "a-input": Input,
    "a-input-group": InputGroup,
    "a-input-number": InputNumber,
    "a-input-password": InputPassword,
    "a-select": Select,
    "a-space": Space,
    "a-switch": Switch,
    "a-tab-pane": TabPane,
    "a-tabs": Tabs,
    "a-tag": Tag,
    "a-textarea": Textarea,
    "a-tooltip": Tooltip,
  },
};

const { model, markSaved } = useTngConfig();

async function mountView() {
  const wrapper = mount(SettingsView, { global: globalComponents });
  await flushPromises();
  return wrapper;
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text().includes(text));
}

function expectButtonEnabled(button: ReturnType<typeof buttonByText>) {
  expect(button).toBeDefined();
  expect(button!.attributes("disabled")).toBeUndefined();
}

beforeEach(() => {
  vi.clearAllMocks();
  model.value = defaultModel();
  markSaved();
  tauriMocks.appInfo.mockResolvedValue({ version: "0.0.0-test", os: "Linux" });
  tauriMocks.getStatus.mockResolvedValue(statusReport);
  tauriMocks.getOutput.mockResolvedValue([]);
});

describe("SettingsView TNG 配置布局与默认值", () => {
  it("仅渲染一个入口配置，默认使用中文域名代理和常用默认值", async () => {
    const wrapper = await mountView();

    expect(wrapper.findAllComponents(EntryEditor)).toHaveLength(1);
    expect(model.value.ingress.mode).toBe("http_proxy");
    expect(
      (model.value.ingress.fields.dst_filters as { domain: string }).domain,
    ).toBe(DEFAULT_HTTP_PROXY_DOMAIN);
    expect(
      (model.value.ingress.fields.dst_filters as { port: number }).port,
    ).toBe(443);
    expect(model.value.rvsUrl).toBe(DEFAULT_RVS_URL);

    const select = wrapper.getComponent(Select);
    expect(select.props("options")).toEqual([
      { value: "mapping", label: "端点映射" },
      { value: "http_proxy", label: "域名代理" },
    ]);
    expect(select.props("value")).toBe("http_proxy");
    expect(
      (wrapper.find('input[placeholder^="如 https://"]').element as HTMLInputElement).value,
    ).toBe(DEFAULT_HTTP_PROXY_DOMAIN);
    expect(
      (wrapper.find('input[placeholder="远端端口（可留空）"]').element as HTMLInputElement).value,
    ).toBe("443");

    expect(wrapper.text()).not.toContain("添加 ingress");
    expect(wrapper.text()).not.toContain("新增 ingress");
    expect(
      wrapper.findAll(".ant-card-head-title").map((item) => item.text()),
    ).not.toContain("add_ingress");
    wrapper.unmount();
  });

  it("默认锁定开启，禁用全部 TNG 配置编辑控件", async () => {
    const wrapper = await mountView();
    const lock = wrapper.find('[aria-label="锁定 TNG 配置"]');
    const remoteAttestation = wrapper.find('[aria-label="远程证明"]');
    const outwardBinding = wrapper.find(".ant-card-body .ant-switch");
    const domain = wrapper.find('input[placeholder^="如 https://"]');
    const remotePort = wrapper.find('input[placeholder="远端端口（可留空）"]');
    const outwardPort = wrapper.find('input[placeholder="端口（必填）"]');
    const rvsUrl = wrapper.find('input[placeholder="https://rvs.tsk.com"]');
    const rawJson = wrapper.find("textarea.json-editor");
    const applyRaw = buttonByText(wrapper, "应用回填表单");

    expect(lock.classes()).toContain("ant-switch-checked");
    expect(remoteAttestation.classes()).toContain("ant-switch-disabled");
    expect(outwardBinding.classes()).toContain("ant-switch-disabled");
    expect(wrapper.getComponent(Select).props("disabled")).toBe(true);
    expect((domain.element as HTMLInputElement).disabled).toBe(true);
    expect((remotePort.element as HTMLInputElement).disabled).toBe(true);
    expect((outwardPort.element as HTMLInputElement).disabled).toBe(true);
    expect((rvsUrl.element as HTMLInputElement).disabled).toBe(true);
    expect((rawJson.element as HTMLTextAreaElement).disabled).toBe(true);
    expect(applyRaw!.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("关闭锁定后全部 TNG 配置编辑控件恢复可交互", async () => {
    const wrapper = await mountView();
    const lock = wrapper.find('[aria-label="锁定 TNG 配置"]');

    await lock.trigger("click");
    await nextTick();

    const remoteAttestation = wrapper.find('[aria-label="远程证明"]');
    const outwardBinding = wrapper.find(".ant-card-body .ant-switch");
    const domain = wrapper.find('input[placeholder^="如 https://"]');
    const remotePort = wrapper.find('input[placeholder="远端端口（可留空）"]');
    const outwardPort = wrapper.find('input[placeholder="端口（必填）"]');
    const rvsUrl = wrapper.find('input[placeholder="https://rvs.tsk.com"]');
    const rawJson = wrapper.find("textarea.json-editor");
    const applyRaw = buttonByText(wrapper, "应用回填表单");

    expect(remoteAttestation.classes()).not.toContain("ant-switch-disabled");
    expect(outwardBinding.classes()).not.toContain("ant-switch-disabled");
    expect(wrapper.getComponent(Select).props("disabled")).toBe(false);
    expect((domain.element as HTMLInputElement).disabled).toBe(false);
    expect((remotePort.element as HTMLInputElement).disabled).toBe(false);
    expect((outwardPort.element as HTMLInputElement).disabled).toBe(false);
    expect((rvsUrl.element as HTMLInputElement).disabled).toBe(false);
    expect((rawJson.element as HTMLTextAreaElement).disabled).toBe(false);
    expect(applyRaw!.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("锁定时导入导出按钮和报告导出仍可用，且锁定状态不写入 JSON", async () => {
    const wrapper = await mountView();
    expectButtonEnabled(buttonByText(wrapper, "导入 JSON"));
    expectButtonEnabled(buttonByText(wrapper, "导出 JSON"));

    const exportAction = wrapper.getComponent(RemoteReportExportAction);
    expect(exportAction.find("button").attributes("disabled")).toBeUndefined();

    tauriMocks.pickExportPath.mockResolvedValue("/tmp/tng-config.json");
    tauriMocks.exportConfig.mockResolvedValue(undefined);
    await buttonByText(wrapper, "导出 JSON")!.trigger("click");
    await flushPromises();

    expect(tauriMocks.exportConfig).toHaveBeenCalledTimes(1);
    const exportedJson = tauriMocks.exportConfig.mock.calls[0][1] as string;
    const exported = JSON.parse(exportedJson) as Record<string, unknown>;
    expect(Array.isArray(exported.add_ingress)).toBe(true);
    expect(exported.add_ingress).toHaveLength(1);
    expect(exported.configLocked).toBeUndefined();
    wrapper.unmount();
  });

  it("锁定时导入多条 ingress 仅保留第一条，且显式 RVS 地址优先", async () => {
    const wrapper = await mountView();
    const importedJson = JSON.stringify({
      tngui_rvs_url: "https://private-rvs.example.com:8443",
      add_ingress: [
        {
          mapping: {
            rules: [
              { in: {}, out: { host: "10.0.0.8", port: 8443 } },
            ],
          },
          verify: {},
          tngui_outward: { host: "127.0.0.1", port: 9443 },
        },
        {
          http_proxy: {
            proxy_listen: {},
            dst_filters: [{ domain: "second.example.com", port: 443 }],
          },
          no_ra: true,
          tngui_outward: { host: "127.0.0.1", port: 9443 },
        },
      ],
    });
    tauriMocks.pickImportPath.mockResolvedValue("/tmp/import.json");
    tauriMocks.importConfig.mockResolvedValue(importedJson);

    await buttonByText(wrapper, "导入 JSON")!.trigger("click");
    await flushPromises();

    expect(model.value.ingress.mode).toBe("mapping");
    expect(
      (model.value.ingress.fields.rules as Array<{
        out: { host: string; port: number };
      }>)[0].out,
    ).toEqual({ host: "10.0.0.8", port: 8443 });
    expect(model.value.ingress.no_ra).toBe(false);
    expect(model.value.rvsUrl).toBe("https://private-rvs.example.com:8443");
    expect(messageMocks.warning).toHaveBeenCalledWith(
      expect.stringContaining("已丢弃 add_ingress[1]"),
    );

    // 导入可以修改配置内容，但不会绕过当前锁定状态。
    expect(wrapper.find('[aria-label="锁定 TNG 配置"]').classes())
      .toContain("ant-switch-checked");
    expect(wrapper.getComponent(Select).props("disabled")).toBe(true);
    wrapper.unmount();
  });
});

describe("SettingsView 远端证明报告导出", () => {
  it("显示图标-only 导出动作，并使用同一次轮询快照", async () => {
    const wrapper = await mountView();

    const actions = wrapper.findAllComponents(RemoteReportExportAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].props("report")).toEqual(ingressKeys);
    expect(actions[0].element.closest(".ingress-card-title")).not.toBeNull();
    expect(actions[0].text()).not.toContain("导出报告");
    expect(actions[0].find("button").attributes("aria-label")).toBe(
      "导出远程证明报告",
    );
    expect(actions[0].find("button").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("无校验凭据时导出动作禁用", async () => {
    tauriMocks.getStatus.mockResolvedValue({
      ...statusReport,
      ingress_keys: { servers: [{ server_public_key: "key" }] },
    });
    const wrapper = await mountView();

    const action = wrapper.getComponent(RemoteReportExportAction);
    expect(action.props("report")).toEqual({
      servers: [{ server_public_key: "key" }],
    });
    expect(action.find("button").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});
