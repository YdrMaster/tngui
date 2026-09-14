import { describe, it, expect } from "vitest";
import { serialize, parse, type ParseResult } from "./configmodel";
import {
  defaultModel,
  HEADER_PASSTHROUGH,
  LOCALHOST,
  DEFAULT_OUTWARD,
  DEFAULT_VERIFY,
  INGRESS_MODES,
  type ConfigModel,
  type EntryModel,
} from "./formspec";

function mk(over: Partial<ConfigModel> = {}): ConfigModel {
  return {
    control_interface_extra: {},
    add_ingress: [],
    extra: {},
    ...over,
  };
}

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
    expect((ing.ohttp as { header_passthrough: { request_headers: string[] } }).header_passthrough.request_headers).toEqual([...HEADER_PASSTHROUGH]);
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
        : { proxy_listen: { host: LOCALHOST, port: 12345 }, dst_filters: { domain: "inference.example.com:8443" } });
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

  it("http_proxy dst_filters.domain 单文本往返（不结构限定）", () => {
    const m = mk({ add_ingress: [{ mode: "http_proxy", fields: { proxy_listen: { host: LOCALHOST, port: 1 }, dst_filters: { domain: "https://x.example.com/v1" } }, no_ra: true, outward: { ...DEFAULT_OUTWARD }, extra: {} }] });
    const r = parse(serialize(m));
    const df = r.model!.add_ingress[0].fields.dst_filters as { domain: string };
    expect(df.domain).toBe("https://x.example.com/v1");
  });

  it("import 中自定义 ingress ohttp 被丢弃并用锁定值替代", () => {
    const r = parse(JSON.stringify({
      add_ingress: [{ mapping: { rules: [{ in: { host: "0.0.0.0", port: 1 }, out: { host: "1.1.1.1", port: 2 } }] }, no_ra: true, ohttp: { custom: 1 } }],
    }));
    expect(r.error).toBeUndefined();
    const o = JSON.parse(serialize(r.model!)) as { add_ingress: { ohttp: { header_passthrough: { request_headers: string[] } } }[] };
    expect(o.add_ingress[0].ohttp.header_passthrough.request_headers).toEqual([...HEADER_PASSTHROUGH]);
    expect((o.add_ingress[0].ohttp as { custom?: number }).custom ?? undefined).toBeUndefined();
  });
});

describe("egress 去除与 ingress 形态收敛", () => {
  it("导入含 add_egress：被丢弃且 warning 提示", () => {
    const r = parse(JSON.stringify({
      add_ingress: [{ mapping: { rules: [{ in: { host: "0.0.0.0", port: 1 }, out: { host: "1.1.1.1", port: 2 } }] }, no_ra: true }],
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
        { mapping: { rules: [{ in: { host: "0.0.0.0", port: 1 }, out: { host: "1.1.1.1", port: 2 } }] }, no_ra: true },
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
