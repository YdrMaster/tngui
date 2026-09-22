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
  stopInferenceStream,
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

  it("streams each typed delta through a per-invocation channel and resolves on completion", async () => {
    const deltas: unknown[] = [];
    invokeMock.mockImplementation(async (_cmd, args) => {
      const channel = args.onDelta as { onmessage?: (delta: unknown) => void };
      channel.onmessage?.({ kind: "reasoning", text: "先分析" });
      channel.onmessage?.({ kind: "content", text: "回答" });
      return "completed";
    });

    const messages = [
      { role: "user" as const, content: "第一轮" },
      { role: "assistant" as const, content: "第一轮回答" },
      { role: "user" as const, content: "第二轮" },
    ];
    await expect(
      sendInferenceStream(
        "assistant-1",
        18080,
        "model-a",
        "key-t",
        messages,
        "  身份快照\n包含空白保留  ",
        "medium",
        (delta) => deltas.push(delta),
      ),
    ).resolves.toBe("completed");

    expect(deltas).toEqual([
      { kind: "reasoning", text: "先分析" },
      { kind: "content", text: "回答" },
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, payload] = invokeMock.mock.calls[0];
    expect(command).toBe("send_inference_stream");
    expect(payload).toEqual({
      requestId: "assistant-1",
      port: 18080,
      model: "model-a",
      apiKey: "key-t",
      messages,
      systemPrompt: "  身份快照\n包含空白保留  ",
      reasoningEffort: "medium",
      onDelta: expect.anything(),
    });
    // stream 由后端负责组装；调用层绝不发送 x-model。
    expect(Object.keys(payload).sort()).toEqual([
      "apiKey",
      "messages",
      "model",
      "onDelta",
      "port",
      "reasoningEffort",
      "requestId",
      "systemPrompt",
    ]);
    expect(payload.systemPrompt).toBe("  身份快照\n包含空白保留  ");
    expect(JSON.stringify(payload)).not.toContain("x-model");
    expect(JSON.stringify(payload)).not.toContain('"stream"');
    expect(JSON.stringify(payload)).not.toContain("thinking_token_budget");
  });

  it("propagates failures as rejection so the UI keeps showing diagnostics", async () => {
    invokeMock.mockRejectedValue(new Error("发送失败: HTTP 502"));
    await expect(
      sendInferenceStream(
        "assistant-2",
        18081,
        "m",
        "k",
        [{ role: "user", content: "p" }],
        null,
        "low",
        () => {},
      ),
    ).rejects.toThrow("发送失败: HTTP 502");
  });

  it("invokes the stop command by request id and returns the backend idempotent result", async () => {
    invokeMock.mockResolvedValue(true);
    await expect(stopInferenceStream("assistant-1")).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("stop_inference_stream", {
      requestId: "assistant-1",
    });
  });
});
