import { describe, it, expect } from "vitest";
import { serialize, parse } from "./configmodel";
import { defaultModel, defaultFields, INGRESS_MODES, EGRESS_MODES, type ConfigModel, type EntryModel } from "./formspec";

describe("默认模板", () => {
  it("序列化为合法 TNG JSON：外挂 tag + no_ra，且不含 control_interface 的 restful 子段", () => {
    const json = serialize(defaultModel());
    const v = JSON.parse(json) as Record<string, unknown>;
    expect(v.control_interface).toBeUndefined();
    expect((v.add_ingress as unknown[])[0]).toBeTruthy();
    const ing0 = (v.add_ingress as Record<string, unknown>[])[0];
    expect(ing0.mapping).toBeDefined();
    expect(ing0.no_ra).toBe(true);
  });

  it("默认模板往返：parse(serialize(default)) 各字段一致且 extra 为空", () => {
    const m = defaultModel();
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    const m2 = r.model!;
    expect(m2.control_interface_extra).toEqual({});
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
      const m: ConfigModel = { control_interface_extra: {}, add_ingress: [entry], add_egress: [], extra: {} };
      const r = parse(serialize(m));
      expect(r.error, `mode=${mode}`).toBeUndefined();
      expect(r.model!.add_ingress[0].mode).toBe(mode);
      expect(r.model!.add_ingress[0].fields).toEqual(entry.fields);
    }
  });

  it("每个 egress 模式同上", () => {
    for (const mode of EGRESS_MODES) {
      const entry: EntryModel = { mode, fields: defaultFields(mode), no_ra: true, extra: {} };
      const m: ConfigModel = { control_interface_extra: {}, add_ingress: [], add_egress: [entry], extra: {} };
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
    const m: ConfigModel = { control_interface_extra: {}, add_ingress: [entry], add_egress: [], extra: { metric: { exporters: [{ type: "stdout", step: 30 }] } } };
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    const e0 = r.model!.add_ingress[0];
    expect(e0.no_ra).toBe(false);
    expect(e0.extra.attest).toEqual(attest);
    expect(e0.extra.ohttp).toEqual({ x: 1 });
    expect(r.model!.extra.metric).toEqual({ exporters: [{ type: "stdout", step: 30 }] });
  });

  it("control_interface 同级（如 ttrpc）与顶层 extra 往返", () => {
    const m: ConfigModel = { control_interface_extra: { ttrpc: { path: "/tmp/x" } }, add_ingress: [], add_egress: [], extra: { admin_bind: { port: 1 } } };
    const r = parse(serialize(m));
    expect(r.error).toBeUndefined();
    expect(r.model!.control_interface_extra.ttrpc).toEqual({ path: "/tmp/x" });
    expect(r.model!.extra.admin_bind).toEqual({ port: 1 });
  });
});

describe("管控面不暴露（restful 子段由 tngui 注入）", () => {
  it("serialize 不输出 control_interface 的 restful 子段", () => {
    const m: ConfigModel = { control_interface_extra: { ttrpc: { path: "/tmp/y" } }, add_ingress: [], add_egress: [], extra: {} };
    const v = JSON.parse(serialize(m)) as Record<string, Record<string, unknown>>;
    expect(v.control_interface).toBeDefined();
    expect(v.control_interface["restful"]).toBeUndefined();
    expect(v.control_interface.ttrpc).toEqual({ path: "/tmp/y" });
  });

  it("导入含 restful 子段时丢弃、保留同级 ttrpc，且不报错", () => {
    const r = parse('{"control_interface":{"restful":{"host":"0.0.0.0","port":5},"ttrpc":{"path":"/tmp/x"}},"add_ingress":[]}');
    expect(r.error).toBeUndefined();
    expect(r.model!.control_interface_extra.ttrpc).toEqual({ path: "/tmp/x" });
    expect(r.model!.control_interface_extra["restful"]).toBeUndefined();
  });
});

describe("错误处理", () => {
  it("非法 JSON 返回 error", () => {
    expect(parse("{ not json }").error).toMatch(/解析失败/);
  });

  it("根非对象返回 error", () => {
    expect(parse("[]").error).toMatch(/根须为/);
  });
});
