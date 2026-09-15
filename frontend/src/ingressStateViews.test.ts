import { describe, expect, it } from "vitest";
import type { IngressStates } from "./ingressState";
import { deriveGatewayStateViews } from "./ingressStateViews";

const baseState: IngressStates = {
  runtime: "running",
  remoteLink: "established",
  remoteProof: "verified",
};

describe("deriveGatewayStateViews", () => {
  it("输出概览第 1、3、4 卡的固定标题", () => {
    const views = deriveGatewayStateViews(baseState);
    expect([
      views.runtime.title,
      views.remoteLink.title,
      views.remoteProof.title,
    ]).toEqual(["运行状态", "远端链路", "远端证明"]);
  });

  it("runtime 三态与颜色语义保持概览结果", () => {
    const states: Array<IngressStates["runtime"]> = ["stopped", "running", "error"];
    expect(states.map((runtime) => {
      const card = deriveGatewayStateViews({ ...baseState, runtime }).runtime;
      return { state: card.state, stateText: card.stateText, subtitle: card.subtitle };
    })).toEqual([
      { state: "warn", stateText: "关停", subtitle: "进程未运行" },
      { state: "ok", stateText: "运行", subtitle: "就绪探针通过" },
      { state: "err", stateText: "错误", subtitle: "服务失败或进程异常" },
    ]);
  });

  it("remoteLink 全部分支与概览颜色语义一致", () => {
    const states: Array<IngressStates["remoteLink"]> = ["uninit", "established", "failed"];
    expect(states.map((remoteLink) => {
      const card = deriveGatewayStateViews({ ...baseState, remoteLink }).remoteLink;
      return { state: card.state, stateText: card.stateText, subtitle: card.subtitle };
    })).toEqual([
      { state: "neutral", stateText: "未初始化", subtitle: "尚无成功的远端密钥配置" },
      { state: "ok", stateText: "已建联", subtitle: "已有远端公钥" },
      { state: "err", stateText: "失败", subtitle: "密钥配置或隧道失败" },
    ]);
  });

  it("remoteProof 全部分支与概览颜色语义一致", () => {
    const states: Array<IngressStates["remoteProof"]> = [
      "not-obtained",
      "verified",
      "refresh-due",
      "failed",
    ];
    expect(states.map((remoteProof) => {
      const card = deriveGatewayStateViews({ ...baseState, remoteProof }).remoteProof;
      return { state: card.state, stateText: card.stateText, subtitle: card.subtitle };
    })).toEqual([
      { state: "neutral", stateText: "未获取", subtitle: "无缓存的校验凭据" },
      { state: "ok", stateText: "已验证", subtitle: "已缓存校验凭据" },
      { state: "warn", stateText: "待刷新", subtitle: "凭据接近过期" },
      { state: "err", stateText: "失败", subtitle: "校验、刷新或取证失败" },
    ]);
  });
});
