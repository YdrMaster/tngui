import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { Button, Tooltip } from "ant-design-vue";
import RemoteReportExportAction from "./RemoteReportExportAction.vue";

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("ant-design-vue", async () => {
  const actual = await vi.importActual<typeof import("ant-design-vue")>(
    "ant-design-vue",
  );
  return { ...actual, message: messageMocks };
});

const tauriMocks = vi.hoisted(() => ({
  pickRemoteAttestationReportPath: vi.fn(),
  exportRemoteAttestationReport: vi.fn(),
}));

vi.mock("../tauri", () => tauriMocks);

const globalComponents = {
  components: {
    "a-button": Button,
    "a-tooltip": Tooltip,
  },
};

const reportWithAttestation = {
  servers: [{ server_public_key: "key", server_attestation: "jwt" }],
};

function mountAction(report: unknown) {
  return mount(RemoteReportExportAction, {
    props: { report },
    global: globalComponents,
  });
}

describe("RemoteReportExportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is icon-only and disabled without a non-empty server_attestation", () => {
    const wrapper = mountAction({ servers: [{ server_attestation: "" }] });

    expect(wrapper.text()).not.toContain("导出报告");
    expect(wrapper.find("button").attributes("aria-label")).toBe(
      "导出远程证明报告",
    );
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".anticon-file-text").exists()).toBe(true);
  });

  it("is enabled when any server has a non-empty attestation", () => {
    const wrapper = mountAction(reportWithAttestation);

    expect(wrapper.find("button").attributes("disabled")).toBeUndefined();
    expect(wrapper.find(".anticon-file-text").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("导出报告");
  });

  it("exports the snapshot captured when the action is clicked", async () => {
    tauriMocks.pickRemoteAttestationReportPath.mockResolvedValue(
      "/tmp/report.json",
    );
    tauriMocks.exportRemoteAttestationReport.mockResolvedValue(undefined);
    const wrapper = mountAction(reportWithAttestation);

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(tauriMocks.pickRemoteAttestationReportPath).toHaveBeenCalledTimes(1);
    expect(tauriMocks.exportRemoteAttestationReport).toHaveBeenCalledWith(
      "/tmp/report.json",
      reportWithAttestation,
    );
    expect(messageMocks.success).toHaveBeenCalledWith("已导出: /tmp/report.json");
    expect(messageMocks.error).not.toHaveBeenCalled();
  });

  it("does not write a file or show success when the dialog is cancelled", async () => {
    tauriMocks.pickRemoteAttestationReportPath.mockResolvedValue(null);
    const wrapper = mountAction(reportWithAttestation);

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(tauriMocks.exportRemoteAttestationReport).not.toHaveBeenCalled();
    expect(messageMocks.success).not.toHaveBeenCalled();
    expect(messageMocks.error).not.toHaveBeenCalled();
  });

  it("shows an error when writing the report fails", async () => {
    tauriMocks.pickRemoteAttestationReportPath.mockResolvedValue(
      "/tmp/report.json",
    );
    tauriMocks.exportRemoteAttestationReport.mockRejectedValue(
      new Error("disk full"),
    );
    const wrapper = mountAction(reportWithAttestation);

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(messageMocks.error).toHaveBeenCalledWith(
      expect.stringContaining("disk full"),
    );
    expect(messageMocks.success).not.toHaveBeenCalled();
  });
});
