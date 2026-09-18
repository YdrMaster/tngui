import { describe, expect, it } from "vitest";
import {
  DEFAULT_HTTP_PROXY_DOMAIN,
  DEFAULT_HTTP_PROXY_DST_PORT,
  DEFAULT_MAPPING_OUT_PORT,
  DEFAULT_RVS_URL,
  defaultFields,
  defaultModel,
  isRemoteAttestationEnabled,
  isRemoteConfigured,
  isValidPort,
  PORT_MAX,
  PORT_MIN,
  type ConfigModel,
  type EntryModel,
} from "./formspec";

function mappingModel(host: string): ConfigModel {
  const model = defaultModel();
  model.ingress = {
    mode: "mapping",
    fields: defaultFields("mapping"),
    no_ra: true,
    outward: { host: "127.0.0.1", port: 9443 },
    extra: {},
  };
  const rules = model.ingress.fields["rules"] as Array<{ out: { host: string } }>;
  rules[0].out.host = host;
  return model;
}

describe("默认单一 ingress 配置", () => {
  it("默认使用域名代理、常用域名与 443 端口", () => {
    const model = defaultModel();
    const { ingress } = model;

    expect(ingress.mode).toBe("http_proxy");
    expect(ingress.fields.dst_filters).toEqual({
      domain: DEFAULT_HTTP_PROXY_DOMAIN,
      port: DEFAULT_HTTP_PROXY_DST_PORT,
    });
    expect(ingress.fields.dst_filters).toEqual({
      domain: "https://inference.cloud.misuan.com",
      port: 443,
    });
    expect(ingress.no_ra).toBe(false);
  });

  it("默认 RVS 地址为 https://rvs.tsk.com 且不携带旧端口", () => {
    expect(DEFAULT_RVS_URL).toBe("https://rvs.tsk.com");
    expect(defaultModel().rvsUrl).toBe(DEFAULT_RVS_URL);
  });

  it("默认 ingress 模型不携带可编辑 verify 状态", () => {
    expect("verify" in defaultModel().ingress).toBe(false);
  });

  it("远端类型切换默认字段分别使用 80/443", () => {
    const mapping = defaultFields("mapping") as {
      rules: [{ out: { port: number } }];
    };
    const proxy = defaultFields("http_proxy") as {
      dst_filters: { port: number };
    };

    expect(mapping.rules[0].out.port).toBe(80);
    expect(mapping.rules[0].out.port).toBe(DEFAULT_MAPPING_OUT_PORT);
    expect(proxy.dst_filters.port).toBe(443);
  });
});

describe("远程证明与启动前配置状态", () => {
  it("当前唯一 ingress 开启 RA 时显示 RVS 配置块", () => {
    const model = defaultModel();
    expect(isRemoteAttestationEnabled(model)).toBe(true);
    model.ingress.no_ra = true;
    expect(isRemoteAttestationEnabled(model)).toBe(false);
  });

  it("域名代理模式视为远端已配置", () => {
    expect(isRemoteConfigured(defaultModel())).toBe(true);
  });

  it("端点映射模式按 out.host 的 IPv4 有效性判定", () => {
    expect(isRemoteConfigured(mappingModel("10.0.0.5"))).toBe(true);
    expect(isRemoteConfigured(mappingModel("0.0.0.0"))).toBe(true);
    expect(isRemoteConfigured(mappingModel("010.0.0.1"))).toBe(false);
    expect(isRemoteConfigured(mappingModel("256.1.1.1"))).toBe(false);
    expect(isRemoteConfigured(mappingModel("cluster.example.com"))).toBe(false);
    expect(isRemoteConfigured(mappingModel("   "))).toBe(false);
  });

  it("端点映射模式规则为空时不拦截启动", () => {
    const model = mappingModel("");
    model.ingress.fields["rules"] = [];
    expect(isRemoteConfigured(model)).toBe(true);
  });
});

describe("端口有效性判定", () => {
  it("接受 1~65535 整数端口", () => {
    expect(PORT_MIN).toBe(1);
    expect(PORT_MAX).toBe(65535);
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it("拒绝 0、越界、小数和非数字端口", () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(1.2)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(null)).toBe(false);
    expect(isValidPort(undefined)).toBe(false);
    expect(isValidPort("443")).toBe(false);
  });
});

function unusedEntryModelTypeGuard(value: EntryModel): void {
  expect(value.mode).toBeTruthy();
}
void unusedEntryModelTypeGuard;
