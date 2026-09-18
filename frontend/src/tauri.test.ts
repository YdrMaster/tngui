import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const saveDialogMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: saveDialogMock,
}));

const {
  exportRemoteAttestationReport,
  pickRemoteAttestationReportPath,
} = await import("./tauri");

describe("remote attestation report Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveDialogMock.mockReset();
  });

  it("opens a native save dialog with the JSON filter and default filename", async () => {
    saveDialogMock.mockResolvedValue("/tmp/remote-attestation-report.json");

    await expect(pickRemoteAttestationReportPath()).resolves.toBe(
      "/tmp/remote-attestation-report.json",
    );
    expect(saveDialogMock).toHaveBeenCalledWith({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: "remote-attestation-report.json",
    });
  });

  it("normalizes a cancelled dialog to null", async () => {
    saveDialogMock.mockResolvedValue(undefined);

    await expect(pickRemoteAttestationReportPath()).resolves.toBeNull();
  });

  it("writes the report as pretty JSON through export_config", async () => {
    invokeMock.mockResolvedValue(undefined);
    const report = { servers: [{ server_attestation: "jwt" }] };

    await exportRemoteAttestationReport("/tmp/report.json", report);

    expect(invokeMock).toHaveBeenCalledWith("export_config", {
      path: "/tmp/report.json",
      json: JSON.stringify(report, null, 2),
    });
  });
});
