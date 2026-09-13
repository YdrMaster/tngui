// 配置模型的序列化/解析（客户端 ingress 锁定 OHTTP 形态）。
// - serialize：不输出 add_egress、不输出 control_interface.restful；每条 ingress 注入锁定 ohttp；
//   按 no_ra/verify 互斥产出（no_ra=true → "no_ra":true 且无 verify；no_ra=false → verify 且无 no_ra）；
//   本地监听 host 强制 127.0.0.1。
// - parse：丢弃 add_egress（warning）、丢弃 ingress 的 ohttp（用锁定值）、读 verify 回填；
//   仅认 mapping/http_proxy 两种 ingress，其余被丢弃并以 warning 提示。
// control_interface.restful 子段由 tngui 启动时注入（auto-manage-control-port），这里丢弃/不输出。
import {
  ALL_MODES,
  DEFAULT_LISTEN_PORT,
  DEFAULT_OUT_PORT,
  DEFAULT_VERIFY,
  LOCALHOST,
  LOCKED_OHTTP,
  type ConfigModel,
  type EntryModel,
  type IngressMode,
  type VerifyConfig,
} from "./formspec";

export function serialize(model: ConfigModel): string {
  const out: Record<string, unknown> = {};
  if (Object.keys(model.control_interface_extra).length > 0) {
    out.control_interface = { ...model.control_interface_extra };
  }
  out.add_ingress = model.add_ingress.map(serializeEntry);
  for (const [k, v] of Object.entries(model.extra)) out[k] = v;
  return JSON.stringify(out, null, 2);
}

function serializeEntry(e: EntryModel): Record<string, unknown> {
  const fields = sanitizeFields(e.mode, e.fields);
  const obj: Record<string, unknown> = { [e.mode]: fields };
  if (e.no_ra) {
    obj.no_ra = true;
  } else {
    obj.verify = e.verify ? { ...e.verify } : { ...DEFAULT_VERIFY };
  }
  obj.ohttp = JSON.parse(JSON.stringify(LOCKED_OHTTP));
  for (const [k, v] of Object.entries(e.extra)) obj[k] = v;
  return obj;
}

/** 规整为锁定形态并强制本地监听 host=127.0.0.1（serialize 侧兜底，与后端 prepare_config 同向）。 */
function sanitizeFields(mode: IngressMode, fields: Record<string, unknown>): Record<string, unknown> {
  if (mode === "mapping") {
    const rules = Array.isArray(fields.rules) ? fields.rules : [];
    const first = rules.find((r) => r && typeof r === "object") as
      | { in?: Record<string, unknown>; out?: Record<string, unknown> }
      | undefined;
    const inEp = first?.in ?? {};
    const outEp = first?.out ?? {};
    return {
      rules: [
        {
          in: { host: LOCALHOST, port: numOr(inEp.port, DEFAULT_LISTEN_PORT) },
          out: { host: strOr(outEp.host, ""), port: numOr(outEp.port, DEFAULT_OUT_PORT) },
        },
      ],
    };
  }
  const pl = (fields.proxy_listen ?? {}) as Record<string, unknown>;
  const df = (fields.dst_filters ?? {}) as Record<string, unknown>;
  return {
    proxy_listen: { host: LOCALHOST, port: numOr(pl.port, DEFAULT_LISTEN_PORT) },
    dst_filters: { domain: strOr(df.domain, "") },
  };
}

export interface ParseResult {
  model?: ConfigModel;
  error?: string;
  warnings?: string[];
}

/** JSON → model。未知根字段进 extra；control_interface.restful 与 add_egress 被丢弃；ingress 仅认 mapping/http_proxy。 */
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

  // control_interface：丢弃 restful，其余同级（ttrpc 等）进 extra
  const ciRaw = (root.control_interface ?? {}) as Record<string, unknown>;
  const control_interface_extra: Record<string, unknown> = { ...ciRaw };
  delete control_interface_extra["restful"];

  // add_ingress / add_egress
  if (root.add_ingress !== undefined && !Array.isArray(root.add_ingress)) {
    return { error: "add_ingress 须为数组" };
  }
  const ingressArr = Array.isArray(root.add_ingress) ? root.add_ingress : [];

  const warnings: string[] = [];
  if (root.add_egress !== undefined) {
    if (!Array.isArray(root.add_egress)) return { error: "add_egress 须为数组" };
    warnings.push("已丢弃 add_egress（客户端不承载 egress）");
  }

  const entries: EntryModel[] = [];
  for (let i = 0; i < ingressArr.length; i++) {
    const r = parseEntry(ingressArr[i], `add_ingress[${i}]`);
    if (r.unsupported) {
      warnings.push(r.error!);
      continue;
    }
    if (r.error) return { error: r.error };
    entries.push(r.model!);
  }

  // 顶层 extra
  const topExtra: Record<string, unknown> = { ...root };
  delete topExtra.control_interface;
  delete topExtra.add_ingress;
  delete topExtra.add_egress;

  return {
    model: { control_interface_extra, add_ingress: entries, extra: topExtra },
    warnings: warnings.length ? warnings : undefined,
  };
}

function parseEntry(
  raw: unknown,
  at: string,
): { model?: EntryModel; error?: string; unsupported?: boolean } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: `${at} 须为对象` };
  }
  const e = raw as Record<string, unknown>;

  const mode = ALL_MODES.find((m) => typeof e[m] === "object" && e[m] !== null);
  if (!mode) {
    return { error: `${at} 仅支持 mapping/http_proxy 两种客户端 ingress 形态，已忽略`, unsupported: true };
  }

  const fieldsRaw = (e[mode] ?? {}) as Record<string, unknown>;
  const fields = sanitizeFields(mode, fieldsRaw);

  let no_ra: boolean;
  let verify: VerifyConfig | undefined;
  if (typeof e.verify === "object" && e.verify !== null) {
    const vs = e.verify as Record<string, unknown>;
    no_ra = false;
    verify = { model: strOr(vs.model, DEFAULT_VERIFY.model), as_provider: strOr(vs.as_provider, DEFAULT_VERIFY.as_provider) };
  } else {
    no_ra = e.no_ra === true;
    verify = undefined;
  }

  const extra: Record<string, unknown> = { ...e };
  delete extra[mode];
  delete extra.no_ra;
  delete extra.verify;
  delete extra.ohttp;

  return { model: { mode, fields, no_ra, verify, extra } };
}

function numOr(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}
function strOr(v: unknown, def: string): string {
  return typeof v === "string" ? v : def;
}
