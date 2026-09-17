import { describe, it, expect } from "vitest";
import { serialize, parse, type ParseResult } from "./configmodel";
import {
  defaultModel,
  HEADER_PASSTHROUGH,
  OHTTP_PATH_REWRITES,
  LOCALHOST,
  DEFAULT_OUTWARD,
  DEFAULT_VERIFY,
  INGRESS_MODES,
  PORT_MAX,
  DEFAULT_RVS_URL,
  type ConfigModel,
  type EntryModel,
} from "./formspec";

function mk(over: Partial<ConfigModel> = {}): ConfigModel {
  return {
    control_interface_extra: {},
    add_ingress: [],
    rvsUrl: DEFAULT_RVS_URL,
    extra: {},
    ...over,
  };
}

const OUTWARD_JSON = { host: "127.0.0.1", port: 9443 };

describe("默认模板", () => {
  it("序列化为客户端 OHTTP 形态：含 ohttp、no_ra 缺失而 verify 存在；不含 restful 与 egress", () => {
    const v = JSON.parse(serialize(defaultModel())) as Record<string, unknown>;
    expect(v.control_interface).toBeUndefined();
    expect(v.add_egress).toBeUndefined();
    const ing = (v.add_ingress as Record<string, unknown>[])[0];
    expect(ing.mapping).toBeDefined();
    expect(ing.no_ra).toBeUndefined();
    expect(ing.verify).toBeDefined();
    expect(ing.ohttp).toBeDefined();
    expect((ing.ohttp as { path_rewrites: unknown[] }).path_rewrites).toEqual(OHTTP_PATH_REWRITES);
    expect((ing.ohttp as { header_passthrough: { request_headers: string[] } }).header_passthrough.request_headers).toEqual([...HEADER_PASSTHROUGH]);
  });

  it("序列化包含 GUI 侧 RVS 字段且能往返恢复，不落入顶层 extra", () => {
    const m = mk({ rvsUrl: "https://private-rvs.example.com:8443" });
    const o = JSON.parse(serialize(m)) as Record<string, unknown>;
    expect(o.tngui_rvs_url).toBe("https://private-rvs.example.com:8443");
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    expect(r.model!.rvsUrl).toBe("https://private-rvs.example.com:8443");
    expect(r.model!.extra.tngui_rvs_url).toBeUndefined();
  });

  it("默认模板往返：mode=mapping、no_ra=false、verify 为默认值、extra 空", () => {
    const m = parse(serialize(defaultModel()));
    expect(m.error).toBeUndefined();
    const e = m.model!.add_ingress[0];
    expect(e.mode).toBe("mapping");
    expect(e.no_ra).toBe(false);
    expect(e.verify).toEqual(DEFAULT_VERIFY);
    expect(e.extra).toEqual({});
    expect(m.model!.control_interface_extra).toEqual({});
    expect(m.model!.extra).toEqual({});
  });
});

describe("ingress 锁定形态与互斥序列化", () => {
  it("每种远端形态 defaultFields → serialize → parse 往返保留 mode 与锁定字段", () => {
    for (const mode of INGRESS_MODES) {
      const entry: EntryModel = { mode, fields: (defaultModel().add_ingress[0].fields), no_ra: false, verify: { ...DEFAULT_VERIFY }, outward: { ...DEFAULT_OUTWARD }, extra: {} };
      entry.mode = mode;
      entry.fields = (mode === "mapping"
        ? { rules: [{ in: { host: LOCALHOST, port: 12345 }, out: { host: "10.0.0.1", port: 9999 } }] }
        : { proxy_listen: { host: LOCALHOST, port: 12345 }, dst_filters: { domain: "inference.example.com", port: 8443 } });
      const m = mk({ add_ingress: [entry] });
      const r = parse(serialize(m));
      expect(r.error, `mode=${mode}`).toBeUndefined();
      expect(r.model!.add_ingress).toHaveLength(1);
      expect(r.model!.add_ingress[0].mode).toBe(mode);
      const s = JSON.parse(serialize(r.model!)) as Record<string, unknown>;
      expect((s.add_ingress as Record<string, unknown>[])[0].ohttp).toBeDefined();
    }
  });

  it("no_ra=true：出 no_ra 不出 verify；no_ra=false：出 verify 不出 no_ra", () => {
    for (const no_ra of [true, false]) {
      const entry: EntryModel = { mode: "mapping", fields: defaultModel().add_ingress[0].fields, no_ra, verify: no_ra ? undefined : { model: "passport", as_provider: "tpm" }, outward: { ...DEFAULT_OUTWARD }, extra: {} };
      const o = JSON.parse(serialize(mk({ add_ingress: [entry] }))) as Record<string, unknown>;
      const ing = (o.add_ingress as Record<string, unknown>[])[0];
      if (no_ra) {
        expect(ing.no_ra).toBe(true);
        expect(ing.verify).toBeUndefined();
      } else {
        expect(ing.no_ra).toBeUndefined();
        expect(ing.verify).toBeDefined();
      }
    }
  });

  it("tng 本地监听 host/port 不进用户序列化（in 剥离为空、注入交后端）；outward 序列化往返", () => {
    const m = mk({ add_ingress: [{ mode: "mapping", fields: { rules: [{ in: { host: "0.0.0.0", port: 1 }, out: { host: "10.0.0.1", port: 2 } }] }, no_ra: true, outward: { host: "127.0.0.1", port: 18443 }, extra: {} }] });
    const o = JSON.parse(serialize(m)) as { add_ingress: { mapping: { rules: { in: Record<string, never> }[] }; tngui_outward: { host: string; port: number } }[] };
    // in 被剥离为空对象（tng 本地监听由 tngui 启动时注入，不进用户序列化）
    expect(Object.keys(o.add_ingress[0].mapping.rules[0].in)).toHaveLength(0);
    // outward 作 tngui 侧字段序列化、往返保留
    expect(o.add_ingress[0].tngui_outward).toEqual({ host: "127.0.0.1", port: 18443 });
    const r = parse(serialize(m));
    expect(r.model!.add_ingress[0].outward).toEqual({ host: "127.0.0.1", port: 18443 });
  });

  it("http_proxy dst_filters 序列化为带端口的数组并往返", () => {
    const m = mk({ add_ingress: [{ mode: "http_proxy", fields: { proxy_listen: { host: LOCALHOST, port: 1 }, dst_filters: { domain: "inference-test.cloud.misuan.com", port: 30090 } }, no_ra: true, outward: { ...DEFAULT_OUTWARD }, extra: {} }] });
    const o = JSON.parse(serialize(m)) as { add_ingress: { http_proxy: { dst_filters: { domain: string; port?: number }[] } }[] };
    // 输出为数组 [{domain, port}]，端口走独立字段、不拼进 domain
    expect(o.add_ingress[0].http_proxy.dst_filters).toEqual([{ domain: "inference-test.cloud.misuan.com", port: 30090 }]);
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    const df = r.model!.add_ingress[0].fields.dst_filters as { domain: string; port: number };
    expect(df).toEqual({ domain: "inference-test.cloud.misuan.com", port: 30090 });
  });

  it("http_proxy 端口为空时输出仅 domain（不把端口塞进 domain、不输出 port）", () => {
    const m = mk({ add_ingress: [{ mode: "http_proxy", fields: { proxy_listen: { host: LOCALHOST, port: 1 }, dst_filters: { domain: "x.example.com", port: null } }, no_ra: true, outward: { ...DEFAULT_OUTWARD }, extra: {} }] });
    const o = JSON.parse(serialize(m)) as { add_ingress: { http_proxy: { dst_filters: { domain: string; port?: number }[] }; ohttp: Record<string, unknown> }[] };
    expect(o.add_ingress[0].http_proxy.dst_filters).toEqual([{ domain: "x.example.com" }]);
    expect(o.add_ingress[0].http_proxy.dst_filters[0].port).toBeUndefined();
    expect(o.add_ingress[0].ohttp["tls"]).toBeUndefined();
  });

  it("http_proxy 前缀 https:// 派生 ohttp.tls=true 且序列化剥离前缀", () => {
    const m = mk({ add_ingress: [{ mode: "http_proxy", fields: { proxy_listen: { host: LOCALHOST, port: 1 }, dst_filters: { domain: "https://inference.cloud.misuan.com", port: 443 } }, no_ra: true, outward: { ...DEFAULT_OUTWARD }, tls: true, extra: {} }] });
    const o = JSON.parse(serialize(m)) as { add_ingress: { http_proxy: { dst_filters: { domain: string; port: number }[] }; ohttp: Record<string, unknown> }[] };
    expect(o.add_ingress[0].ohttp["tls"]).toBe(true);
    expect(o.add_ingress[0].http_proxy.dst_filters[0].domain).toBe("inference.cloud.misuan.com");
    expect(o.add_ingress[0].http_proxy.dst_filters[0].port).toBe(443);
    // 往返：导入后域名为无前缀且 tls 语义保留（通过 ohttp.tls 回填）
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    expect((r.model!.add_ingress[0] as { tls?: boolean }).tls).toBe(true);
  });

  it("http_proxy 前缀 http:// 不派生 tls（ohttp 不含 tls）且序列化剥离前缀", () => {
    const m = mk({ add_ingress: [{ mode: "http_proxy", fields: { proxy_listen: { host: LOCALHOST, port: 1 }, dst_filters: { domain: "http://x.example.com", port: 8080 } }, no_ra: true, outward: { ...DEFAULT_OUTWARD }, extra: {} }] });
    const o = JSON.parse(serialize(m)) as { add_ingress: { http_proxy: { dst_filters: { domain: string; port: number }[] }; ohttp: Record<string, unknown> }[] };
    expect(o.add_ingress[0].ohttp["tls"]).toBeUndefined();
    expect(o.add_ingress[0].http_proxy.dst_filters[0].domain).toBe("x.example.com");
  });

  it("导入 ohttp.tls:true 回填 tls并在域名框以 https:// 前缀回显；序列化还原", () => {
    const r = parse(JSON.stringify({ add_ingress: [{ http_proxy: { proxy_listen: { host: "127.0.0.1", port: 1 }, dst_filters: [{ domain: "a.example.com", port: 443 }] }, ohttp: { tls: true }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(r.error).toBeUndefined();
    const e = r.model!.add_ingress[0];
    expect((e as { tls?: boolean }).tls).toBe(true);
    // 域名框以 https:// 前缀回显
    expect((e.fields.dst_filters as { domain: string }).domain).toBe("https://a.example.com");
    // 序列化回到 tng 形态：tls:true + 无前缀 domain
    const o = JSON.parse(serialize(r.model!)) as { add_ingress: { http_proxy: { dst_filters: { domain: string; port: number }[] }; ohttp: Record<string, unknown> }[] };
    expect(o.add_ingress[0].ohttp["tls"]).toBe(true);
    expect(o.add_ingress[0].http_proxy.dst_filters[0].domain).toBe("a.example.com");
    expect(o.add_ingress[0].http_proxy.dst_filters[0].port).toBe(443);
  });

  it("导入 dst_filters.domain 携带 https:// 前缀（即便无 ohttp.tls）也派生 tls=true", () => {
    const r = parse(JSON.stringify({ add_ingress: [{ http_proxy: { proxy_listen: { host: "127.0.0.1", port: 1 }, dst_filters: [{ domain: "https://b.example.com", port: 443 }] }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(r.error).toBeUndefined();
    const e = r.model!.add_ingress[0];
    expect((e as { tls?: boolean }).tls).toBe(true);
    expect((e.fields.dst_filters as { domain: string }).domain).toBe("https://b.example.com");
    const o = JSON.parse(serialize(r.model!)) as { add_ingress: { http_proxy: { dst_filters: { domain: string }[] }; ohttp: Record<string, unknown> }[] };
    expect(o.add_ingress[0].ohttp["tls"]).toBe(true);
    expect(o.add_ingress[0].http_proxy.dst_filters[0].domain).toBe("b.example.com");
  });

  it("导入数组形态 dst_filters 回填为内部 {domain, port}", () => {
    const r = parse(JSON.stringify({ add_ingress: [{ http_proxy: { proxy_listen: { host: "127.0.0.1", port: 1 }, dst_filters: [{ domain: "inference-test.cloud.misuan.com", port: 30090 }] }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(r.error).toBeUndefined();
    const df = r.model!.add_ingress[0].fields.dst_filters as { domain: string; port: number };
    expect(df).toEqual({ domain: "inference-test.cloud.misuan.com", port: 30090 });
  });

  it("导入 http_proxy 端口缺省时不限定目标端口", () => {
    const r = parse(JSON.stringify({ add_ingress: [{ http_proxy: { proxy_listen: { host: "127.0.0.1", port: 1 }, dst_filters: { domain: "x.example.com" } }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(r.error).toBeUndefined();
    const df = r.model!.add_ingress[0].fields.dst_filters as { domain: string; port: number | null };
    expect(df.domain).toBe("x.example.com");
    expect(df.port).toBeNull();
  });

  it("导入显式有效端口保持不变", () => {
    const r = parse(JSON.stringify({
      add_ingress: [
        { mapping: { rules: [{ in: {}, out: { host: "10.0.0.1", port: 40000 } }] }, no_ra: true, tngui_outward: OUTWARD_JSON },
        { http_proxy: { proxy_listen: {}, dst_filters: [{ domain: "x.example.com", port: PORT_MAX }] }, no_ra: true, tngui_outward: OUTWARD_JSON },
      ],
    }));
    expect(r.error).toBeUndefined();
    const m = r.model!.add_ingress[0].fields["rules"] as Array<{ out: { port: number } }>;
    const d = r.model!.add_ingress[1].fields.dst_filters as { port: number };
    expect(m[0].out.port).toBe(40000);
    expect(d.port).toBe(PORT_MAX);
  });

  it("导入 mapping out 缺失或非法端口时不静默回填", () => {
    const missing = parse(JSON.stringify({ add_ingress: [{ mapping: { rules: [{ in: {}, out: { host: "10.0.0.1" } }] }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(missing.error).toContain("mapping.rules[0].out.port");
    const zero = parse(JSON.stringify({ add_ingress: [{ mapping: { rules: [{ in: {}, out: { host: "10.0.0.1", port: 0 } }] }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(zero.error).toContain("mapping.rules[0].out.port");
    const big = parse(JSON.stringify({ add_ingress: [{ mapping: { rules: [{ in: {}, out: { host: "10.0.0.1", port: 65536 } }] }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(big.error).toContain("mapping.rules[0].out.port");
    const serializedNull = parse(JSON.stringify({ add_ingress: [{ mapping: { rules: [{ in: {}, out: { host: "10.0.0.1", port: null } }] }, no_ra: true, tngui_outward: OUTWARD_JSON }] }));
    expect(serializedNull.error).toContain("mapping.rules[0].out.port");
  });

  it("tngui_outward 必填有效端口，缺失或非法时报错", () => {
    const raw = (outward: unknown) => JSON.stringify({
      add_ingress: [{ mapping: { rules: [{ in: {}, out: { host: "10.0.0.1", port: 80 } }] }, no_ra: true, ...(outward === undefined ? {} : { tngui_outward: outward }) }],
    });
    expect(parse(raw(undefined)).error).toContain("tngui_outward.port 缺失");
    expect(parse(raw({ host: "127.0.0.1", port: null })).error).toContain("tngui_outward.port");
    expect(parse(raw({ host: "127.0.0.1", port: 0 })).error).toContain("tngui_outward.port");
    expect(parse(raw({ host: "127.0.0.1", port: 65536 })).error).toContain("tngui_outward.port");
    expect(parse(raw({ host: "127.0.0.1", port: 1.2 })).error).toContain("tngui_outward.port");
    const ok = parse(raw({ host: "127.0.0.1", port: 65535 }));
    expect(ok.error).toBeUndefined();
    expect(ok.model!.add_ingress[0].outward.port).toBe(65535);
  });

  it("import 中自定义 ingress ohttp 被丢弃并用锁定值替代", () => {
    const r = parse(JSON.stringify({
      add_ingress: [{ mapping: { rules: [{ in: { host: "0.0.0.0", port: 1 }, out: { host: "1.1.1.1", port: 2 } }] }, no_ra: true, ohttp: { custom: 1 }, tngui_outward: OUTWARD_JSON }],
    }));
    expect(r.error).toBeUndefined();
    const o = JSON.parse(serialize(r.model!)) as { add_ingress: { ohttp: { path_rewrites: unknown[]; header_passthrough: { request_headers: string[] } } }[] };
    expect((o.add_ingress[0].ohttp as { path_rewrites: unknown[] }).path_rewrites).toEqual(OHTTP_PATH_REWRITES);
    expect(o.add_ingress[0].ohttp.header_passthrough.request_headers).toEqual([...HEADER_PASSTHROUGH]);
    expect((o.add_ingress[0].ohttp as { custom?: number }).custom ?? undefined).toBeUndefined();

    // mapping 与 http_proxy 两条形态都必须输出同一条锁定 path rewrite。
    const two = parse(JSON.stringify({
      add_ingress: [
        { mapping: { rules: [{ in: {}, out: { host: "1.1.1.1", port: 2 } }] }, no_ra: true, tngui_outward: OUTWARD_JSON },
        { http_proxy: { proxy_listen: {}, dst_filters: [{ domain: "a.example.com", port: 443 }] }, no_ra: true, tngui_outward: OUTWARD_JSON },
      ],
    }));
    expect(two.error).toBeUndefined();
    const outs = JSON.parse(serialize(two.model!)) as { add_ingress: { ohttp: { path_rewrites: unknown[]; header_passthrough: { request_headers: string[] } } }[] };
    for (const ing of outs.add_ingress) {
      expect(ing.ohttp.path_rewrites).toEqual(OHTTP_PATH_REWRITES);
      expect(ing.ohttp.header_passthrough.request_headers).toEqual([...HEADER_PASSTHROUGH]);
    }
  });
});

describe("egress 去除与 ingress 形态收敛", () => {
  it("导入含 add_egress：被丢弃且 warning 提示", () => {
    const r = parse(JSON.stringify({
      add_ingress: [{ mapping: { rules: [{ in: { host: "0.0.0.0", port: 1 }, out: { host: "1.1.1.1", port: 2 } }] }, no_ra: true, tngui_outward: OUTWARD_JSON }],
      add_egress: [{ mapping: { rules: [{ in: { port: 3 }, out: { host: "127.0.0.1", port: 4 } }] } }],
    }));
    expect(r.error).toBeUndefined();
    expect(r.model!.add_ingress).toHaveLength(1);
    const o = JSON.parse(serialize(r.model!)) as Record<string, unknown>;
    expect(o.add_egress).toBeUndefined();
    expect(r.warnings?.some((w) => w.includes("add_egress"))).toBe(true);
  });

  it("导入含 socks5/netfilter ingress：被丢弃并 warning；mapping 形态被保留", () => {
    const r = parse(JSON.stringify({
      add_ingress: [
        { mapping: { rules: [{ in: { host: "0.0.0.0", port: 1 }, out: { host: "1.1.1.1", port: 2 } }] }, no_ra: true, tngui_outward: OUTWARD_JSON },
        { socks5: { proxy_listen: { host: "0.0.0.0", port: 3 } }, no_ra: true },
        { netfilter: { capture_dst: [{ port: 9 }] }, no_ra: true },
      ],
    })) as ParseResult;
    expect(r.error).toBeUndefined();
    expect(r.model!.add_ingress).toHaveLength(1);
    expect(r.model!.add_ingress[0].mode).toBe("mapping");
    expect(r.warnings?.length).toBe(2);
    expect(r.warnings?.every((w) => w.includes("mapping/http_proxy"))).toBe(true);
  });
});

describe("未结构化字段往返", () => {
  it("ingress extra（ attest 等）与顶层 extra 往返；ohttp 仍用锁定值", () => {
    const m = mk({
      add_ingress: [{ mode: "mapping", fields: defaultModel().add_ingress[0].fields, no_ra: false, verify: { model: "passport", as_provider: "tpm" }, outward: { ...DEFAULT_OUTWARD }, extra: { attest: { aa_provider: "coco" } } }],
      extra: { metric: { step: 30 } },
    });
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    expect((r.model!.add_ingress[0].extra as { attest: { aa_provider: string } }).attest.aa_provider).toBe("coco");
    expect((r.model!.extra as { metric: { step: number } }).metric.step).toBe(30);
    const o = JSON.parse(serialize(r.model!)) as { add_ingress: { ohttp: unknown }[] };
    expect(o.add_ingress[0].ohttp).toBeDefined();
  });

  it("control_interface 同级（ttrpc）与顶层 extra 往返；restful 丢弃", () => {
    const r = parse(JSON.stringify({
      control_interface: { restful: { host: "0.0.0.0", port: 5 }, ttrpc: { path: "/tmp/x" } },
      add_ingress: [],
      extra_field: 1,
    }));
    expect(r.error).toBeUndefined();
    expect(r.model!.control_interface_extra.ttrpc).toEqual({ path: "/tmp/x" });
    expect(r.model!.control_interface_extra.restful).toBeUndefined();
    expect((r.model!.extra as { extra_field: number }).extra_field).toBe(1);
    const o = JSON.parse(serialize(r.model!)) as Record<string, Record<string, unknown>>;
    expect(o.control_interface?.restful).toBeUndefined();
    expect(o.control_interface?.ttrpc).toEqual({ path: "/tmp/x" });
  });
});

describe("错误处理", () => {
  it("非法 JSON 返回 error", () => {
    expect(parse("{ not json }").error).toMatch(/解析失败/);
  });
  it("根非对象返回 error", () => {
    expect(parse("[]").error).toMatch(/根须为/);
  });
  it("add_egress 非数组返回 error", () => {
    expect(parse(JSON.stringify({ add_egress: 5 })).error).toMatch(/add_egress 须为数组/);
  });
});


describe("用户端口限制", () => {
  it("http_proxy 缺省/留空端口序列化为无 port，显式有效端口保留", () => {
    const empty = mk({
      add_ingress: [{
        mode: "http_proxy",
        fields: { proxy_listen: { host: LOCALHOST, port: 1 }, dst_filters: { domain: "x.example.com", port: null } },
        no_ra: true,
        outward: { ...DEFAULT_OUTWARD },
        extra: {},
      }],
    });
    const oEmpty = JSON.parse(serialize(empty)) as { add_ingress: { http_proxy: { dst_filters: Record<string, unknown>[] } }[] };
    expect(oEmpty.add_ingress[0].http_proxy.dst_filters[0].port).toBeUndefined();

    const explicit = mk({
      add_ingress: [{
        mode: "http_proxy",
        fields: { proxy_listen: { host: LOCALHOST, port: 1 }, dst_filters: { domain: "x.example.com", port: 65535 } },
        no_ra: true,
        outward: { ...DEFAULT_OUTWARD },
        extra: {},
      }],
    });
    const oExplicit = JSON.parse(serialize(explicit)) as { add_ingress: { http_proxy: { dst_filters: { port: number }[] } }[] };
    expect(oExplicit.add_ingress[0].http_proxy.dst_filters[0].port).toBe(65535);
  });

  it("http_proxy 显式 0/越界导入报错", () => {
    for (const port of [0, 65536]) {
      const r = parse(JSON.stringify({
        add_ingress: [{
          http_proxy: { proxy_listen: {}, dst_filters: [{ domain: "x.example.com", port }] },
          no_ra: true,
          tngui_outward: OUTWARD_JSON,
        }],
      }));
      expect(r.error).toContain("http_proxy.dst_filters[0].port");
    }
  });

  it("mapping 与 outward 清空后序列化保留空值，不回填默认端口", () => {
    const m = mk({
      add_ingress: [{
        mode: "mapping",
        fields: { rules: [{ in: { host: LOCALHOST, port: 1 }, out: { host: "10.0.0.1", port: null } }] },
        no_ra: true,
        outward: { host: "127.0.0.1", port: null },
        extra: {},
      }],
    });
    const o = JSON.parse(serialize(m)) as { add_ingress: { mapping: { rules: { out: { port: number | null } }[] }; tngui_outward: { port: number | null } }[] };
    expect(o.add_ingress[0].mapping.rules[0].out.port).toBeNull();
    expect(o.add_ingress[0].tngui_outward.port).toBeNull();
  });

  it("非法端口导入/回填报错，http_proxy 缺省端口不报错", () => {
    const missingProxyPort = parse(JSON.stringify({
      add_ingress: [{
        http_proxy: { proxy_listen: {}, dst_filters: [{ domain: "x.example.com" }] },
        no_ra: true,
        tngui_outward: OUTWARD_JSON,
      }],
    }));
    expect(missingProxyPort.error).toBeUndefined();

    const invalidOutward = parse(JSON.stringify({
      add_ingress: [{
        mapping: { rules: [{ in: {}, out: { host: "10.0.0.1", port: 80 } }] },
        no_ra: true,
        tngui_outward: { host: "127.0.0.1", port: -1 },
      }],
    }));
    expect(invalidOutward.error).toContain("tngui_outward.port");
  });
});
