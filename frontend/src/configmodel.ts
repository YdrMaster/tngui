// 配置模型的序列化/解析。extra 容器保证未结构化字段（RA attest/verify 等）往返不丢。
import { ALL_MODES, LOCALHOST, type ConfigModel, type EntryModel } from "./formspec";

/** model → TNG JSON（外挂 tag、no_ra 平铺、host 强制 127.0.0.1、extra 原样回填）。 */
export function serialize(model: ConfigModel): string {
  const out: Record<string, unknown> = {};

  // control_interface（host 强制 127.0.0.1）
  const ci: Record<string, unknown> = {
    restful: { host: LOCALHOST, port: model.control_interface.restful.port },
    ...model.control_interface.extra,
  };
  out.control_interface = ci;

  out.add_ingress = model.add_ingress.map(serializeEntry);
  out.add_egress = model.add_egress.map(serializeEntry);

  // 顶层未知字段（metric/trace/admin_bind 等）
  for (const [k, v] of Object.entries(model.extra)) out[k] = v;

  return JSON.stringify(out, null, 2);
}

function serializeEntry(e: EntryModel): Record<string, unknown> {
  const obj: Record<string, unknown> = { [e.mode]: e.fields, no_ra: e.no_ra };
  for (const [k, v] of Object.entries(e.extra)) obj[k] = v;
  return obj;
}

export interface ParseResult {
  model?: ConfigModel;
  error?: string;
}

/** JSON → model。未知字段进 extra；非法 JSON/缺 port 返回 error。 */
export function parse(json: string): ParseResult {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch (e) {
    return { error: `JSON 解析失败: ${(e as Error).message}` };
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { error: "配置根须为 JSON 对象" };
  }
  const root = v as Record<string, unknown>;

  // control_interface
  const ciRaw = (root.control_interface ?? {}) as Record<string, unknown>;
  const restfulRaw = (ciRaw.restful ?? {}) as Record<string, unknown>;
  const port = restfulRaw.port;
  if (typeof port !== "number" || !Number.isFinite(port)) {
    return { error: "配置缺少 control_interface.restful.port（数值）" };
  }
  const ciExtra: Record<string, unknown> = { ...ciRaw };
  delete ciExtra.restful;

  // ingress/egress
  const ingressArr = Array.isArray(root.add_ingress) ? root.add_ingress : [];
  const egressArr = Array.isArray(root.add_egress) ? root.add_egress : [];
  if (!Array.isArray(root.add_ingress) && root.add_ingress !== undefined) {
    return { error: "add_ingress 须为数组" };
  }
  if (!Array.isArray(root.add_egress) && root.add_egress !== undefined) {
    return { error: "add_egress 须为数组" };
  }

  const ingress = ingressArr.map((e, i) => parseEntry(e, `add_ingress[${i}]`));
  for (const r of ingress) if (r.error) return { error: r.error };
  const egress = egressArr.map((e, i) => parseEntry(e, `add_egress[${i}]`));
  for (const r of egress) if (r.error) return { error: r.error };

  // 顶层 extra
  const topExtra: Record<string, unknown> = { ...root };
  delete topExtra.control_interface;
  delete topExtra.add_ingress;
  delete topExtra.add_egress;

  return {
    model: {
      control_interface: {
        restful: { host: LOCALHOST, port },
        extra: ciExtra,
      },
      add_ingress: ingress.map((r) => r.model!) as EntryModel[],
      add_egress: egress.map((r) => r.model!) as EntryModel[],
      extra: topExtra,
    },
  };
}

function parseEntry(raw: unknown, at: string): { model?: EntryModel; error?: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: `${at} 须为对象` };
  }
  const e = raw as Record<string, unknown>;
  // 找外挂 tag 模式键
  const mode = ALL_MODES.find((m) => e[m] !== undefined) ?? "mapping";
  const fields = (e[mode] ?? {}) as Record<string, unknown>;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return { error: `${at}.${mode} 须为对象` };
  }
  const no_ra = typeof e.no_ra === "boolean" ? e.no_ra : false;
  const extra: Record<string, unknown> = { ...e };
  delete extra[mode];
  delete extra.no_ra;
  return { model: { mode, fields: { ...fields }, no_ra, extra } };
}