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
