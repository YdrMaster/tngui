import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { Alert, Button, Card, Tooltip } from "ant-design-vue";
import Overview from "./Overview.vue";
import IngressStateCard from "../components/IngressStateCard.vue";
import RemoteReportExportAction from "../components/RemoteReportExportAction.vue";

const tauriMocks = vi.hoisted(() => ({
  launchTng: vi.fn(),
  getStatus: vi.fn(),
  getOutput: vi.fn(async () => []),
  pickRemoteAttestationReportPath: vi.fn(),
  exportRemoteAttestationReport: vi.fn(),
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
    "a-alert": Alert,
    "a-button": Button,
    "a-card": Card,
    "a-tooltip": Tooltip,
  },
};

describe("Overview remote proof export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getOutput.mockResolvedValue([]);
    tauriMocks.getStatus.mockResolvedValue(statusReport);
  });

  it("mounts one icon-only action on the remote proof card using the polled snapshot", async () => {
    const wrapper = mount(Overview, { global: globalComponents });
    await flushPromises();

    const actions = wrapper.findAllComponents(RemoteReportExportAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].props("report")).toEqual(ingressKeys);
    expect(actions[0].element.closest(".ingress-card-title")).not.toBeNull();
    expect(actions[0].text()).not.toContain("导出报告");
    expect(actions[0].find("button").attributes("aria-label")).toBe(
      "导出远程证明报告",
    );
    expect(
      actions[0].element.closest(".ingress-card")?.textContent,
    ).toContain("已验证");
    wrapper.unmount();
  });

  it("lets overview debug panels grow with the available window height", async () => {
    const wrapper = mount(Overview, { global: globalComponents });
    await flushPromises();

    const logs = wrapper.findAll(".overview-log");
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.attributes("style")).not.toContain("max-height");
    }

    const themeCss = readFileSync("src/assets/theme.css", "utf8");
    expect(themeCss).toContain(".overview-shell,\n.inference-shell {");
    expect(themeCss).toContain("height: calc(100vh - 32px)");
    expect(themeCss).toContain(".overview-shell .ingress-debug-grid {\n  flex: 1;");
    expect(themeCss).toContain(".overview-shell .overview-log {\n  flex: 1;\n  max-height: none;");
    wrapper.unmount();
  });

  it("keeps the action disabled when the current snapshot has no attestation", async () => {
    tauriMocks.getStatus.mockResolvedValue({
      ...statusReport,
      ingress_keys: { servers: [{ server_public_key: "key" }] },
    });
    const wrapper = mount(Overview, { global: globalComponents });
    await flushPromises();

    const action = wrapper.getComponent(RemoteReportExportAction);
    expect(action.props("report")).toEqual({
      servers: [{ server_public_key: "key" }],
    });
    expect(action.find("button").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});
