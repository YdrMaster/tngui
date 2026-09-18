export type RuntimeState = "stopped" | "running" | "error";
export type RemoteLinkState = "uninit" | "established" | "failed";
export type RemoteProofState =
  | "not-obtained"
  | "verified"
  | "refresh-due"
  | "failed";

export interface IngressObservation {
  reachable: boolean;
  livezOk: boolean;
  ready: boolean;
  statusJson: unknown;
  ingressKeys?: unknown;
  ingressKeysError?: string | null;
  processError?: string | null;
  outputLines?: readonly string[];
}

export interface IngressStates {
  runtime: RuntimeState;
  remoteLink: RemoteLinkState;
  remoteProof: RemoteProofState;
}

/** 只接受结构性失败事件；新增前必须确认对应 TNG 日志格式。 */
const STRUCTURAL_FAILURE_PATTERNS = [
  "failed to update the cached value",
  "failed to get hpke key config",
  "failed to verify attestation",
  "attestation verification failed",
] as const;

const NOISY_NEGATIVES = [
  "attested=false",
  "attested: false",
  "未校验",
] as const;

function containsStructuralFailure(lines: readonly string[]): boolean {
  return lines.some((rawLine) => {
    const line = rawLine.toLowerCase();
    if (NOISY_NEGATIVES.some((negative) => line.includes(negative))) {
      return false;
    }
    return STRUCTURAL_FAILURE_PATTERNS.some((pattern) =>
      line.includes(pattern.toLowerCase()),
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** keys 快照中任一 server 有非空公钥即视为已建联。 */
function hasServerPublicKey(ingressKeys: unknown): boolean {
  if (!isRecord(ingressKeys)) return false;
  const servers = ingressKeys.servers;
  return (
    Array.isArray(servers) &&
    servers.some((server) => {
      if (!isRecord(server)) return false;
      const key = server.server_public_key;
      return typeof key === "string" ? key.trim().length > 0 : key != null;
    })
  );
}

/** keys 快照中任一 server 有非空校验凭据，即存在可导出的远程证明报告。 */
export function hasServerAttestation(ingressKeys: unknown): boolean {
  if (!isRecord(ingressKeys)) return false;
  const servers = ingressKeys.servers;
  return (
    Array.isArray(servers) &&
    servers.some((server) => {
      if (!isRecord(server)) return false;
      const attestation = server.server_attestation;
      return typeof attestation === "string"
        ? attestation.trim().length > 0
        : attestation != null;
    })
  );
}

export function deriveIngressStates(
  observation: IngressObservation,
): IngressStates {
  const hasFailureLog = containsStructuralFailure(observation.outputLines ?? []);
  const processOrServiceError = Boolean(
    observation.processError || (observation.reachable && !observation.livezOk),
  );
  const runtime: RuntimeState = !observation.reachable
    ? "stopped"
    : processOrServiceError || hasFailureLog
      ? "error"
      : observation.ready
        ? "running"
        : "stopped";

  const hasServerPublicKeyResult = hasServerPublicKey(observation.ingressKeys);
  const hasServerAttestationResult = hasServerAttestation(
    observation.ingressKeys,
  );

  const remoteLink: RemoteLinkState =
    hasFailureLog || processOrServiceError
      ? "failed"
      : hasServerPublicKeyResult
        ? "established"
        : "uninit";

  const remoteProof: RemoteProofState =
    hasFailureLog || processOrServiceError
      ? "failed"
      : hasServerAttestationResult
        ? "verified"
        : "not-obtained";

  return { runtime, remoteLink, remoteProof };
}

export interface IngressInfo {
  mode: string;
  modeLabel: string;
  listenAddress: string;
  listenPort: string;
}

const MODE_LABELS: Record<string, string> = {
  mapping: "映射",
  http_proxy: "HTTP 代理",
  socks5: "SOCKS5 代理",
  netfilter: "透明拦截",
  hook: "钩子",
  mapping_udp: "UDP 映射",
};

function textOrDash(value: unknown): string {
  if (value === null || value === undefined) return "——";
  const text = String(value).trim();
  return text.length > 0 ? text : "——";
}

function endpointParts(value: unknown): { host?: unknown; port?: unknown } {
  return isRecord(value) ? { host: value.host, port: value.port } : {};
}

/** 从第一条 ingress 配置生成配置摘要；不表达可达性。 */
export function deriveIngressInfo(entry: unknown): IngressInfo {
  if (!isRecord(entry)) {
    return {
      mode: "",
      modeLabel: "——",
      listenAddress: "——",
      listenPort: "——",
    };
  }

  const mode = typeof entry.mode === "string" ? entry.mode : "";
  const fields = isRecord(entry.fields) ? entry.fields : {};
  let listenAddress: unknown;
  let listenPort: unknown;

  if (mode === "mapping") {
    const rules = Array.isArray(fields.rules) ? fields.rules : [];
    const firstRule = rules.find(isRecord);
    const inbound = endpointParts(firstRule?.in);
    listenAddress = inbound.host;
    listenPort = inbound.port;
  } else if (mode === "http_proxy" || mode === "socks5") {
    const listen = endpointParts(fields.proxy_listen);
    listenAddress = listen.host;
    listenPort = listen.port;
  } else if (mode === "netfilter") {
    const captureList = Array.isArray(fields.capture_dst)
      ? fields.capture_dst
      : [];
    const capture = captureList.find(isRecord);
    listenAddress = capture?.host;
    listenPort = fields.listen_port ?? capture?.port;
  } else if (mode === "hook") {
    const captureList = Array.isArray(fields.capture_dst)
      ? fields.capture_dst
      : [];
    const capture = captureList.find(isRecord);
    listenAddress = fields.proxy_listen ?? capture?.host;
    listenPort = fields.proxy_port ?? capture?.port;
  }

  return {
    mode,
    modeLabel: textOrDash(MODE_LABELS[mode] ?? mode),
    listenAddress: textOrDash(listenAddress),
    listenPort: textOrDash(listenPort),
  };
}
