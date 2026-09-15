//! 配置契约：解析用户提供的 TNG JSON 并做安全收口，写盘前供启动流程使用。
//!
//! 安全收口（设计稿 D2 + 变更 auto-manage-control-port）：
//! - `control_interface.restful` 由 tngui 自有：host 强制 `127.0.0.1`、port 由 tngui 在
//!   启动时自动选取空闲回环端口注入，覆写用户的任何输入；前端/用户配置不再携带它。
//! - 用户其余字段（`control_interface` 同级如 `ttrpc`、顶层 `extra`、ingress/egress）原样保留。

use serde_json::Value;
use std::fmt;
use std::io;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

/// 回环地址。控制面强制绑定于此，避免无鉴权接口暴露到外部网卡。
const LOCALHOST: &str = "127.0.0.1";

/// 反代对外绑定端口的默认值（前端 `formspec.DEFAULT_LISTEN_PORT` 的后端镜像；仅当用户配置
/// 不含 `tngui_outward.port` 时回退——正常路径前端总会显式写入）。
const DEFAULT_OUTWARD_PORT: u16 = 9443;

/// 管控面由 tngui 自管、端口不对用户暴露：端口由 `pick_free_ports` 批取（绑定
/// `127.0.0.1:0` 占住再放）后交给启动流程注入传给 tng 的配置。该端口随后由 `PortCell`
/// 持有供控制面轮询。单端口取号 `pick_free_port` 退化为批取 1 个，保留以兼容既有调用点。
pub fn pick_free_port() -> io::Result<u16> {
    Ok(pick_free_ports(1)?[0])
}

/// 批取 n 个回环端口：顺序 `bind` n 个 `127.0.0.1:0` listener 并同时持住、收齐端口后
/// 统一 `drop` 整批释放。因 n 个 listener 同时持在、OS 不会把同一端口分配给两个在用
/// listener，返回的 n 个端口必然两两互不相同——从根上消除单点"取号即放"的取号重复。
pub fn pick_free_ports(n: usize) -> io::Result<Vec<u16>> {
    let mut listeners = Vec::with_capacity(n);
    let mut ports = Vec::with_capacity(n);
    for _ in 0..n {
        let l = TcpListener::bind(("127.0.0.1", 0))?;
        ports.push(l.local_addr()?.port());
        listeners.push(l);
    }
    drop(listeners); // 整批释放
    Ok(ports)
}

#[derive(Debug)]
pub enum PrepareError {
    /// JSON 解析失败（serde 层）。
    InvalidJson(serde_json::Error),
    /// 配置根不是 JSON 对象。
    RootNotObject,
    /// ingress 配置 tng 必然在加载期拒绝（如 mapping 的 out.host 缺失/非 IPv4），
    /// 在拉起 tng 前拦截，避免 tng 加载即崩、控制面永不绑定、状态卡恒"关停"。
    IngressInvalid(String),
}

impl fmt::Display for PrepareError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PrepareError::InvalidJson(e) => write!(f, "JSON 解析失败: {e}"),
            PrepareError::RootNotObject => write!(f, "配置根须为 JSON 对象"),
            PrepareError::IngressInvalid(msg) => write!(f, "ingress 配置不可启动: {msg}"),
        }
    }
}

impl std::error::Error for PrepareError {}

/// 校验用户侧配置：仅 JSON 解析 + 根对象校验。不要求、不校验
/// `control_interface.restful`——管控面由 tngui 在启动时注入（见 `prepare_config`）。
/// 供 `save_config` 持久化"不含 restful"的用户侧配置。
pub fn validate_user_config(user_json: &str) -> Result<Value, PrepareError> {
    let v: Value = serde_json::from_str(user_json).map_err(PrepareError::InvalidJson)?;
    if !v.is_object() {
        return Err(PrepareError::RootNotObject);
    }
    Ok(v)
}

/// 在 `validate_user_config` 基础上注入/覆盖
/// `control_interface.restful = { "host": "127.0.0.1", "port": control_port }`，
/// 每条 ingress 的本地监听 `host=127.0.0.1`+`port=自动空闲端口`（覆盖用户），并剥离
/// tngui 侧"反代对外绑定"字段（不进 tng 配置）。仅返回 tng 绑定的配置（路由被丢弃）。
pub fn prepare_config(user_json: &str, control_port: u16) -> Result<Value, PrepareError> {
    // 测试/诊断便利入口：自行批取各 ingress 内部端口（启动路径 `launch_tng` 经
    // `pick_launch_ports` 批探测并先验避让对外端口，不走此处的简单批取）。
    let n = ingress_count(user_json)?;
    let internal = pick_free_ports(n)
        .map_err(|e| PrepareError::IngressInvalid(format!("无法分配内部端口: {e}")))?;
    prepare_launch(user_json, control_port, &internal).map(|(v, _)| v)
}

/// 用户配置中 `add_ingress` 的条数（缺失或非数组视为 0）。
fn ingress_count(user_json: &str) -> Result<usize, PrepareError> {
    let v = validate_user_config(user_json)?;
    Ok(v.get("add_ingress")
        .and_then(|a| a.as_array())
        .map(|a| a.len())
        .unwrap_or(0))
}

/// 同 `prepare_config`，但额外返回每条 ingress 的反代路由（带内部端口）供 `launch_tng`
/// 启动反代。tng 绑定的配置不再含反代对外绑定字段；ingress 本地监听为注入的内部端口。
pub fn prepare_launch(
    user_json: &str,
    control_port: u16,
    internal_ports: &[u16],
) -> Result<(Value, Vec<crate::proxy::ProxyRoute>), PrepareError> {
    let mut v = validate_user_config(user_json)?;
    let root = v
        .as_object_mut()
        .expect("validate_user_config 保证根为对象");

    // control_interface.restful 注入
    let ci = root
        .entry("control_interface")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !ci.is_object() {
        *ci = Value::Object(serde_json::Map::new());
    }
    let ci_obj = ci.as_object_mut().expect("control_interface 现为对象");
    let restful = ci_obj
        .entry("restful")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !restful.is_object() {
        *restful = Value::Object(serde_json::Map::new());
    }
    let restful_obj = restful.as_object_mut().expect("restful 现为对象");
    restful_obj.insert("host".to_string(), Value::String(LOCALHOST.to_string()));
    restful_obj.insert("port".to_string(), Value::from(control_port));

    // 客户端不承载 egress（见变更 lock-ingress-ohttp-drop-egress）：丢弃 add_egress。
    root.remove("add_egress");

    // 每条 ingress：读反代对外绑定、注入调用方批探测供给的内部端口 + host=127.0.0.1
    // （覆盖用户）、剥离 tngui_outward（不进 tng 配置），并产出反代路由（带内部端口）。
    let mut routes = Vec::new();
    if let Some(add_ingress) = root.get_mut("add_ingress").and_then(Value::as_array_mut) {
        for (i, entry) in add_ingress.iter_mut().enumerate() {
            let internal_port = internal_ports.get(i).copied().ok_or_else(|| {
                PrepareError::IngressInvalid(format!(
                    "内部端口数（{}）少于 ingress 条数",
                    internal_ports.len()
                ))
            })?;
            routes.push(prepare_ingress_entry(entry, internal_port)?);
        }
    }

    // 拦截 tng 加载期必然拒绝的 ingress（mapping 的 out.host 须为有效 IPv4）：默认模板
    // out.host 留空（用户须填网关 IP），不拦则 tng 启动后加载配置即崩——控制面永不绑定，
    // 状态卡恒"关停"、用户仅能在日志里看到 cryptic 的反序列化错误。
    validate_ingress_for_launch(root)?;

    Ok((v, routes))
}

/// 处理一条 ingress 的反代对外绑定与内部本地监听注入：
/// - 读 `tngui_outward`（缺失用默认 `127.0.0.1` + `DEFAULT_OUTWARD_PORT`），校验 host 仅
///   为 `127.0.0.1`/`0.0.0.0`；
/// - 选空闲回环端口作为 tng 内部 ingress 本地监听端口，注入 `in.host=127.0.0.1`+
///   `in.port=自动端口`（覆盖用户任何 host/port）、`http_proxy` 的 `proxy_listen` 同理；
/// - 剥离 `tngui_outward`（不进 tng 配置）。
/// 返回反代路由（对外绑定 + 内部端口）。
fn prepare_ingress_entry(
    entry: &mut Value,
    internal_port: u16,
) -> Result<crate::proxy::ProxyRoute, PrepareError> {
    let (out_host, out_port) = read_outward(entry);
    if out_host != crate::proxy::BIND_LOCALHOST && out_host != crate::proxy::BIND_ANY {
        return Err(PrepareError::IngressInvalid(format!(
            "反代对外绑定 host 仅支持 127.0.0.1/0.0.0.0，得到 {out_host:?}"
        )));
    }

    // 剥离 tngui 侧"反代对外绑定"——不进 tng 配置。
    if let Some(o) = entry.as_object_mut() {
        o.remove("tngui_outward");
    }

    // 注入内部本地监听 host（127.0.0.1）+ port（由调用方批探测供给，覆盖用户）。
    inject_ingress_listen(entry, internal_port);

    // 远端目标 host（转发 tng 时作 Host 头，避开 recursion 检测）。
    let remote_host = read_remote_host(entry);

    Ok(crate::proxy::ProxyRoute {
        out_host: out_host.to_string(),
        out_port,
        internal_port,
        remote_host,
    })
}

/// 读 ingress 的反代对外绑定 `(host, port)`；`tngui_outward` 缺失时用默认值。
fn read_outward(entry: &Value) -> (String, u16) {
    let o = entry.get("tngui_outward").and_then(Value::as_object);
    let host = o
        .and_then(|x| x.get("host"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| crate::proxy::BIND_LOCALHOST.to_string());
    let port = o
        .and_then(|x| x.get("port"))
        .and_then(Value::as_u64)
        .map(|n| n as u16)
        .unwrap_or(DEFAULT_OUTWARD_PORT);
    (host, port)
}

/// 注入 ingress 的内部本地监听 `host=127.0.0.1` + `port`（覆盖用户任何 host/port）：
/// `mapping` 的 `rules[*].in` 与 legacy `mapping.in`、`http_proxy` 的 `proxy_listen`。
fn inject_ingress_listen(entry: &mut Value, port: u16) {
    let Some(obj) = entry.as_object_mut() else {
        return;
    };
    if let Some(m) = obj.get_mut("mapping").and_then(Value::as_object_mut) {
        if let Some(rules) = m.get_mut("rules").and_then(Value::as_array_mut) {
            for r in rules.iter_mut() {
                if let Some(in_ep) = r.get_mut("in").and_then(Value::as_object_mut) {
                    in_ep.insert("host".to_string(), Value::String(LOCALHOST.to_string()));
                    in_ep.insert("port".to_string(), Value::from(port));
                }
            }
        } else if let Some(in_ep) = m.get_mut("in").and_then(Value::as_object_mut) {
            in_ep.insert("host".to_string(), Value::String(LOCALHOST.to_string()));
            in_ep.insert("port".to_string(), Value::from(port));
        }
    } else if let Some(h) = obj.get_mut("http_proxy").and_then(Value::as_object_mut) {
        if let Some(pl) = h.get_mut("proxy_listen").and_then(Value::as_object_mut) {
            pl.insert("host".to_string(), Value::String(LOCALHOST.to_string()));
            pl.insert("port".to_string(), Value::from(port));
        }
    }
}

/// 读 ingress 的远端目标 host[:port]（转发给 tng 内部 ingress 时用作 Host 头，
/// 须为非本机地址以避开 tng 的 recursion 检测）：`mapping` 取首条规则 `out.host`
/// （不带端口——mapping 转发目标是 `out.host:out.port`，不依赖 Host 头），`http_proxy`
/// 取 `dst_filters` 数组首元素 `dst_filters[0].domain`（兼容遗留对象 `{domain}`），且其
/// `port` 为有效 1..=65535 时拼为 `domain:port`——tng 的 `http_proxy` 上游目标
/// **完全由请求 `Host` 头（含端口）决定**，`dst_filters.port` 仅参与 ingress 匹配；
/// 不带端口会被 tng 归一为 `:80`，https 端口（443 / 30090 等）均不可达。
/// `mapping` 的 `out.host` 已由 `validate_required_remote` 保证非空 IPv4；`http_proxy`
/// 的 domain 可能为空（tng 接受），此时返回空串（由调用方回退）。
fn read_remote_host(entry: &Value) -> String {
    if let Some(m) = entry.get("mapping").and_then(Value::as_object) {
        let host = m
            .get("rules")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|r| r.get("out"))
            .and_then(Value::as_object)
            .and_then(|o| o.get("host"))
            .and_then(Value::as_str)
            .or_else(|| {
                m.get("out")
                    .and_then(Value::as_object)
                    .and_then(|o| o.get("host"))
                    .and_then(Value::as_str)
            });
        return host.unwrap_or("").to_string();
    }
    if let Some(h) = entry.get("http_proxy").and_then(Value::as_object) {
        // dst_filters 序列化为数组 [{domain, port}]；兼容遗留对象 {domain}。
        // Host 头须带 dst 端口（tng 以 Host 头 host:port 定上游）；端口
        // 0 或越界视为未配端口，回退裸 domain（与前端 serialize 省略非法端口同口径）。
        if let Some(df) = h.get("dst_filters") {
            let objf = df
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(Value::as_object)
                .or_else(|| df.as_object());
            if let Some(d) = objf {
                if let Some(dom) = d.get("domain").and_then(Value::as_str) {
                    let port = d
                        .get("port")
                        .and_then(Value::as_u64)
                        .filter(|p| (1..=65535).contains(p));
                    return match port {
                        Some(p) => format!("{dom}:{p}"),
                        None => dom.to_string(),
                    };
                }
            }
        }
    }
    String::new()
}

/// 拦截 tng 加载期必然拒绝的 ingress 远端配置：`mapping` 每条规则（序列化形态
/// `{ rules: [{ in, out }] }`，也兼容遗留 `{ in, out }`）的 `out.host` 须为非空 IPv4——
/// 与 tng `mapping_rule::RuleEndpoint.host: Option<Ipv4Addr>` 一致，空串/非 IP 会被
/// `untagged enum MappingDe` 整体拒掉。`http_proxy` 的 `dst_filters` 即便 domain 为空 tng 也
/// 加载（仅匹配不到），故不拦。
fn validate_ingress_for_launch(root: &serde_json::Map<String, Value>) -> Result<(), PrepareError> {
    let Some(entries) = root.get("add_ingress").and_then(Value::as_array) else {
        return Ok(());
    };
    for (i, entry) in entries.iter().enumerate() {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        // 仅拦客户端两种形态；其余形态序列化层不会产生，交 tng 自行处理。
        if let Some(m) = obj.get("mapping").and_then(Value::as_object) {
            let out_hosts: Vec<Option<&str>> = match m.get("rules").and_then(Value::as_array) {
                Some(rules) => rules
                    .iter()
                    .map(|r| {
                        r.get("out")
                            .and_then(Value::as_object)
                            .and_then(|o| o.get("host"))
                            .and_then(Value::as_str)
                    })
                    .collect(),
                None => vec![
                    m.get("out")
                        .and_then(Value::as_object)
                        .and_then(|o| o.get("host"))
                        .and_then(Value::as_str),
                ],
            };
            if out_hosts.is_empty() {
                // rules 为空数组：tng 接受（空规则不做事），不拦。
                continue;
            }
            for (j, out_host) in out_hosts.iter().enumerate() {
                let Some(h) = out_host.map(str::trim).filter(|s| !s.is_empty()) else {
                    return Err(PrepareError::IngressInvalid(format!(
                        "add_ingress[{i}] mapping rule {j} 缺少 out.host（须填网关 IPv4 地址）"
                    )));
                };
                if h.parse::<std::net::Ipv4Addr>().is_err() {
                    return Err(PrepareError::IngressInvalid(format!(
                        "add_ingress[{i}] mapping rule {j} out.host={h:?} 不是有效 IPv4（tng 仅接受 IP）"
                    )));
                }
            }
        }
    }
    Ok(())
}

/// 读出用户配置中各 ingress 的反代对外端口（`tngui_outward.port`，缺失用默认），按
/// `add_ingress` 顺序。供 `pick_launch_ports` 构成禁止集合（注入端口须避让对外端口）。
fn outward_ports(user_json: &str) -> Result<Vec<u16>, PrepareError> {
    let v = validate_user_config(user_json)?;
    let mut out = Vec::new();
    if let Some(arr) = v.get("add_ingress").and_then(|a| a.as_array()) {
        for entry in arr {
            let (_, port) = read_outward(entry);
            out.push(port);
        }
    }
    Ok(out)
}

/// 批探测一次取齐「1 个管控端口 + 各 ingress 内部端口」：用 `pick_free_ports(1 + N)`
/// 占住再放（保证两两互不相同），并对各 ingress 反代对外端口先验避让——任一批取结果
/// 命中对外端口即整批丢弃重取（有界重试，避免死循环）。重试耗尽则启动失败并明示。
/// 返回 `(control_port, internal_ports)`，供 `launch_tng` 经 `prepare_launch` 注入。
pub fn pick_launch_ports(user_json: &str) -> Result<(u16, Vec<u16>), PrepareError> {
    let n_ingress = ingress_count(user_json)?;
    let forbidden = outward_ports(user_json)?;
    let total = 1 + n_ingress;
    const MAX_RETRIES: usize = 64;
    for _ in 0..MAX_RETRIES {
        let ports = pick_free_ports(total)
            .map_err(|e| PrepareError::IngressInvalid(format!("无法分配端口: {e}")))?;
        if !ports.iter().any(|p| forbidden.contains(p)) {
            let (ctrl, internal) = ports.split_first().expect("total >= 1");
            return Ok((*ctrl, internal.to_vec()));
        }
        // 命中对外端口：整批丢弃重试
    }
    Err(PrepareError::IngressInvalid(
        "批探测端口反复命中对外端口、重试耗尽".to_string(),
    ))
}

/// 从（已收口的）配置读出控制端口。保留作诊断用途。
pub fn control_port(config: &Value) -> Option<u16> {
    let port = config
        .get("control_interface")?
        .get("restful")?
        .get("port")?;
    let n = if let Some(n) = port.as_u64() {
        n
    } else {
        let s = port.as_str()?;
        s.parse::<u64>().ok()?
    };
    if n > u16::MAX as u64 {
        return None;
    }
    Some(n as u16)
}

/// 把收口后的配置以 pretty JSON 写入 `<dir>/tng-runtime.json`，返回写出路径。
pub fn write_runtime_config(dir: &Path, config: &Value) -> io::Result<PathBuf> {
    let path = dir.join("tng-runtime.json");
    let pretty = serde_json::to_string_pretty(config).map_err(io::Error::other)?;
    std::fs::write(&path, pretty)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_port_returns_loopback_usable_port() {
        let port = pick_free_port().expect("bind 127.0.0.1:0 should succeed");
        assert!((1..=65535).contains(&port), "port={port}");
        assert_ne!(port, 0, "OS 不应返回 0");
        // 释放后该端口应能被立即重新绑定（loopback 上窗口极小）
        let r = TcpListener::bind(("127.0.0.1", port));
        assert!(r.is_ok(), "reuse bind failed for port={port}: {r:?}");
    }

    #[test]
    fn validate_rejects_non_object_and_bad_json() {
        assert!(matches!(
            validate_user_config("{ not json }"),
            Err(PrepareError::InvalidJson(_))
        ));
        assert!(matches!(
            validate_user_config("[]"),
            Err(PrepareError::RootNotObject)
        ));
        assert!(matches!(
            validate_user_config("5"),
            Err(PrepareError::RootNotObject)
        ));
        // 合法对象通过
        assert!(validate_user_config(r#"{"control_interface":{"restful":{"port":5}}}"#).is_ok());
    }

    #[test]
    fn read_remote_host_picks_mapping_out_or_http_proxy_domain() {
        // mapping：首条规则 out.host
        let m = serde_json::from_str::<Value>(
            r#"{"mapping":{"rules":[{"in":{"port":1},"out":{"host":"10.0.0.1","port":2}}]}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&m), "10.0.0.1");
        // mapping 遗留 {in,out} 形态
        let m2 = serde_json::from_str::<Value>(
            r#"{"mapping":{"in":{"port":1},"out":{"host":"10.0.0.2","port":2}}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&m2), "10.0.0.2");
        // http_proxy：dst_filters 数组首元素 domain+port → Host 头带端口
        let h = serde_json::from_str::<Value>(
            r#"{"http_proxy":{"proxy_listen":{"port":1},"dst_filters":[{"domain":"inference.example","port":8443}]}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&h), "inference.example:8443");
        // 有效端口缺失/0/越界 → 裸 domain（与前端 serialize 省略非法端口同口径）
        let hn = serde_json::from_str::<Value>(
            r#"{"http_proxy":{"proxy_listen":{"port":1},"dst_filters":[{"domain":"inference.example"}]}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&hn), "inference.example");
        let h0 = serde_json::from_str::<Value>(
            r#"{"http_proxy":{"proxy_listen":{"port":1},"dst_filters":[{"domain":"inference.example","port":0}]}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&h0), "inference.example");
        let hbig = serde_json::from_str::<Value>(
            r#"{"http_proxy":{"proxy_listen":{"port":1},"dst_filters":[{"domain":"inference.example","port":70000}]}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&hbig), "inference.example");
        // http_proxy 遗留对象形态 {domain}：仍兼容（无端口 → 裸 domain）
        let h_obj = serde_json::from_str::<Value>(
            r#"{"http_proxy":{"proxy_listen":{"port":1},"dst_filters":{"domain":"legacy.example"}}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&h_obj), "legacy.example");
        let h_obj_port = serde_json::from_str::<Value>(
            r#"{"http_proxy":{"proxy_listen":{"port":1},"dst_filters":{"domain":"legacy.example","port":443}}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&h_obj_port), "legacy.example:443");
        // http_proxy 空 domain → 空串（调用方回退）
        let h2 = serde_json::from_str::<Value>(
            r#"{"http_proxy":{"proxy_listen":{"port":1},"dst_filters":{"domain":""}}}"#,
        )
        .unwrap();
        assert_eq!(read_remote_host(&h2), "");
    }

    #[test]
    fn prepare_creates_control_interface_when_absent() {
        // 无 control_interface → 注入 host=127.0.0.1、port=注入值
        let v = prepare_config(r#"{"add_ingress":[]}"#, 40001).unwrap();
        assert_eq!(v["control_interface"]["restful"]["host"], "127.0.0.1");
        assert_eq!(v["control_interface"]["restful"]["port"], 40001);
        // 缺 restful 对象也行
        let v = prepare_config(r#"{"control_interface":{}}"#, 40002).unwrap();
        assert_eq!(v["control_interface"]["restful"]["host"], "127.0.0.1");
        assert_eq!(v["control_interface"]["restful"]["port"], 40002);
    }

    #[test]
    fn prepare_overrides_user_host_and_port() {
        let v = prepare_config(
            r#"{"control_interface":{"restful":{"host":"0.0.0.0","port":99999}}}"#,
            40005,
        )
        .unwrap();
        assert_eq!(v["control_interface"]["restful"]["host"], "127.0.0.1");
        assert_eq!(v["control_interface"]["restful"]["port"], 40005);
        let v = prepare_config(
            r#"{"control_interface":{"restful":{"host":"10.0.0.1","port":7}}}"#,
            40006,
        )
        .unwrap();
        assert_eq!(v["control_interface"]["restful"]["host"], "127.0.0.1");
        assert_eq!(v["control_interface"]["restful"]["port"], 40006);
    }

    #[test]
    fn prepare_preserves_control_interface_siblings_and_other_keys() {
        let src = r#"{
            "control_interface":{"restful":{"host":"0.0.0.0","port":12345},"ttrpc":{"path":"/tmp/x"}},
            "add_ingress":[{"mapping":{"in":{"port":10001},"out":{"host":"127.0.0.1","port":30001}},"no_ra":true}]
        }"#;
        let v = prepare_config(src, 40010).unwrap();
        assert_eq!(v["control_interface"]["restful"]["host"], "127.0.0.1");
        assert_eq!(v["control_interface"]["restful"]["port"], 40010);
        assert_eq!(v["control_interface"]["ttrpc"]["path"], "/tmp/x");
        assert_eq!(v["add_ingress"][0]["no_ra"], true);
        assert_eq!(control_port(&v), Some(40010));
    }

    #[test]
    fn prepare_rewrites_non_object_control_interface_or_restful() {
        let v = prepare_config(r#"{"control_interface":5}"#, 40020).unwrap();
        assert_eq!(v["control_interface"]["restful"]["port"], 40020);
        let v = prepare_config(r#"{"control_interface":{"restful":7}}"#, 40021).unwrap();
        assert_eq!(v["control_interface"]["restful"]["host"], "127.0.0.1");
        assert_eq!(v["control_interface"]["restful"]["port"], 40021);
    }

    #[test]
    fn invalid_json_is_error() {
        assert!(matches!(
            prepare_config("{ not json }", 7),
            Err(PrepareError::InvalidJson(_))
        ));
    }

    #[test]
    fn write_runtime_config_creates_file_with_localhost() {
        let dir = std::env::temp_dir().join(format!("tngui-cfg-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = prepare_config(
            r#"{"control_interface":{"restful":{"host":"0.0.0.0","port":7}}}"#,
            7,
        )
        .unwrap();
        let path = write_runtime_config(&dir, &v).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("\"127.0.0.1\""), "写盘内容: {body}");
        assert!(body.contains("\"port\": 7"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prepare_drops_add_egress() {
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"0.0.0.0","port":1},"out":{"host":"1.1.1.1","port":2}}]},"no_ra":true}],"add_egress":[{"mapping":{"rules":[{"in":{"port":3},"out":{"host":"127.0.0.1","port":4}}]}}]}"#;
        let v = prepare_config(src, 40030).unwrap();
        assert!(v.get("add_egress").is_none(), "add_egress 应被丢弃");
        assert_eq!(v["control_interface"]["restful"]["port"], 40030);
    }

    #[test]
    fn prepare_forces_mapping_listen_host_loopback() {
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"0.0.0.0","port":1},"out":{"host":"10.0.0.1","port":2}}]},"no_ra":true}]}"#;
        let v = prepare_config(src, 40031).unwrap();
        assert_eq!(
            v["add_ingress"][0]["mapping"]["rules"][0]["in"]["host"],
            "127.0.0.1"
        );
        assert_eq!(
            v["add_ingress"][0]["mapping"]["rules"][0]["out"]["host"],
            "10.0.0.1"
        );
    }

    #[test]
    fn prepare_forces_http_proxy_listen_host_loopback() {
        let src = r#"{"add_ingress":[{"http_proxy":{"proxy_listen":{"host":"10.0.0.1","port":18443},"dst_filters":[{"domain":"x.example.com","port":8443}]},"no_ra":true}]}"#;
        let v = prepare_config(src, 40032).unwrap();
        assert_eq!(
            v["add_ingress"][0]["http_proxy"]["proxy_listen"]["host"],
            "127.0.0.1"
        );
        // dst_filters 数组形态原样透传（host + port 分字段）
        assert_eq!(
            v["add_ingress"][0]["http_proxy"]["dst_filters"][0]["domain"],
            "x.example.com"
        );
        assert_eq!(
            v["add_ingress"][0]["http_proxy"]["dst_filters"][0]["port"],
            8443
        );
    }

    #[test]
    fn prepare_rejects_empty_mapping_out_host() {
        // 默认模板场景：out.host 留空 → tng 加载期 MappingDe 拒掉（host: Option<Ipv4Addr>）
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":18443},"out":{"host":"","port":10000}}]},"verify":{"model":"passport","as_provider":"tpm"},"ohttp":{"header_passthrough":{"request_headers":["x-model"]}}}]}"#;
        let err = prepare_config(src, 40050).unwrap_err();
        assert!(matches!(err, PrepareError::IngressInvalid(_)), "{err}");
        assert!(err.to_string().contains("out.host"), "{err}");
        assert!(err.to_string().contains("ingress 配置不可启动"), "{err}");
    }

    #[test]
    fn prepare_rejects_non_ipv4_mapping_out_host() {
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":1},"out":{"host":"example.com","port":2}}]}}]}"#;
        assert!(
            prepare_config(src, 40051)
                .unwrap_err()
                .to_string()
                .contains("IPv4")
        );
    }

    #[test]
    fn prepare_rejects_legacy_mapping_missing_out_host() {
        let src = r#"{"add_ingress":[{"mapping":{"in":{"host":"127.0.0.1","port":1}}}]}"#;
        assert!(matches!(
            prepare_config(src, 40052).unwrap_err(),
            PrepareError::IngressInvalid(_)
        ));
    }

    #[test]
    fn prepare_accepts_valid_mapping_out_host_rules_and_legacy() {
        assert!(prepare_config(
            r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":1},"out":{"host":"10.0.0.1","port":2}}]}}]}"#,
            40053
        )
        .is_ok());
        assert!(prepare_config(
            r#"{"add_ingress":[{"mapping":{"in":{"port":10001},"out":{"host":"127.0.0.1","port":30001}}}]}"#,
            40054
        )
        .is_ok());
    }

    #[test]
    fn prepare_accepts_http_proxy_empty_domain() {
        // http_proxy 空 domain 也能加载（tng 接受）→ 不拦
        let src = r#"{"add_ingress":[{"http_proxy":{"proxy_listen":{"host":"127.0.0.1","port":18443},"dst_filters":[{"domain":""}]}}]}"#;
        assert!(prepare_config(src, 40055).is_ok());
    }

    #[test]
    fn prepare_accepts_no_ingress() {
        assert!(prepare_config(r#"{"control_interface":{}}"#, 40056).is_ok());
    }

    #[test]
    fn prepare_launch_returns_routes_and_injects_internal_port() {
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"0.0.0.0","port":1},"out":{"host":"10.0.0.1","port":2}}]},"tngui_outward":{"host":"0.0.0.0","port":8443},"no_ra":true}]}"#;
        let ports = pick_free_ports(1).unwrap();
        let (v, routes) = prepare_launch(src, 40100, &ports).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].out_host, "0.0.0.0");
        assert_eq!(routes[0].out_port, 8443);
        let in_port = v["add_ingress"][0]["mapping"]["rules"][0]["in"]["port"]
            .as_u64()
            .unwrap() as u16;
        assert!(in_port > 0, "应注入非 0 内部端口");
        assert_ne!(in_port, 1, "应覆盖用户端口 1");
        assert_eq!(
            v["add_ingress"][0]["mapping"]["rules"][0]["in"]["host"],
            "127.0.0.1"
        );
        assert!(
            v["add_ingress"][0].get("tngui_outward").is_none(),
            "tngui_outward 应被剥离"
        );
    }

    #[test]
    fn prepare_launch_http_proxy_route() {
        let src = r#"{"add_ingress":[{"http_proxy":{"proxy_listen":{"host":"10.0.0.1","port":1},"dst_filters":{"domain":"x.example.com"}},"tngui_outward":{"host":"127.0.0.1","port":18443}}]}"#;
        let ports = pick_free_ports(1).unwrap();
        let (v, routes) = prepare_launch(src, 40101, &ports).unwrap();
        assert_eq!(routes[0].out_host, "127.0.0.1");
        assert_eq!(routes[0].out_port, 18443);
        // http_proxy 无端口 → remote_host 裸 domain；有端口 → domain:port
        assert_eq!(routes[0].remote_host, "x.example.com");
        assert_eq!(
            v["add_ingress"][0]["http_proxy"]["proxy_listen"]["host"],
            "127.0.0.1"
        );
        assert_ne!(
            v["add_ingress"][0]["http_proxy"]["proxy_listen"]["port"]
                .as_u64()
                .unwrap(),
            1
        );
    }

    #[test]
    fn prepare_launch_rejects_invalid_outward_host() {
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":1},"out":{"host":"10.0.0.1","port":2}}]},"tngui_outward":{"host":"8.8.8.8","port":1}}]}"#;
        let ports = pick_free_ports(1).unwrap();
        let err = prepare_launch(src, 40102, &ports).unwrap_err();
        assert!(matches!(err, PrepareError::IngressInvalid(_)), "{err}");
        assert!(err.to_string().contains("host 仅支持"), "{err}");
    }

    #[test]
    fn prepare_launch_default_outward_when_missing() {
        // 用户配置不含 tngui_outward → 默认 (127.0.0.1, DEFAULT_OUTWARD_PORT=9443)
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":1},"out":{"host":"10.0.0.1","port":2}}]}}]}"#;
        let ports = pick_free_ports(1).unwrap();
        let (_v, routes) = prepare_launch(src, 40103, &ports).unwrap();
        assert_eq!(routes[0].out_host, "127.0.0.1");
        assert_eq!(routes[0].out_port, 9443);
    }

    #[test]
    fn prepare_launch_multiple_ingress_each_gets_internal_port() {
        let src = r#"{"add_ingress":[
            {"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":1},"out":{"host":"10.0.0.1","port":2}}]},"tngui_outward":{"host":"127.0.0.1","port":18443}},
            {"http_proxy":{"proxy_listen":{"host":"127.0.0.1","port":3},"dst_filters":{"domain":"y"}},"tngui_outward":{"host":"127.0.0.1","port":18444}}
        ]}"#;
        let ports = pick_free_ports(2).unwrap();
        let (v, routes) = prepare_launch(src, 40104, &ports).unwrap();
        assert_eq!(routes.len(), 2);
        assert_ne!(
            routes[0].internal_port, routes[1].internal_port,
            "各 ingress 内部端口应不同"
        );
        assert_eq!(routes[0].out_port, 18443);
        assert_eq!(routes[1].out_port, 18444);
        for i in 0..2 {
            assert!(v["add_ingress"][i].get("tngui_outward").is_none());
        }
    }

    #[test]
    fn pick_free_ports_returns_n_distinct_loopback_ports() {
        let ports = pick_free_ports(5).expect("批取 5 个应成功");
        assert_eq!(ports.len(), 5);
        assert!(ports.iter().all(|p| *p > 0), "端口应非 0: {ports:?}");
        let mut sorted = ports.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), 5, "批取端口应两两不同: {ports:?}");
    }

    #[test]
    fn pick_launch_ports_avoids_outward_port() {
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":1},"out":{"host":"10.0.0.1","port":2}}]},"tngui_outward":{"host":"127.0.0.1","port":18443}}]}"#;
        let (ctrl, internal) = pick_launch_ports(src).unwrap();
        assert_ne!(ctrl, 18443);
        assert_eq!(internal.len(), 1);
        assert_ne!(internal[0], 18443);
        assert_ne!(ctrl, internal[0], "管控与内部端口应不同");
    }

    #[test]
    fn pick_launch_ports_multiple_distinct_and_avoid_outward() {
        let src = r#"{"add_ingress":[{"mapping":{"rules":[{"in":{"host":"127.0.0.1","port":1},"out":{"host":"10.0.0.1","port":2}}]},"tngui_outward":{"host":"127.0.0.1","port":18443}},{"http_proxy":{"proxy_listen":{"host":"127.0.0.1","port":3},"dst_filters":{"domain":"y"}},"tngui_outward":{"host":"127.0.0.1","port":18444}}]}"#;
        let (ctrl, internal) = pick_launch_ports(src).unwrap();
        let mut all = vec![ctrl];
        all.extend(internal.iter());
        assert_eq!(all.len(), 3);
        let mut sorted = all.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), 3, "管控+内部端口应两两不同: {all:?}");
        assert!(
            !all.contains(&18443) && !all.contains(&18444),
            "应避让对外端口: {all:?}"
        );
    }
}
