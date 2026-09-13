// form-spec：手写的结构化配置字段模型（据 TNG 源码；不链接 tng）。
// 覆盖常用路径：control port、ingress/egress 各模式字段、no_ra。
// 未覆盖（RA attest/verify、ohttp 高级、metric/trace 等）→ 原始 JSON 视图，经 extra 容器往返不丢。

/** 回环地址：控制面 host 由 GUI 强制（契约 B 安全）。 */
export const LOCALHOST = "127.0.0.1";

export type IngressMode = "mapping" | "http_proxy" | "socks5" | "netfilter" | "hook";
export type EgressMode = "mapping" | "netfilter" | "hook";

export const INGRESS_MODES: IngressMode[] = ["mapping", "http_proxy", "socks5", "netfilter", "hook"];
export const EGRESS_MODES: EgressMode[] = ["mapping", "netfilter", "hook"];

/** 已知所有模式（含 feature 门控的 mapping_udp，仅在 parse 时识别以保往返）。 */
export const ALL_MODES = [...INGRESS_MODES, "mapping_udp"];

// —— 复合字段类型 ——
export interface Endpoint {
  host?: string;
  port: number;
}
export interface RuleEndpoint {
  host?: string;
  port: number;
  port_end?: number;
}
export interface MappingRule {
  in: RuleEndpoint;
  out: RuleEndpoint;
}
/** dst_filter：host 匹配（domain/ip/cidr/正则/all 的字符串形式）+ 可选端口范围。 */
export interface DstFilter {
  host?: string;
  port?: number;
  port_end?: number;
}
/** netfilter/hook capture_dst：host(cidr) 或 ipset（互斥）+ 可选端口范围。 */
export interface CaptureDst {
  host?: string;
  ipset?: string;
  port?: number;
  port_end?: number;
}
/** egress hook intercept 条目。 */
export interface HookIntercept {
  host?: string;
  ifname?: string;
  port?: number;
  port_end?: number;
  redirect_to_port?: number;
  redirect_to_port_end?: number;
}

/** 一条 ingress/egress 条目的模型。extra 容纳未结构化字段（RA 等）。 */
export interface EntryModel {
  mode: string;
  fields: Record<string, unknown>;
  no_ra: boolean;
  extra: Record<string, unknown>;
}

/** 配置模型。control_interface 的 restful 子段（管控面 host+port）由 tngui 在拉起 tng 时注入，
 * 不向用户暴露、不在此承载；仅保留 control_interface 的同级字段（如 ttrpc）以维持未结构化字段往返。 */
export interface ConfigModel {
  control_interface_extra: Record<string, unknown>; // control_interface 同级：ttrpc 等
  add_ingress: EntryModel[];
  add_egress: EntryModel[];
  extra: Record<string, unknown>; // 顶层：metric/trace/admin_bind 等
}

// —— form-spec：每模式的字段声明，驱动 Vue 表单渲染 ——
export type FieldType =
  | "number"
  | "text"
  | "bool"
  | "endpoint"
  | "stringList"
  | "ruleList"
  | "filterList"
  | "captureList"
  | "interceptList";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** 默认值（用于新增条目/切模式重置）。 */
  default?: unknown;
}

export const INGRESS_FIELDS: Record<IngressMode, FieldSpec[]> = {
  mapping: [
    { key: "rules", label: "端口映射规则", type: "ruleList", required: true, default: [{ in: { port: 10001 }, out: { host: LOCALHOST, port: 30001 } }] },
  ],
  http_proxy: [
    { key: "proxy_listen", label: "监听地址", type: "endpoint", required: true, default: { host: LOCALHOST, port: 0 } },
    { key: "dst_filters", label: "目标过滤", type: "filterList", default: [] },
  ],
  socks5: [
    { key: "proxy_listen", label: "监听地址", type: "endpoint", required: true, default: { host: LOCALHOST, port: 0 } },
    { key: "dst_filters", label: "目标过滤", type: "filterList", default: [] },
  ],
  netfilter: [
    { key: "capture_dst", label: "捕获目标", type: "captureList", required: true, default: [] },
    { key: "capture_cgroup", label: "捕获 cgroup", type: "stringList", default: [] },
    { key: "nocapture_cgroup", label: "排除 cgroup", type: "stringList", default: [] },
    { key: "listen_port", label: "监听端口", type: "number" },
    { key: "so_mark", label: "SO_MARK", type: "number" },
  ],
  hook: [
    { key: "capture_dst", label: "捕获目标", type: "captureList", required: true, default: [] },
    { key: "proxy_port", label: "代理端口", type: "number" },
    { key: "proxy_listen", label: "代理监听 host", type: "text" },
    { key: "capture_local_traffic", label: "捕获本地流量", type: "bool", default: false },
  ],
};

export const EGRESS_FIELDS: Record<EgressMode, FieldSpec[]> = {
  mapping: [
    { key: "rules", label: "端口映射规则", type: "ruleList", required: true, default: [{ in: { port: 10001 }, out: { host: LOCALHOST, port: 30001 } }] },
  ],
  netfilter: [
    { key: "capture_dst", label: "捕获目标", type: "captureList", required: true, default: [] },
    { key: "capture_local_traffic", label: "捕获本地流量", type: "bool", default: false },
    { key: "capture_cgroup", label: "捕获 cgroup", type: "stringList", default: [] },
    { key: "nocapture_cgroup", label: "排除 cgroup", type: "stringList", default: [] },
    { key: "listen_port", label: "监听端口", type: "number" },
    { key: "so_mark", label: "SO_MARK", type: "number" },
  ],
  hook: [
    { key: "capture_listen", label: "拦截目标", type: "interceptList", required: true, default: [] },
    { key: "capture_local_traffic", label: "捕获本地流量", type: "bool", default: false },
  ],
};

/** 某模式的字段默认值集合（深拷贝，避免共享引用）。 */
export function defaultFields(mode: string): Record<string, unknown> {
  const specs: FieldSpec[] | undefined =
    mode in INGRESS_FIELDS
      ? INGRESS_FIELDS[mode as IngressMode]
      : mode in EGRESS_FIELDS
        ? EGRESS_FIELDS[mode as EgressMode]
        : undefined;
  const out: Record<string, unknown> = {};
  if (!specs) return out;
  for (const s of specs) {
    out[s.key] = s.default === undefined ? undefined : structuredClone(s.default);
  }
  return out;
}

/** 内置默认开局模板：一条 no_ra mapping ingress 示例。control_interface 的 restful 子段由 tngui
 * 在拉起 tng 时注入，不在模板中。 */
export function defaultModel(): ConfigModel {
  return {
    control_interface_extra: {},
    add_ingress: [
      {
        mode: "mapping",
        fields: defaultFields("mapping"),
        no_ra: true,
        extra: {},
      },
    ],
    add_egress: [],
    extra: {},
  };
}