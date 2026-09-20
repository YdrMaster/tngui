import { describe, expect, it } from "vitest";
import { parse, serialize, TNGUI_RVS_URL_FIELD } from "./configmodel";
import {
  DEFAULT_HTTP_PROXY_DOMAIN,
  DEFAULT_RVS_URL,
  DEFAULT_VERIFY,
  HEADER_PASSTHROUGH,
  INGRESS_MODES,
  LOCALHOST,
  OHTTP_PATH_REWRITES,
  defaultFields,
  defaultModel,
  type ConfigModel,
  type EntryModel,
  type OutwardBind,
} from "./formspec";

const OUTWARD_JSON: OutwardBind = { host: "127.0.0.1", port: 9443 };

function mk(override: Partial<ConfigModel> = {}): ConfigModel {
  return {
    control_interface_extra: {},
    ingress: defaultModel().ingress,
    rvsUrl: DEFAULT_RVS_URL,
    extra: {},
    ...override,
  };
}

function mappingEntry(host = "10.0.0.1", port = 80): EntryModel {
  const fields = defaultFields("mapping");
  const rules = fields["rules"] as Array<{ out: { host: string; port: number } }>;
  rules[0].out.host = host;
  rules[0].out.port = port;
  return {
    mode: "mapping",
    fields,
    no_ra: true,
    outward: { ...OUTWARD_JSON },
    extra: {},
  };
}

function proxyEntry(domain = "a.example.com", port: number | null = 443): EntryModel {
  return {
    mode: "http_proxy",
    fields: {
      proxy_listen: { host: LOCALHOST, port: 1 },
      dst_filters: { domain, port },
    },
    no_ra: true,
    outward: { ...OUTWARD_JSON },
    extra: {},
  };
}

function ingressJson(entry: Record<string, unknown>): string {
  return JSON.stringify({ add_ingress: [entry] });
}

function outputIngress(json: string): Record<string, any> {
  return (JSON.parse(json).add_ingress as Record<string, any>[])[0];
}

describe("默认模型与兼容序列化", () => {
  it("默认模型序列化为单元素 add_ingress 数组，使用默认域名代理", () => {
    const json = serialize(defaultModel());
    const root = JSON.parse(json) as Record<string, unknown>;
    expect(Array.isArray(root.add_ingress)).toBe(true);
    const ing = outputIngress(json);

    expect(root.add_ingress).toHaveLength(1);
    expect(ing.http_proxy).toBeDefined();
    expect(ing.http_proxy.dst_filters).toEqual([
      { domain: "inference.cloud.misuan.com", port: 443 },
    ]);
    expect(ing.ohttp.tls).toBe(true);
    expect(ing.verify).toEqual(DEFAULT_VERIFY);
    expect(root.add_egress).toBeUndefined();
  });

  it("默认模型往返保留单一 ingress 和默认值", () => {
    const result = parse(serialize(defaultModel()));

    expect(result.error).toBeUndefined();
    expect(result.model!.ingress.mode).toBe("http_proxy");
    expect(result.model!.ingress.fields.dst_filters).toEqual(defaultModel().ingress.fields.dst_filters);
    expect(result.model!.ingress.no_ra).toBe(false);
    expect(result.model!.ingress.outward).toEqual(defaultModel().ingress.outward);
    expect(result.model!.extra).toEqual({});
  });

  it("锁定的 UI 状态不是配置模型的一部分", () => {
    const json = serialize(defaultModel());
    expect(JSON.parse(json).configLocked).toBeUndefined();
    expect(json).not.toContain("configLocked");
  });
});

describe("RVS 地址", () => {
  it("默认使用 https://rvs.cloud.misuan.com 且能往返", () => {
    const result = parse(serialize(mk()));
    expect(result.model!.rvsUrl).toBe("https://rvs.cloud.misuan.com");
    expect(result.model!.extra[TNGUI_RVS_URL_FIELD]).toBeUndefined();
  });

  it("导入或回填中的显式 RVS 值优先于默认值", () => {
    const result = parse(
      JSON.stringify({
        add_ingress: [mappingJsonShape()],
        [TNGUI_RVS_URL_FIELD]: "https://private-rvs.example.com:8443",
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.model!.rvsUrl).toBe("https://private-rvs.example.com:8443");
  });
});

describe("单一 ingress 与导入收敛", () => {
  it("导入多条 ingress 时仅保留第一条并提示丢弃其余条目", () => {
    const first = mappingJsonShape({ host: "10.0.0.1" });
    const second = proxyJsonShape({ domain: "second.example.com" });
    const third = mappingJsonShape({ host: "10.0.0.2" });
    const result = parse(
      JSON.stringify({ add_ingress: [first, second, third] }),
    );

    expect(result.error).toBeUndefined();
    expect(result.warnings).toEqual([
      "已丢弃 add_ingress[1]（仅支持一条 ingress）",
      "已丢弃 add_ingress[2]（仅支持一条 ingress）",
    ]);
    expect(result.model!.ingress.mode).toBe("mapping");
    expect(outputIngress(serialize(result.model!)).mapping.rules[0].out.host).toBe("10.0.0.1");
  });

  it("无可识别 ingress 时回退默认域名代理配置并提示", () => {
    const result = parse(JSON.stringify({ add_ingress: [] }));

    expect(result.error).toBeUndefined();
    expect(result.model!.ingress).toEqual(defaultModel().ingress);
    expect(result.warnings).toEqual([
      "无可识别的 ingress，已回退默认域名代理配置",
    ]);
  });

  it("仅支持端点映射与域名代理两种底层形态，其他形态被丢弃", () => {
    const result = parse(
      JSON.stringify({
        add_ingress: [
          { socks5: { proxy_listen: {} }, no_ra: true },
          mappingJsonShape({ host: "10.0.0.1" }),
        ],
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.model!.ingress.mode).toBe("mapping");
    expect(result.warnings?.[0]).toContain("mapping/http_proxy");
  });

  it("空 JSON 中的 add_egress 被丢弃并提示", () => {
    const result = parse(
      JSON.stringify({ add_ingress: [mappingJsonShape()], add_egress: [{}] }),
    );

    expect(result.error).toBeUndefined();
    expect(result.model!.ingress.mode).toBe("mapping");
    expect(result.warnings?.some((item) => item.includes("add_egress"))).toBe(true);
  });
});

describe("RA 与 verify 互斥序列化", () => {
  it("RA 开启输出默认 verify；RA 关闭输出 no_ra", () => {
    const on = mk({ ingress: { ...mappingEntry(), no_ra: false } });
    const off = mk({ ingress: { ...mappingEntry(), no_ra: true } });
    const onJson = outputIngress(serialize(on));
    const offJson = outputIngress(serialize(off));

    expect(onJson.verify).toEqual(DEFAULT_VERIFY);
    expect(onJson.no_ra).toBeUndefined();
    expect(offJson.no_ra).toBe(true);
    expect(offJson.verify).toBeUndefined();
  });

  it("导入自定义 verify 只保留 RA 开启信号，序列化重置为默认值", () => {
    const result = parse(
      ingressJson({
        ...mappingJsonShape(),
        verify: { model: "custom-model", as_provider: "custom-provider" },
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.model!.ingress.no_ra).toBe(false);
    expect("verify" in result.model!.ingress).toBe(false);
    expect(outputIngress(serialize(result.model!)).verify).toEqual(DEFAULT_VERIFY);
  });
});

describe("远端形态序列化与解析", () => {
  it("端点映射保留远端 host/port，并剥离内部监听", () => {
    const model = mk({ ingress: mappingEntry("10.0.0.5", 8080) });
    const json = serialize(model);
    const ing = outputIngress(json);

    expect(ing.mapping.rules).toEqual([
      { in: {}, out: { host: "10.0.0.5", port: 8080 } },
    ]);
    const parsed = parse(json);
    expect(parsed.error).toBeUndefined();
    expect(parsed.model!.ingress.fields.rules).toEqual([
      { in: {}, out: { host: "10.0.0.5", port: 8080 } },
    ]);
  });

  it("域名代理序列化为 dst_filters 数组并保留 TLS 语义", () => {
    const model = mk({ ingress: proxyEntry("https://inference.example.com", 443) });
    const json = serialize(model);
    const ing = outputIngress(json);

    expect(ing.http_proxy.dst_filters).toEqual([
      { domain: "inference.example.com", port: 443 },
    ]);
    expect(ing.ohttp.tls).toBe(true);
    const parsed = parse(json);
    expect(parsed.model!.ingress.mode).toBe("http_proxy");
    expect((parsed.model!.ingress.fields.dst_filters as { domain: string }).domain)
      .toBe("https://inference.example.com");
  });

  it("域名代理端口留空时输出仅 domain", () => {
    const json = serialize(mk({ ingress: proxyEntry("x.example.com", null) }));
    expect(outputIngress(json).http_proxy.dst_filters).toEqual([
      { domain: "x.example.com" },
    ]);
  });

  it("导入/回填的域名仅扣首尾空白并保留内部字符与大小写", () => {
    const result = parse(
      ingressJson({
        ...proxyJsonShape({ domain: "  https://Ex ample.com  ", port: 443 }),
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.model!.ingress.fields.dst_filters).toEqual({
      domain: "https://Ex ample.com",
      port: 443,
    });
    expect(outputIngress(serialize(result.model!)).http_proxy.dst_filters).toEqual([
      { domain: "Ex ample.com", port: 443 },
    ]);
  });

  it("两种底层模式均可往返", () => {
    for (const mode of INGRESS_MODES) {
      const model = mk({
        ingress: mode === "mapping" ? mappingEntry() : proxyEntry(),
      });
      const roundTripped = parse(serialize(model));

      expect(roundTripped.error, `mode=${mode}`).toBeUndefined();
      expect(roundTripped.model!.ingress.mode).toBe(mode);
      expect(outputIngress(serialize(model)).ohttp).toBeDefined();
    }
  });
});

describe("锁定 OHTTP 与未结构化字段", () => {
  it("自定义 ohttp 被锁定值替代", () => {
    const result = parse(
      ingressJson({ ...mappingJsonShape(), ohttp: { custom: 1 } }),
    );
    expect(result.error).toBeUndefined();
    const ing = outputIngress(serialize(result.model!));

    expect(ing.ohttp.path_rewrites).toEqual(OHTTP_PATH_REWRITES);
    expect(ing.ohttp.header_passthrough.request_headers).toEqual([
      ...HEADER_PASSTHROUGH,
    ]);
    expect(ing.ohttp.custom).toBeUndefined();
  });

  it("ingress extra 与顶层 extra 可往返", () => {
    const model = mk({
      ingress: { ...mappingEntry(), extra: { attest: { provider: "coco" } } },
      extra: { metric: { step: 30 } },
    });
    const result = parse(serialize(model));

    expect(result.error).toBeUndefined();
    expect(result.model!.ingress.extra).toEqual({ attest: { provider: "coco" } });
    expect(result.model!.extra).toEqual({ metric: { step: 30 } });
  });

  it("control_interface.restful 被丢弃，其余同级可往返", () => {
    const result = parse(
      JSON.stringify({
        control_interface: { restful: { host: "0.0.0.0", port: 1 }, ttrpc: { path: "/tmp/x" } },
        add_ingress: [mappingJsonShape()],
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.model!.control_interface_extra).toEqual({ ttrpc: { path: "/tmp/x" } });
    expect(JSON.parse(serialize(result.model!)).control_interface.restful).toBeUndefined();
  });
});

describe("端口与 JSON 错误", () => {
  it("保留显式合法端口并拒绝非法端口", () => {
    const valid = parse(ingressJson(proxyJsonShape({ port: 65535 })));
    expect(valid.error).toBeUndefined();
    expect(outputIngress(serialize(valid.model!)).http_proxy.dst_filters[0].port).toBe(65535);

    const invalid = parse(ingressJson(proxyJsonShape({ port: 0 })));
    expect(invalid.error).toContain("http_proxy.dst_filters[0].port");
  });

  it("拒绝非法 outward 端口", () => {
    const result = parse(ingressJson({
      ...mappingJsonShape(),
      tngui_outward: { host: "127.0.0.1", port: 0 },
    }));
    expect(result.error).toContain("tngui_outward.port");
  });

  it("拒绝非法 JSON、根对象和数组形态", () => {
    expect(parse("{ not json }").error).toContain("JSON 解析失败");
    expect(parse("[]").error).toContain("配置根须为 JSON 对象");
    expect(parse(JSON.stringify({ add_ingress: {} })).error).toContain("add_ingress 须为数组");
    expect(parse(JSON.stringify({ add_egress: 1 })).error).toContain("add_egress 须为数组");
  });
});

function mappingJsonShape(override: { host?: string; port?: number } = {}): Record<string, unknown> {
  return {
    mapping: {
      rules: [
        { in: {}, out: { host: override.host ?? "10.0.0.1", port: override.port ?? 80 } },
      ],
    },
    no_ra: true,
    tngui_outward: OUTWARD_JSON,
  };
}

function proxyJsonShape(override: { domain?: string; port?: number } = {}): Record<string, unknown> {
  return {
    http_proxy: {
      proxy_listen: {},
      dst_filters: [{ domain: override.domain ?? "a.example.com", port: override.port ?? 443 }],
    },
    no_ra: true,
    tngui_outward: OUTWARD_JSON,
  };
}
