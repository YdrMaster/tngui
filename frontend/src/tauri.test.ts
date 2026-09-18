import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const saveDialogMock = vi.hoisted(() => vi.fn());

// Channel 以最小测试替身提供（真实实现依赖 window.__TAURI_INTERNALS__）。
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class Channel<T> {
    onmessage?: (message: T) => void;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: saveDialogMock,
}));

const {
  exportRemoteAttestationReport,
  pickRemoteAttestationReportPath,
  sendInferenceStream,
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

describe("sendInferenceStream Tauri wrapper", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("streams each delta through a per-invocation channel and resolves on completion", async () => {
    const deltas: string[] = [];
    invokeMock.mockImplementation(async (_cmd, args) => {
      const channel = args.onDelta as { onmessage?: (delta: string) => void };
      channel.onmessage?.("你");
      channel.onmessage?.("好");
    });

    await sendInferenceStream(18080, "model-a", "key-t", "hello", (d) => deltas.push(d));

    expect(deltas).toEqual(["你", "好"]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, payload] = invokeMock.mock.calls[0];
    expect(command).toBe("send_inference_stream");
    expect(payload).toEqual({
      port: 18080,
      model: "model-a",
      apiKey: "key-t",
      prompt: "hello",
      onDelta: expect.anything(),
    });
    // stream 由后端负责组装；调用层绝不发送 x-model。
    expect(Object.keys(payload).sort()).toEqual([
      "apiKey",
      "model",
      "onDelta",
      "port",
      "prompt",
    ]);
    expect(JSON.stringify(payload)).not.toContain("x-model");
    expect(JSON.stringify(payload)).not.toContain('"stream"');
  });

  it("propagates failures as rejection so the UI keeps showing diagnostics", async () => {
    invokeMock.mockRejectedValue(new Error("发送失败: HTTP 502"));
    await expect(
      sendInferenceStream(18081, "m", "k", "p", () => {}),
    ).rejects.toThrow("发送失败: HTTP 502");
  });
});
