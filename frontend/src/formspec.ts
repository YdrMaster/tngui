// form-spec：结构化配置字段模型——客户端 ingress 锁定 OHTTP 形态。
// 客户端侧只配 add_ingress（mapping 地址端口 / http_proxy 域名两种远端形态），不承载 add_egress。
// ohttp 常开、path_rewrites 与 credential header_passthrough 写死；
// no_ra/verify 互斥序列化（见 configmodel.ts）。
// 据真实 cmaas-deploy 客户端配置（publish/docs/03-使用.md §2），不链接 tng 代码。

/** 回环地址：ingress 本地监听 host 由前后端共同强制为回环（与 control_interface.restful 同法）。 */
export const LOCALHOST = "127.0.0.1";

export type IngressMode = "mapping" | "http_proxy";
export const INGRESS_MODES: IngressMode[] = ["mapping", "http_proxy"];
/** parse 识别的 ingress 模式 tag（其余 tag 视为不支持，见 configmodel.parseEntry）。 */
export const ALL_MODES: IngressMode[] = ["mapping", "http_proxy"];

/** 反代对外绑定默认端口（亦作隐藏内部监听占位，启动时由批探测覆盖）。 */
export const DEFAULT_LISTEN_PORT = 9443;
/** mapping 内置默认远端目标端口。 */
export const DEFAULT_MAPPING_OUT_PORT = 80;
/** http_proxy 内置默认远端目标端口。 */
export const DEFAULT_HTTP_PROXY_DST_PORT = 443;

/** 客户端走 OHTTP 时透传的 credential 请求头——写死，用户不可改。 */
export const HEADER_PASSTHROUGH = ["authorization", "x-api-key"] as const;
/** capi path 模型鉴权契约要求的固定 TNG outer path rewrite。 */
export const OHTTP_PATH_REWRITES = [
  {
    match_regex: "^/models/([^/]+)(?:/.*)?$",
    substitution: "/models/$1",
  },
] as const;
/** 注入到每条 ingress 序列化结果的锁定 ohttp 子配置。 */
export const LOCKED_OHTTP = {
  path_rewrites: [{ ...OHTTP_PATH_REWRITES[0] }],
  header_passthrough: { request_headers: [...HEADER_PASSTHROUGH] },
};

export interface VerifyConfig {
  model: string;
  as_provider: string;
}
/** verify 默认值（no_ra=false 时用）。 */
export const DEFAULT_VERIFY: VerifyConfig = { model: "passport", as_provider: "tpm" };
/** 反代对外绑定（D1：host 在 127.0.0.1/0.0.0.0 间 toggle；port 为用户可配的「本机端口」）。
 * tngui 侧字段——不进 tng `add_ingress[].mapping.rules[].in`（tng 本地监听由 tngui 启动时注入）。
 */
export interface OutwardBind {
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
}
/** 反代对外绑定默认值（仅本机回环 + 内置默认端口）。 */
export const DEFAULT_OUTWARD: OutwardBind = { host: "127.0.0.1", port: DEFAULT_LISTEN_PORT };

// —— 嵌套形状（serialize/parse 用，extra 字段仍可经 entry extra 容器往返） ——
export interface RuleEndpoint {
  host: string;
  port: number;
}
export interface MappingRule {
  in: RuleEndpoint;
  out: RuleEndpoint;
}
export interface ProxyListen {
  host: string;
  port: number;
}
export interface DstFilters {
  domain: string;
  port: number;
}

/** 一条 ingress 条目的模型。fields 为各模式的嵌套字段；verify 仅在 no_ra=false 时有效；
 * `outward` 为 tngui 反代对外绑定（tngui 侧、不进 tng 配置）；
 * `tls` 仅 http_proxy 使用——由域名框的 `https://` 前缀派生
 * （`http://`/无前缀均 false）；serialize 时据此决定是否在 `ohttp` 注入 `tls: true`。 */
export interface EntryModel {
  mode: IngressMode;
  fields: Record<string, unknown>;
  no_ra: boolean;
  verify?: VerifyConfig;
  outward: OutwardBind;
  tls?: boolean;
  extra: Record<string, unknown>;
}

/** 配置模型。control_interface 仅留同级 extra（ttrpc 等），restful 子段由 tngui 启动时注入（auto-manage-control-port）。 */
export interface ConfigModel {
  control_interface_extra: Record<string, unknown>;
  add_ingress: EntryModel[];
  extra: Record<string, unknown>;
}

// —— form-spec：驱动 EntryEditor/FieldRenderer 渲染 ——
export type FieldType = "listenHostPort" | "outHostPort" | "domainHostPort" | "verifyFields";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
}

export const INGRESS_FIELDS: Record<IngressMode, FieldSpec[]> = {
  mapping: [
    { key: "listen", label: "本地监听（host 锁定 127.0.0.1）", type: "listenHostPort", required: true },
    { key: "remote", label: "远端地址端口（out：IP + 端口）", type: "outHostPort", required: true },
  ],
  http_proxy: [
    { key: "listen", label: "本地监听（host 锁定 127.0.0.1）", type: "listenHostPort", required: true },
    { key: "remote", label: "远端域名端口（可用 http:// 或 https:// 前缀，前缀决定 TLS）", type: "domainHostPort", required: true },
  ],
};

/** 某 mode 的默认嵌套字段（深拷贝，避免共享引用）。 */
export function defaultFields(mode: string): Record<string, unknown> {
  if (mode === "mapping") {
    return {
      rules: [
        { in: { host: LOCALHOST, port: DEFAULT_LISTEN_PORT }, out: { host: "", port: DEFAULT_MAPPING_OUT_PORT } },
      ],
    };
  }
  if (mode === "http_proxy") {
    return {
      proxy_listen: { host: LOCALHOST, port: DEFAULT_LISTEN_PORT },
      dst_filters: { domain: "https://", port: DEFAULT_HTTP_PROXY_DST_PORT },
    };
  }
  return {};
}

/** 内置默认开局模板：一条锁定形态的 OHTTP mapping ingress（no_ra=false → verify on，默认 passport/tpm）。
 * 不含 add_egress、不含 control_interface.restful（restful 由 tngui 拉起 tng 时注入）。 */
export function defaultModel(): ConfigModel {
  return {
    control_interface_extra: {},
    add_ingress: [
      {
        mode: "mapping",
        fields: defaultFields("mapping"),
        no_ra: false,
        verify: { ...DEFAULT_VERIFY },
        outward: { ...DEFAULT_OUTWARD },
        extra: {},
      },
    ],
    extra: {},
  };
}


/**
 * 远端是否已配置到"tng 可加载且具备出向目标"。与后端
 * `config::validate_ingress_for_launch` 精确对齐（同一判定语义），用于在 UI 侧提前禁用
 * 启动、避免事后弹窗：
 * - `mapping`：每条 `rules[*].out.host` 经首尾空格 trim 后须为合法 IPv4（与 tng
 *   `mapping_rule::RuleEndpoint.host: Option<Ipv4Addr>` 一致——恰好 4 段、每段
 *   0-255、**拒绝前导零**）；`rules` 为空数组视为"不拦"（与后端一致）。
 * - `http_proxy`：`dst_filters.domain` 即便为空，tng 仍加载（仅匹配不到远端），与后端
 *   一致——不因此禁用启动。
 * 缺省模板（out.host 留空）→ false，故启动按钮禁用并引导用户去设置填网关 IPv4。
 */
export function isRemoteConfigured(model: ConfigModel): boolean {
  for (const e of model.add_ingress) {
    if (e.mode !== "mapping") continue;
    const raw = e.fields["rules"];
    const rules = (Array.isArray(raw) ? raw : []) as Array<{ out?: { host?: string } }>;
    if (rules.length === 0) continue;
    for (const r of rules) {
      const h = (r?.out?.host ?? "").trim();
      if (!h || !isValidIpv4(h)) return false;
    }
  }
  return true;
}

/** 与 `std::net::Ipv4Addr::from_str`（后端 `out.host.parse::<Ipv4Addr>()`）行为一致：
 * 恰好 4 段、每段 0-255、**拒绝前导零**（单段 "0" 允许、"01"/"010" 不允许）。入参须已 trim。 */
function isValidIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return false;
    if (p.length > 1 && p.charCodeAt(0) === 48 /* '0' */) return false;
    if (Number(p) > 255) return false;
  }
  return true;
}
