//! 配置契约：解析用户提供的 TNG JSON，做安全收口后写盘。
//!
//! 安全收口（设计稿 D2）：
//! - 强制 `control_interface.restful.host = "127.0.0.1"`（控制面无鉴权，tng 默认 `0.0.0.0`）。
//! - 缺 `control_interface.restful.port` 时返回错误（状态客户端无端口无法轮询）。

use serde_json::Value;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

/// 回环地址。控制面强制绑定于此，避免无鉴权接口暴露到外部网卡。
const LOCALHOST: &str = "127.0.0.1";

#[derive(Debug)]
pub enum PrepareError {
    /// JSON 解析失败（包括 tng 的 deny_unknown_fields 会在 tng 侧报错，这里只管 serde 自身）。
    InvalidJson(serde_json::Error),
    /// `control_interface.restful` 缺失或不是对象。
    InvalidRestful,
    /// `control_interface.restful.port` 缺失——状态客户端无法轮询。
    NoRestfulPort,
}

impl fmt::Display for PrepareError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PrepareError::InvalidJson(e) => write!(f, "JSON 解析失败: {e}"),
            PrepareError::InvalidRestful => {
                write!(f, "control_interface.restful 必须是含 host/port 的对象")
            }
            PrepareError::NoRestfulPort => write!(
                f,
                "配置缺少 control_interface.restful.port，状态客户端无法轮询控制面"
            ),
        }
    }
}

impl std::error::Error for PrepareError {}

/// 解析用户 JSON 并做安全收口：强制 `host=127.0.0.1`，缺 `port` 报错。
///
/// 返回修改后的 `Value`（调用方负责序列化/写盘）。用户其余字段原样保留。
pub fn prepare_config(user_json: &str) -> Result<Value, PrepareError> {
    let mut v: Value = serde_json::from_str(user_json).map_err(PrepareError::InvalidJson)?;

    let restful = v
        .get_mut("control_interface")
        .and_then(|ci| ci.get_mut("restful"));

    let restful = match restful {
        Some(r) if r.is_object() => r,
        _ => return Err(PrepareError::NoRestfulPort),
    };

    // 必须有 port
    let has_port = restful
        .get("port")
        .map(|p| p.is_u64() || p.is_string())
        .unwrap_or(false);
    if !has_port {
        return Err(PrepareError::NoRestfulPort);
    }

    // 强制 host = 127.0.0.1（缺则注入、其他值则覆盖）
    restful["host"] = Value::String(LOCALHOST.to_string());

    Ok(v)
}

/// 从（已收口的）配置读出控制端口。缺省或越界返回 `None`。
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
    fn missing_port_is_error() {
        // 缺 port → Err(NoRestfulPort)
        let none = r#"{"control_interface":{"restful":{"host":"127.0.0.1"}}}"#;
        assert!(matches!(
            prepare_config(none),
            Err(PrepareError::NoRestfulPort)
        ));
        // 完全没有 control_interface → Err
        assert!(matches!(
            prepare_config(r#"{"add_ingress":[]}"#),
            Err(PrepareError::NoRestfulPort)
        ));
        // restful 非对象 → Err
        assert!(matches!(
            prepare_config(r#"{"control_interface":{"restful":5}}"#),
            Err(PrepareError::NoRestfulPort)
        ));
    }

    #[test]
    fn host_forced_to_localhost() {
        let cases = [
            // 缺省 host
            r#"{"control_interface":{"restful":{"port":50000}}}"#,
            // 0.0.0.0
            r#"{"control_interface":{"restful":{"host":"0.0.0.0","port":50000}}}"#,
            // 其他值
            r#"{"control_interface":{"restful":{"host":"10.0.0.1","port":50000}}}"#,
        ];
        for src in cases {
            let v = prepare_config(src).expect("ok");
            let host = v["control_interface"]["restful"]["host"].as_str().unwrap();
            assert_eq!(host, "127.0.0.1", "host 未被强制为 127.0.0.1，源={src}");
        }
    }

    #[test]
    fn valid_config_preserves_port_and_rest() {
        let src = r#"{
            "control_interface":{"restful":{"host":"0.0.0.0","port":12345}},
            "add_ingress":[{"mapping":{"in":{"port":10001},"out":{"host":"127.0.0.1","port":30001}},"no_ra":true}]
        }"#;
        let v = prepare_config(src).expect("ok");
        assert_eq!(v["control_interface"]["restful"]["host"], "127.0.0.1");
        assert_eq!(v["control_interface"]["restful"]["port"], 12345);
        // 其余字段保留
        assert_eq!(v["add_ingress"][0]["no_ra"], true);
        assert_eq!(control_port(&v), Some(12345));
    }

    #[test]
    fn invalid_json_is_error() {
        assert!(matches!(
            prepare_config("{ not json }"),
            Err(PrepareError::InvalidJson(_))
        ));
    }

    #[test]
    fn write_runtime_config_creates_file_with_localhost() {
        let dir = std::env::temp_dir().join(format!("tngui-cfg-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = prepare_config(r#"{"control_interface":{"restful":{"host":"0.0.0.0","port":7}}}"#)
            .unwrap();
        let path = write_runtime_config(&dir, &v).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("\"127.0.0.1\""), "写盘内容: {body}");
        assert!(body.contains("\"port\": 7"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
