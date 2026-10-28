import { beforeEach, describe, expect, it } from "vitest";
import { useInferenceConfig } from "./useInferenceConfig";

describe("useInferenceConfig model discovery state", () => {
  beforeEach(() => {
    const state = useInferenceConfig();
    state.model.value = "";
    state.failModelDiscovery();
  });

  it("starts in the loading state without options", () => {
    const state = useInferenceConfig();
    expect(state.modelDiscoveryState.value).toBe("failed");
    state.startModelDiscovery();
    expect(state.modelDiscoveryState.value).toBe("loading");
    expect(state.modelIds.value).toEqual([]);
  });

  it("uses loaded-empty for zero models", () => {
    const state = useInferenceConfig();
    state.replaceModelList([]);
    expect(state.modelDiscoveryState.value).toBe("loaded-empty");
    expect(state.model.value).toBe("");
    expect(state.modelIds.value).toEqual([]);
  });

  it("auto-selects the only model", () => {
    const state = useInferenceConfig();
    state.replaceModelList(["only-model"]);
    expect(state.modelDiscoveryState.value).toBe("loaded-nonempty");
    expect(state.model.value).toBe("only-model");
  });

  it("defaults multiple models to the first returned item", () => {
    const state = useInferenceConfig();
    state.replaceModelList(["first-model", "second-model"]);
    expect(state.model.value).toBe("first-model");
  });

  it("retains an in-list selection on refresh", () => {
    const state = useInferenceConfig();
    state.replaceModelList(["first-model", "second-model"]);
    state.selectModel("second-model");
    state.replaceModelList(["second-model", "third-model"]);
    expect(state.modelDiscoveryState.value).toBe("loaded-nonempty");
    expect(state.model.value).toBe("second-model");
  });

  it("falls back to the first item when the current selection disappears", () => {
    const state = useInferenceConfig();
    state.replaceModelList(["old-model"]);
    state.replaceModelList(["new-first", "new-second"]);
    expect(state.model.value).toBe("new-first");
  });

  it("rejects values that were not returned by the model list", () => {
    const state = useInferenceConfig();
    state.replaceModelList(["model-a"]);
    state.selectModel("typed-text");
    expect(state.model.value).toBe("model-a");
  });
});

describe("useInferenceConfig shared session", () => {
  beforeEach(() => {
    useInferenceConfig().newSession();
  });

  it("carries tool exchanges verbatim and in order", () => {
    const state = useInferenceConfig();
    state.appendSessionMessage({ role: "user", content: "  读一下 /tmp/a  " });
    state.appendSessionMessage({
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"/tmp/a"}' } },
      ],
    });
    state.appendSessionMessage({ role: "tool", content: "文件内容\n第二行", tool_call_id: "call_1" });
    state.appendSessionMessage({ role: "assistant", content: "总结完成" });

    expect(state.toRequestMessages()).toEqual([
      { role: "user", content: "  读一下 /tmp/a  " },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"/tmp/a"}' } },
        ],
      },
      { role: "tool", content: "文件内容\n第二行", tool_call_id: "call_1" },
      { role: "assistant", content: "总结完成" },
    ]);
  });

  it("does not mutate the stored session when callers edit the returned context", () => {
    const state = useInferenceConfig();
    state.appendSessionMessage({ role: "user", content: "原文" });
    const context = state.toRequestMessages();
    context[0].content = "被调用方改写";
    expect(state.toRequestMessages()).toEqual([{ role: "user", content: "原文" }]);
  });

  it("keeps one shared session across run modes and clears it on new session", () => {
    const state = useInferenceConfig();
    state.appendSessionMessage({ role: "user", content: "第一轮" });
    state.selectRunMode("agent");
    expect(state.toRequestMessages()).toEqual([{ role: "user", content: "第一轮" }]);
    state.selectRunMode("chat");
    expect(state.toRequestMessages()).toEqual([{ role: "user", content: "第一轮" }]);
    state.newSession();
    expect(state.toRequestMessages()).toEqual([]);
  });
});
