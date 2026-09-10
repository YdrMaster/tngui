import { describe, expect, it } from "vitest";
import { deriveIngressInfo, deriveIngressStates } from "./ingressState";

const base = {
  reachable: true,
  ready: true,
  livezOk: true,
  statusJson: ["ingress"],
};

describe("deriveIngressStates", () => {
  it("无 keys 快照时保守显示未初始化和未获取", () => {
    expect(deriveIngressStates({ ...base, ingressKeys: null })).toEqual({
      runtime: "running",
      remoteLink: "uninit",
      remoteProof: "not-obtained",
    });
  });

  it("空 keys 与缺公钥/缺凭据回落到未初始化和未获取", () => {
    const observation = {
      ...base,
      ingressKeys: { servers: [{ url: "http://egress/" }] },
    };
    expect(deriveIngressStates(observation)).toEqual({
      runtime: "running",
      remoteLink: "uninit",
      remoteProof: "not-obtained",
    });
  });

  it("有公钥和凭据时分别显示已建联和已验证", () => {
    const observation = {
      ...base,
      ingressKeys: {
        servers: [{ server_public_key: "key", server_attestation: "jwt" }],
      },
    };
    expect(deriveIngressStates(observation)).toEqual({
      runtime: "running",
      remoteLink: "established",
      remoteProof: "verified",
    });
  });

  it("keys 采集错误不改写未初始化/未获取，也不编造远端失败", () => {
    expect(
      deriveIngressStates({
        ...base,
        ingressKeys: null,
        ingressKeysError: "HTTP 404",
      }),
    ).toEqual({
      runtime: "running",
      remoteLink: "uninit",
      remoteProof: "not-obtained",
    });
  });

  it("结构性失败日志把远端链路和证明显示为失败", () => {
    expect(
      deriveIngressStates({
        ...base,
        ingressKeys: {
          servers: [{ server_public_key: "key", server_attestation: "jwt" }],
        },
        outputLines: ["ERROR Failed to update the cached value"],
      }),
    ).toEqual({
      runtime: "error",
      remoteLink: "failed",
      remoteProof: "failed",
    });
  });

  it("噪声信号不触发失败", () => {
    expect(
      deriveIngressStates({
        ...base,
        outputLines: [
          "INFO access log attested=false",
          "INFO token 未校验 this line is unrelated",
        ],
      }),
    ).toEqual({
      runtime: "running",
      remoteLink: "uninit",
      remoteProof: "not-obtained",
    });
  });

  it("进程异常显示错误", () => {
    expect(
      deriveIngressStates({
        ...base,
        processError: "process exited unexpectedly",
      }),
    ).toEqual({
      runtime: "error",
      remoteLink: "failed",
      remoteProof: "failed",
    });
  });

  it("保留 refresh-due 分支，但未引入证据时不得由 keys 或 JWT 推导", () => {
    const states = deriveIngressStates({
      ...base,
      ingressKeys: { servers: [{ server_attestation: "jwt" }] },
    });
    expect(states.remoteProof).not.toBe("refresh-due");
    expect(["not-obtained", "verified", "refresh-due", "failed"]).toContain(
      states.remoteProof,
    );
  });
});

describe("deriveIngressInfo", () => {
  it("mapping 读取第一条入站规则", () => {
    const entry = {
      mode: "mapping",
      fields: { rules: [{ in: { host: "127.0.0.1", port: 10001 } }] },
    };
    expect(deriveIngressInfo(entry)).toEqual({
      mode: "mapping",
      modeLabel: "映射",
      listenAddress: "127.0.0.1",
      listenPort: "10001",
    });
  });

  it("http_proxy 和 socks5 读取 proxy_listen", () => {
    const entry = {
      mode: "http_proxy",
      fields: { proxy_listen: { host: "127.0.0.1", port: 8080 } },
    };
    expect(deriveIngressInfo(entry).listenPort).toBe("8080");
    expect(deriveIngressInfo(entry).listenAddress).toBe("127.0.0.1");
  });

  it("缺配置或缺字段显示空值占位", () => {
    expect(deriveIngressInfo(undefined).listenAddress).toBe("——");
    expect(deriveIngressInfo({ mode: "mapping", fields: {} }).listenPort).toBe("——");
    expect(deriveIngressInfo({ mode: "unknown", fields: {} }).modeLabel).toBe("unknown");
  });
});
