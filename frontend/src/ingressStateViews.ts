import type {
  IngressStates,
  RemoteLinkState,
  RemoteProofState,
  RuntimeState,
} from "./ingressState";

export type GatewayCardTone = "ok" | "warn" | "err" | "neutral";

export interface GatewayStateCardView {
  key: "runtime" | "remote-link" | "remote-proof";
  title: string;
  state: GatewayCardTone;
  stateText: string;
  subtitle: string;
}

const RUNTIME_VIEWS: Record<RuntimeState, Omit<GatewayStateCardView, "key" | "title">> = {
  stopped: { state: "warn", stateText: "关停", subtitle: "进程未运行" },
  running: { state: "ok", stateText: "运行", subtitle: "就绪探针通过" },
  error: { state: "err", stateText: "错误", subtitle: "服务失败或进程异常" },
};

const REMOTE_LINK_VIEWS: Record<RemoteLinkState, Omit<GatewayStateCardView, "key" | "title">> = {
  uninit: { state: "neutral", stateText: "未初始化", subtitle: "尚无成功的远端密钥配置" },
  established: { state: "ok", stateText: "已建联", subtitle: "已有远端公钥" },
  failed: { state: "err", stateText: "失败", subtitle: "密钥配置或隧道失败" },
};

const REMOTE_PROOF_VIEWS: Record<RemoteProofState, Omit<GatewayStateCardView, "key" | "title">> = {
  "not-obtained": { state: "neutral", stateText: "未获取", subtitle: "无缓存的校验凭据" },
  verified: { state: "ok", stateText: "已验证", subtitle: "已缓存校验凭据" },
  "refresh-due": { state: "warn", stateText: "待刷新", subtitle: "凭据接近过期" },
  failed: { state: "err", stateText: "失败", subtitle: "校验、刷新或取证失败" },
};

export interface GatewayStateCardViews {
  runtime: GatewayStateCardView;
  remoteLink: GatewayStateCardView;
  remoteProof: GatewayStateCardView;
}

/** 概览与设置共用的三张网关状态卡（不含入口信息卡）。 */
export function deriveGatewayStateViews(states: IngressStates): GatewayStateCardViews {
  return {
    runtime: {
      key: "runtime",
      title: "运行状态",
      ...RUNTIME_VIEWS[states.runtime],
    },
    remoteLink: {
      key: "remote-link",
      title: "远端链路",
      ...REMOTE_LINK_VIEWS[states.remoteLink],
    },
    remoteProof: {
      key: "remote-proof",
      title: "远端证明",
      ...REMOTE_PROOF_VIEWS[states.remoteProof],
    },
  };
}
