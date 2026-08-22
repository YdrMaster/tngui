import { describe, it, expect } from "vitest";
import { serialize, parse } from "./configmodel";
import { defaultModel, defaultFields, INGRESS_MODES, EGRESS_MODES, type ConfigModel, type EntryModel } from "./formspec";

describe("默认模板", () => {
  it("序列化为合法 TNG JSON：外挂 tag + host 127.0.0.1 + port 50000 + no_ra", () => {
    const json = serialize(defaultModel());
    const v = JSON.parse(json);
    expect(v.control_interface.restful.host).toBe("127.0.0.1");
    expect(v.control_interface.restful.port).toBe(50000);
    expect(v.add_ingress[0].mapping).toBeDefined();
    expect(v.add_ingress[0].no_ra).toBe(true);
  });

  it("默认模板往返：parse(serialize(default)) 各字段一致且 extra 为空", () => {
    const m = defaultModel();
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    const m2 = r.model!;
    expect(m2.control_interface.restful.port).toBe(50000);
    expect(m2.add_ingress).toHaveLength(1);
    expect(m2.add_ingress[0].mode).toBe("mapping");
    expect(m2.add_ingress[0].no_ra).toBe(true);
    expect(m2.add_ingress[0].extra).toEqual({});
    expect(m2.extra).toEqual({});
  });
});

describe("各模式序列化/回填", () => {
  it("每个 ingress 模式：defaultFields → serialize → parse 模式与字段保留", () => {
    for (const mode of INGRESS_MODES) {
      const entry: EntryModel = { mode, fields: defaultFields(mode), no_ra: true, extra: {} };
      const m: ConfigModel = { control_interface: { restful: { host: "127.0.0.1", port: 1 }, extra: {} }, add_ingress: [entry], add_egress: [], extra: {} };
      const r = parse(serialize(m));
      expect(r.error, `mode=${mode}`).toBeUndefined();
      expect(r.model!.add_ingress[0].mode).toBe(mode);
      expect(r.model!.add_ingress[0].fields).toEqual(entry.fields);
    }
  });

  it("每个 egress 模式同上", () => {
    for (const mode of EGRESS_MODES) {
      const entry: EntryModel = { mode, fields: defaultFields(mode), no_ra: true, extra: {} };
      const m: ConfigModel = { control_interface: { restful: { host: "127.0.0.1", port: 1 }, extra: {} }, add_ingress: [], add_egress: [entry], extra: {} };
      const r = parse(serialize(m));
      expect(r.error, `mode=${mode}`).toBeUndefined();
      expect(r.model!.add_egress[0].mode).toBe(mode);
    }
  });
});

describe("extra 容器保往返不丢", () => {
  it("RA attest 等未结构化字段经 extra 往返保留", () => {
    const attest = { model: "background_check", attest: { aa_provider: "coco", aa_type: "uds", aa_addr: "https://as" } };
    const entry: EntryModel = { mode: "mapping", fields: defaultFields("mapping"), no_ra: false, extra: { attest, ohttp: { x: 1 } } };
    const m: ConfigModel = { control_interface: { restful: { host: "127.0.0.1", port: 7 }, extra: {} }, add_ingress: [entry], add_egress: [], extra: { metric: { exporters: [{ type: "stdout", step: 30 }] } } };
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    const e0 = r.model!.add_ingress[0];
    expect(e0.no_ra).toBe(false);
    expect(e0.extra.attest).toEqual(attest);
    expect(e0.extra.ohttp).toEqual({ x: 1 });
    expect(r.model!.extra.metric).toEqual({ exporters: [{ type: "stdout", step: 30 }] });
  });

  it("control_interface.extra（如 ttrpc）与顶层 extra 往返", () => {
    const m: ConfigModel = { control_interface: { restful: { host: "127.0.0.1", port: 9 }, extra: { ttrpc: { path: "/tmp/x" } } }, add_ingress: [], add_egress: [], extra: { admin_bind: { port: 1 } } };
    const r = parse(serialize(m));
    expect(r.model!.control_interface.extra.ttrpc).toEqual({ path: "/tmp/x" });
    expect(r.model!.extra.admin_bind).toEqual({ port: 1 });
  });
});

describe("错误处理", () => {
  it("非法 JSON 返回 error", () => {
    expect(parse("{ not json }").error).toMatch(/解析失败/);
  });

  it("根非对象返回 error", () => {
    expect(parse("[]").error).toMatch(/根须为/);
  });

  it("缺 control_interface.restful.port 返回 error", () => {
    expect(parse('{"control_interface":{"restful":{"host":"127.0.0.1"}}}').error).toMatch(/port/);
  });

  it("导入的 host 被强制为 127.0.0.1（安全收口）", () => {
    const r = parse('{"control_interface":{"restful":{"host":"0.0.0.0","port":5}}}');
    expect(r.model!.control_interface.restful.host).toBe("127.0.0.1");
  });
});