// 配置模型的序列化/解析（客户端 ingress 锁定 OHTTP 形态）。
// - serialize：不输出 add_egress、不输出 control_interface.restful；每条 ingress 注入锁定 ohttp；
//   按 no_ra/verify 互斥产出（no_ra=true → "no_ra":true 且无 verify；no_ra=false → 固定默认 verify 且无 no_ra）；
//   tng 本地监听 host/port 不进用户序列化（in/proxy_listen 输出为空对象，由 tngui 启动时注入）；
//   反代对外绑定作 tngui 侧 `tngui_outward` 与 add_ingress 平级 sibling 输出（不进 tng 的 mapping.in）。
// - parse：丢弃 add_egress（warning）、丢弃 ingress 的 ohttp（用锁定值）、用 verify 存在与否判定 RA 开启但丢弃其字段值、
//   读/校验 `tngui_outward.port`（必填有效 TCP 端口）；仅认 mapping/http_proxy 两种 ingress。
// control_interface.restful 子段由 tngui 启动时注入（auto-manage-control-port），这里丢弃/不输出。
import {
  ALL_MODES,
  DEFAULT_LISTEN_PORT,
  DEFAULT_RVS_URL,
  DEFAULT_OUTWARD,
  DEFAULT_VERIFY,
  LOCKED_OHTTP,
  PORT_MAX,
  PORT_MIN,
  isValidPort,
  defaultModel,
  type ConfigModel,
  type EntryModel,
  type IngressMode,
  type OutwardBind,
} from "./formspec";

/** GUI 侧 RVS 字段名。用户态配置保留该字段便于模型往返；后端写 tng runtime 前统一剥离。 */
export const TNGUI_RVS_URL_FIELD = "tngui_rvs_url";

export function serialize(model: ConfigModel): string {
  const out: Record<string, unknown> = {};
  if (Object.keys(model.control_interface_extra).length > 0) {
    out.control_interface = { ...model.control_interface_extra };
  }
  out.add_ingress = [serializeEntry(model.ingress)];
  out[TNGUI_RVS_URL_FIELD] = model.rvsUrl || DEFAULT_RVS_URL;
  for (const [k, v] of Object.entries(model.extra)) out[k] = v;
  return JSON.stringify(out, null, 2);
}

function serializeEntry(e: EntryModel): Record<string, unknown> {
  const fields = serializeFields(e.mode, e.fields);
  const obj: Record<string, unknown> = { [e.mode]: fields };
  if (e.no_ra) {
    obj.no_ra = true;
  } else {
    obj.verify = { ...DEFAULT_VERIFY };
  }
  const ohttp = JSON.parse(JSON.stringify(LOCKED_OHTTP)) as Record<string, unknown>;
  // http_proxy：`ohttp.tls` 由域名框前缀派生——带 `https://` 前缀 → `tls: true`（tng 以
  // TLS 连上游，如 https://…:443）；带 `http://` 前缀或不带前缀 → 不写 `tls`
  // （保持 `ohttp: {header_passthrough: …}` 原形态，明文如内网 :30090 端口向后兼容）。
  if (e.mode === "http_proxy" && deriveHttpProxyTls(e)) {
    ohttp["tls"] = true;
  }
  obj.ohttp = ohttp;
  obj.tngui_outward = { host: e.outward.host, port: e.outward.port };
  for (const [k, v] of Object.entries(e.extra)) obj[k] = v;
  return obj;
}

/** mapping 锁定字段：剥除 tng 本地监听 host/port（输出 `in` 为空对象，由 tngui 启动注入），
 *  保留远端 `out`（host + port）。serialize 与 normalize 共用（两者 mapping 形状一致）。 */
function mappingFields(fields: Record<string, unknown>): Record<string, unknown> {
  const rules = Array.isArray(fields.rules) ? fields.rules : [];
  const first = rules.find((r) => r && typeof r === "object") as
    | { in?: Record<string, unknown>; out?: Record<string, unknown> }
    | undefined;
  const outEp = first?.out ?? {};
  // 不做默认回填：mapping out.port 必填；UI 清空时保留空值，启动前报错。
  return {
    rules: [
      {
        in: {},
        out: { host: strOr(outEp.host, ""), port: outEp.port ?? null },
      },
    ],
  };
}

/** 域名框文本的 scheme 前缀（大小写不敏感）：`https` / `http` / 无前缀 `null`。 */
function schemePrefix(domain: string): "https" | "http" | null {
  const m = /^https?:\/\//i.exec(domain);
  if (!m) return null;
  return m[0].toLowerCase().startsWith("https") ? "https" : "http";
}

/** http_proxy 的 `ohttp.tls` 值：域名框带 `https://` 前缀优先（→ true）、
 *  带 `http://` 前缀一律 false、无前缀回退到 `EntryModel.tls`
 *  （parse 从 `ohttp.tls` 回填）。mapping 不涉及。 */
function deriveHttpProxyTls(e: EntryModel): boolean {
  const d = (e.fields.dst_filters ?? {}) as Record<string, unknown>;
  const prefix = schemePrefix(strOr(d.domain, "").trim());
  if (prefix === "https") return true;
  if (prefix === "http") return false;
  return e.tls === true;
}

/** 序列化为 TNG 配置形状（内部模型 → 输出）：剥除 tng 本地监听 host/port（`in`/`proxy_listen`
 *  输出为空对象，由 tngui 启动注入）；http_proxy 的 `dst_filters` 输出为 tng 实际接受的数组
 *  `[{domain, port}]`——主机名仅含主机名（剥离 scheme 前缀）、端口走独立 `port` 字段，
 *  绝不把端口拼进 `domain`；目标端口留空（null/undefined）时省略 `port`，表示不限定。
 *  显式非法值原样保留，供启动前校验报错，绝不静默改写。 */
function serializeFields(mode: IngressMode, fields: Record<string, unknown>): Record<string, unknown> {
  if (mode === "mapping") return mappingFields(fields);
  const df = (fields.dst_filters ?? {}) as Record<string, unknown>;
  // 剥离域名框可写的 scheme 前缀——tng `dst_filters.domain` 只认主机名，前缀仅驱动 tls。
  const domain = strOr(df.domain, "").trim().replace(/^https?:\/\//i, "");
  const dst: Record<string, unknown> = { domain };
  const p = df.port;
  if (p !== undefined && p !== null && p !== "") dst.port = p;
  return { proxy_listen: {}, dst_filters: [dst] };
}

/** 解析为内部模型形状（输入 → 内部）：兼容 tng 数组形态 `dst_filters: [{domain, port}]` 与遗留
 *  对象形态 `{domain}`，统一回填为内部单一对象 `{domain, port}`（一条 dst，供 EntryEditor/
 *  FieldRenderer 绑定）。`proxy_listen` 输出为空对象（由 tngui 启动注入）。 */
function normalizeFields(mode: IngressMode, fields: Record<string, unknown>): Record<string, unknown> {
  if (mode === "mapping") return mappingFields(fields);
  const dfRaw = fields.dst_filters;
  let domain = "";
  // http_proxy 目标端口可选；JSON 中缺省或 UI 留空都表示不限定端口。
  let port: number | null = null;
  const readFrom = (d: Record<string, unknown>): void => {
    domain = strOr(d.domain, "").trim();
    const pp = d.port;
    port = isValidPort(pp) ? pp : null;
  };
  if (Array.isArray(dfRaw) && dfRaw.length > 0 && typeof dfRaw[0] === "object" && dfRaw[0] !== null) {
    readFrom(dfRaw[0] as Record<string, unknown>);
  } else if (dfRaw && typeof dfRaw === "object") {
    readFrom(dfRaw as Record<string, unknown>);
  }
  return { proxy_listen: {}, dst_filters: { domain, port } };
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

  let ingress: EntryModel | undefined;
  for (let i = 0; i < ingressArr.length; i++) {
    const r = parseEntry(ingressArr[i], `add_ingress[${i}]`);
    if (r.unsupported) {
      warnings.push(r.error!);
      continue;
    }
    if (r.error) return { error: r.error };
    if (ingress !== undefined) {
      warnings.push(`已丢弃 add_ingress[${i}]（仅支持一条 ingress）`);
      continue;
    }
    ingress = r.model!;
  }
  if (ingress === undefined) {
    ingress = defaultModel().ingress;
    warnings.push("无可识别的 ingress，已回退默认域名代理配置");
  }

  // GUI 侧全局 RVS 地址：从用户 JSON 取出，不落入顶层 extra；序列化时再写回用户态 JSON。
  const rvsUrl = strOr(root[TNGUI_RVS_URL_FIELD], DEFAULT_RVS_URL);

  // 顶层 extra
  const topExtra: Record<string, unknown> = { ...root };
  delete topExtra.control_interface;
  delete topExtra.add_ingress;
  delete topExtra.add_egress;
  delete topExtra[TNGUI_RVS_URL_FIELD];

  return {
    model: { control_interface_extra, ingress, rvsUrl, extra: topExtra },
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
  // http_proxy：域名前缀（`https://`/`http://`）与 `ohttp.tls` 派生前端内部 `tls`——
  // 带前缀以输入为准（https→true、http→false），无前缀回退 `ohttp.tls`；框内文本
  // 统一回填：保留用户敲入的前缀、或无前缀且 tls=true 时补 `https://` 前缀回显。
  // tng 的 `dst_filters.domain` 不含前缀（serialize 侧再剥离）。
  let tls: boolean | undefined;
  if (mode === "http_proxy") {
    const ohttpObj = (e.ohttp ?? {}) as Record<string, unknown>;
    const dfRaw = fieldsRaw.dst_filters;
    const readDom = (): string => {
      const first = Array.isArray(dfRaw) ? (dfRaw[0] as Record<string, unknown> | undefined) : (dfRaw as Record<string, unknown> | undefined);
      return first && typeof first === "object" ? strOr(first.domain, "") : "";
    };
    const raw = readDom().trim();
    const prefix = schemePrefix(raw);
    tls = prefix === "https" ? true : prefix === "http" ? false : ohttpObj["tls"] === true;
    const boxed = prefix !== null ? raw : tls ? `https://${raw}` : raw;
    const writeDom = (o: unknown): void => {
      if (o && typeof o === "object") (o as Record<string, unknown>).domain = boxed;
    };
    if (Array.isArray(dfRaw)) dfRaw.forEach(writeDom);
    else writeDom(dfRaw);
  }
  const portError = validateEntryPorts(mode, fieldsRaw, at);
  if (portError) return { error: portError };
  const fields = normalizeFields(mode, fieldsRaw);

  // `verify` object is the historical RA-on representation. It only determines that RA is
  // enabled; custom model/as_provider values are intentionally discarded. Serialization
  // always writes DEFAULT_VERIFY so no invisible state survives import/raw-JSON round trips.
  const raEnabled = typeof e.verify === "object" && e.verify !== null;
  const no_ra = raEnabled ? false : e.no_ra === true;

  // 反代对外绑定：tngui 侧 `tngui_outward`（端口必填有效；缺失不静默回退）
  const outwardResult = parseOutward(e.tngui_outward, at);
  if (outwardResult.error) return { error: outwardResult.error };
  const outward = outwardResult.outward!;

  const extra: Record<string, unknown> = { ...e };
  delete extra[mode];
  delete extra.no_ra;
  delete extra.verify;
  delete extra.ohttp;
  delete extra.tngui_outward;

  return { model: { mode, fields, no_ra, outward, tls, extra } };
}

/** 校验一条 ingress 中用户可编辑端口；只关注端口，不改变 host/结构语义。 */
function validateEntryPorts(mode: IngressMode, fields: Record<string, unknown>, at: string): string | undefined {
  if (mode === "mapping") {
    const m = fields;
    if (Array.isArray(m.rules)) {
      const rules = m.rules as unknown[];
      for (let j = 0; j < rules.length; j++) {
        const r = rules[j];
        if (!r || typeof r !== "object") continue;
        const out = (r as Record<string, unknown>).out;
        if (!out || typeof out !== "object") continue;
        const error = requiredPortError((out as Record<string, unknown>).port, `${at}.mapping.rules[${j}].out.port`);
        if (error) return error;
      }
    } else if (m.out && typeof m.out === "object") {
      const error = requiredPortError((m.out as Record<string, unknown>).port, `${at}.mapping.out.port`);
      if (error) return error;
    }
    return undefined;
  }
  const dfs = fields.dst_filters;
  const check = (d: unknown, j: number): string | undefined => {
    if (!d || typeof d !== "object") return undefined;
    return optionalPortError((d as Record<string, unknown>).port, `${at}.http_proxy.dst_filters[${j}].port`);
  };
  if (Array.isArray(dfs)) {
    for (let j = 0; j < (dfs as unknown[]).length; j++) {
      const error = check((dfs as unknown[])[j], j);
      if (error) return error;
    }
    return undefined;
  }
  return check(dfs, 0);
}

function requiredPortError(value: unknown, location: string): string | undefined {
  if (value === undefined) return `${location} 缺失（须为 ${PORT_MIN}~${PORT_MAX} 的整数端口）`;
  return portError(value, location);
}

function optionalPortError(value: unknown, location: string): string | undefined {
  if (value === undefined) return undefined;
  return portError(value, location);
}

function portError(value: unknown, location: string): string | undefined {
  if (isValidPort(value)) return undefined;
  return `${location} 须为 ${PORT_MIN}~${PORT_MAX} 的整数端口`;
}

/** 解析 `tngui_outward`：host 仅认 127.0.0.1/0.0.0.0，port 必须为 1~65535 整数；缺失/非法不静默回退。 */
function parseOutward(raw: unknown, at: string): { outward?: OutwardBind; error?: string } {
  const location = `${at}.tngui_outward.port`;
  if (!raw || typeof raw !== "object") return { error: `${location} 缺失（须为 ${PORT_MIN}~${PORT_MAX} 的整数端口）` };
  const o = raw as Record<string, unknown>;
  const host = o.host === "0.0.0.0" ? "0.0.0.0" : o.host === "127.0.0.1" ? "127.0.0.1" : DEFAULT_OUTWARD.host;
  if (!isValidPort(o.port)) return { error: `${location} 须为 ${PORT_MIN}~${PORT_MAX} 的整数端口` };
  return { outward: { host, port: o.port } };
}
function strOr(v: unknown, def: string): string {
  return typeof v === "string" ? v : def;
}
