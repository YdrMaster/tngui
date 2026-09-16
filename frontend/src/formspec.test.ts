import { describe, it, expect } from "vitest";
import { defaultFields, defaultModel, isRemoteConfigured, DEFAULT_HTTP_PROXY_DST_PORT, DEFAULT_MAPPING_OUT_PORT, type ConfigModel, type EntryModel } from "./formspec";

function setOutHost(m: ConfigModel, host: string): void {
  const e = m.add_ingress[0];
  const rules = e.fields["rules"] as Array<{ out: { host: string; port: number } }>;
  rules[0].out.host = host;
}
function mappingModel(host: string): ConfigModel {
  const m = defaultModel();
  setOutHost(m, host);
  return m;
}

describe("isRemoteConfigured（镜像后端 validate_ingress_for_launch）", () => {
  it("缺省模板 out.host 留空 → 未配置", () => {
    expect(isRemoteConfigured(defaultModel())).toBe(false);
  });
  it("out.host 合法 IPv4 → 已配置", () => {
    expect(isRemoteConfigured(mappingModel("10.0.0.5"))).toBe(true);
    expect(isRemoteConfigured(mappingModel("0.0.0.0"))).toBe(true);
  });
  it("out.host 前导零 → 未配置（与 Rust Ipv4Addr 拒前导零一致）", () => {
    expect(isRemoteConfigured(mappingModel("010.0.0.1"))).toBe(false);
    expect(isRemoteConfigured(mappingModel("192.168.001.001"))).toBe(false);
  });
  it("out.host 超界/非 4 段/域名 → 未配置", () => {
    expect(isRemoteConfigured(mappingModel("256.1.1.1"))).toBe(false);
    expect(isRemoteConfigured(mappingModel("1.2.3"))).toBe(false);
    expect(isRemoteConfigured(mappingModel("1.2.3.4.5"))).toBe(false);
    expect(isRemoteConfigured(mappingModel("cluster.example.com"))).toBe(false);
  });
  it("out.host 首尾空格 → 已配置（后端先 trim 再 parse）", () => {
    expect(isRemoteConfigured(mappingModel("  10.0.0.5  "))).toBe(true);
  });
  it("out.host 全空白 → 未配置", () => {
    expect(isRemoteConfigured(mappingModel("   "))).toBe(false);
  });
  it("缺少 out 对象 → 未配置", () => {
    const m = defaultModel();
    const e = m.add_ingress[0];
    const rules = e.fields["rules"] as Array<Record<string, unknown>>;
    delete rules[0].out;
    expect(isRemoteConfigured(m)).toBe(false);
  });
  it("mapping rules 为空数组 → 已配置（与后端不拦一致）", () => {
    const m = defaultModel();
    const e = m.add_ingress[0];
    e.fields["rules"] = [];
    expect(isRemoteConfigured(m)).toBe(true);
  });
  it("http_proxy domain 空 → 已配置（与后端不拦一致：tng 仍加载）", () => {
    const m: ConfigModel = {
      control_interface_extra: {},
      add_ingress: [
        {
          mode: "http_proxy",
          fields: { proxy_listen: { host: "127.0.0.1", port: 18443 }, dst_filters: { domain: "", port: 0 } },
          no_ra: true,
          outward: { host: "127.0.0.1", port: 18443 },
          extra: {},
        },
      ],
      extra: {},
    };
    expect(isRemoteConfigured(m)).toBe(true);
  });
  it("多条 ingress，任一 mapping out.host 非法 → 未配置", () => {
    const m = mappingModel("10.0.0.5");
    const e2: EntryModel = {
      mode: "mapping",
      fields: { rules: [{ in: { host: "127.0.0.1", port: 18444 }, out: { host: "not-an-ip", port: 10000 } }] },
      no_ra: true,
      outward: { host: "127.0.0.1", port: 18443 },
      extra: {},
    };
    m.add_ingress.push(e2);
    expect(isRemoteConfigured(m)).toBe(false);
  });
});

describe("ingress 默认远端端口", () => {
  it("默认模板使用 mapping 远端端口 80，反代对外绑定仍为 9443", () => {
    const m = defaultModel();
    const rules = m.add_ingress[0].fields["rules"] as Array<{ out: { port: number } }>;
    expect(rules[0].out.port).toBe(DEFAULT_MAPPING_OUT_PORT);
    expect(rules[0].out.port).toBe(80);
    expect(m.add_ingress[0].outward.port).toBe(9443);
  });

  it("远端类型切换默认字段分别使用 80/443", () => {
    const mapping = defaultFields("mapping") as { rules: [{ out: { port: number } }] };
    const proxy = defaultFields("http_proxy") as { dst_filters: { port: number } };
    expect(mapping.rules[0].out.port).toBe(80);
    expect(proxy.dst_filters.port).toBe(443);
    expect(DEFAULT_HTTP_PROXY_DST_PORT).toBe(443);
  });
});
