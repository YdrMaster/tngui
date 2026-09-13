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

/// 管控面由 tngui 自管、端口不对用户暴露：绑定 `127.0.0.1:0` 取一个 OS 分配的空闲回环
/// 端口后立即释放返回，交给启动流程注入传给 tng 的配置。该端口随后由 `PortCell` 持有
/// 供控制面轮询。loopback 上从释放到 tng 实际绑定的竞态窗口极小（与 tng 自身
/// `testutil::pick_unused_port` 同法）。
pub fn pick_free_port() -> io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

#[derive(Debug)]
pub enum PrepareError {
    /// JSON 解析失败（serde 层）。
    InvalidJson(serde_json::Error),
    /// 配置根不是 JSON 对象。
    RootNotObject,
}

impl fmt::Display for PrepareError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PrepareError::InvalidJson(e) => write!(f, "JSON 解析失败: {e}"),
            PrepareError::RootNotObject => write!(f, "配置根须为 JSON 对象"),
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
/// 保留 `control_interface` 的同级字段（如 `ttrpc`）与 `restful` 的其余键。供 `launch_tng`。
pub fn prepare_config(user_json: &str, control_port: u16) -> Result<Value, PrepareError> {
    let mut v = validate_user_config(user_json)?;

    let root = v
        .as_object_mut()
        .expect("validate_user_config 保证根为对象");
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

    // 强制每条 ingress 的本地监听 host 为回环（与 control_interface.restful 同向），
    // 仅处理客户端两种形态 mapping(in.host)/http_proxy(proxy_listen.host)。
    if let Some(add_ingress) = root.get_mut("add_ingress") {
        if let Some(arr) = add_ingress.as_array_mut() {
            for entry in arr.iter_mut() {
                force_ingress_listen_host(entry);
            }
        }
    }

    Ok(v)
}

/// 强制一条 ingress 的本地监听 host 为 `127.0.0.1`：
/// `mapping` 的 `rules[*].in.host`、`http_proxy` 的 `proxy_listen.host`。其余形态不动。
fn force_ingress_listen_host(entry: &mut Value) {
    let Some(obj) = entry.as_object_mut() else {
        return;
    };
    if let Some(m) = obj.get_mut("mapping").and_then(Value::as_object_mut) {
        if let Some(rules) = m.get_mut("rules").and_then(Value::as_array_mut) {
            for r in rules.iter_mut() {
                if let Some(in_ep) = r.get_mut("in").and_then(Value::as_object_mut) {
                    in_ep.insert("host".to_string(), Value::String(LOCALHOST.to_string()));
                }
            }
        }
    } else if let Some(h) = obj.get_mut("http_proxy").and_then(Value::as_object_mut) {
        if let Some(pl) = h.get_mut("proxy_listen").and_then(Value::as_object_mut) {
            pl.insert("host".to_string(), Value::String(LOCALHOST.to_string()));
        }
    }
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
        let src = r#"{"add_ingress":[{"http_proxy":{"proxy_listen":{"host":"10.0.0.1","port":18443},"dst_filters":{"domain":"x.example.com"}},"no_ra":true}]}"#;
        let v = prepare_config(src, 40032).unwrap();
        assert_eq!(
            v["add_ingress"][0]["http_proxy"]["proxy_listen"]["host"],
            "127.0.0.1"
        );
        assert_eq!(
            v["add_ingress"][0]["http_proxy"]["dst_filters"]["domain"],
            "x.example.com"
        );
    }
}
