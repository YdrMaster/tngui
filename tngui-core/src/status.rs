//! 控制面契约（B）：只读轮询 `GET /livez`、`/readyz`、`/status/`、
//! `/status/ingress/{id}/ohttp/keys`。
//!
//! 不引入 reqwest/TLS——目标是 `127.0.0.1` 上的明文 HTTP，手写一个
//! 极简的 HTTP/1.0 GET 即可，避免 openssl/rustls/aws-lc-sys 等重依赖。

use std::io;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// 单次状态轮询结果，直接序列化交给前端。
#[derive(Debug, Clone, Serialize)]
pub struct StatusReport {
    /// 能否连上控制端口。连不上 ⇒ 进程未运行/已退出。
    pub reachable: bool,
    /// `/livez` 是否 2xx（tng 中硬编码为 200，弱信号）。
    pub livez_ok: bool,
    /// `/readyz` 是否 2xx（真正的就绪信号）。
    pub ready: bool,
    /// `/status/` 返回的 JSON（取不到则为 null）。
    pub status_json: Value,
    /// `/status/ingress/` 发现的 ingress id 快照。
    pub ingress_ids: Value,
    /// 首个 ingress 的 `/ohttp/keys` 原始 JSON（取不到则为 null）。
    pub ingress_keys: Value,
    /// ingress keys 采集或解析错误；未配置 ingress 时不设置。
    pub ingress_keys_error: Option<String>,
    /// 由外壳补充的进程异常信号；`fetch_status` 本身不推断进程生命周期。
    pub process_error: Option<String>,
    /// 连接/解析错误信息（仅当 reachable=false 时可能有值）。
    pub error: Option<String>,
}

impl StatusReport {
    fn unavailable(error: Option<String>) -> Self {
        Self {
            reachable: false,
            livez_ok: false,
            ready: false,
            status_json: Value::Null,
            ingress_ids: json!([]),
            ingress_keys: Value::Null,
            ingress_keys_error: None,
            process_error: None,
            error,
        }
    }
}

/// 轮询 `127.0.0.1:<port>` 的探针、状态树和首个 ingress keys 快照。
pub async fn fetch_status(port: u16) -> StatusReport {
    let livez = http_get(port, "/livez").await;
    let livez_ok = matches!(&livez, Ok(r) if (200..300).contains(&r.status));

    if livez.is_err() {
        // livez 都连不上 ⇒ 视为不可达。
        return StatusReport::unavailable(livez.err().map(|e| e.to_string()));
    }

    let ready = http_get(port, "/readyz").await;
    let ready_ok = matches!(&ready, Ok(r) if (200..300).contains(&r.status));

    let status_json = match http_get(port, "/status/").await {
        Ok(r) if (200..300).contains(&r.status) => parse_json_body(&r.body),
        _ => Value::Null,
    };

    let mut ingress_ids = json!([]);
    let mut ingress_keys = Value::Null;
    let mut ingress_keys_error: Option<String> = None;

    if status_json.is_array()
        && status_json
            .as_array()
            .is_some_and(|v| v.iter().any(|x| x == &json!("ingress")))
    {
        match http_get(port, "/status/ingress/").await {
            Ok(r) if (200..300).contains(&r.status) => {
                let parsed = parse_json_body(&r.body);
                let ids = ingress_id_snapshot(&parsed);
                ingress_ids = json!(ids);
                if let Some(id) = ids.first() {
                    let path = format!("/status/ingress/{id}/ohttp/keys");
                    match http_get(port, &path).await {
                        Ok(resp) if (200..300).contains(&resp.status) => {
                            let parsed_keys = parse_json_body(&resp.body);
                            if parsed_keys.is_null() {
                                ingress_keys_error =
                                    Some("ingress keys 响应不是有效 JSON".to_string());
                            } else {
                                ingress_keys = parsed_keys;
                            }
                        }
                        Ok(resp) => {
                            ingress_keys_error =
                                Some(format!("ingress keys 请求返回 HTTP {}", resp.status));
                        }
                        Err(e) => {
                            ingress_keys_error = Some(format!("ingress keys 请求失败: {e}"));
                        }
                    }
                } else {
                    ingress_keys_error = Some("ingress 状态树没有可用 id".to_string());
                }
            }
            Ok(resp) => {
                ingress_ids = json!([]);
                ingress_keys_error = Some(format!("ingress 状态树请求返回 HTTP {}", resp.status));
            }
            Err(e) => {
                ingress_ids = json!([]);
                ingress_keys_error = Some(format!("ingress 状态树请求失败: {e}"));
            }
        }
    }

    StatusReport {
        reachable: true,
        livez_ok,
        ready: ready_ok,
        status_json,
        ingress_ids,
        ingress_keys,
        ingress_keys_error,
        process_error: None,
        error: None,
    }
}

/// 把 HTTP body 解析为 JSON；空 body 或解析失败返回 `Null`。
fn parse_json_body(body: &str) -> Value {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(trimmed).unwrap_or(Value::Null)
    }
}

/// 从 `/status/ingress/` 的 JSON 提取保守的 id 快照。只接受字符串或数值 id。
fn ingress_id_snapshot(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

struct RawResp {
    status: u16,
    body: String,
}

/// 极简 HTTP/1.0 GET。超时约 2s。
async fn http_get(port: u16, path: &str) -> io::Result<RawResp> {
    let addr = format!("127.0.0.1:{port}");
    let stream = tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(&addr))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "连接超时"))??;

    let req = format!("GET {path} HTTP/1.0\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    let (mut read, mut write) = stream.into_split();
    write.write_all(req.as_bytes()).await?;
    // 不半关闭写端：实测对 tng/hyper 半关闭(FIN)会导致服务端不回响应（空包）。
    // 服务端按 Connection: close 在响应后自行关闭，read 收到 EOF 即停。

    let mut all = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = read.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        all.extend_from_slice(&buf[..n]);
        if all.len() > 1_000_000 {
            break; // 单次响应上限 1MB
        }
    }

    let text = String::from_utf8_lossy(&all);
    let header_end = text
        .find("\r\n\r\n")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "无响应头结束符"))?;
    let head = &text[..header_end];
    let body = text[header_end + 4..].to_string();

    let status_line = head.lines().next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    Ok(RawResp { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    type Routes = HashMap<&'static str, (u16, &'static str)>;

    /// 起一个按路径回响应的桩 HTTP 服务，返回实际监听端口。
    async fn stub_server(routes: Routes) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = match listener.accept().await {
                    Ok(p) => p,
                    Err(_) => break,
                };
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let req = String::from_utf8_lossy(&buf);
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (code, body) = routes
                    .get(path.as_str())
                    .copied()
                    .unwrap_or((404, "{\"error\":\"not found\"}"));
                let resp = format!(
                    "HTTP/1.0 {code} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            }
        });
        port
    }

    #[tokio::test]
    async fn ready_when_livez_and_readyz_200() {
        let port = stub_server(HashMap::from([
            ("/livez", (200, "ok")),
            ("/readyz", (200, "ok")),
            ("/status/", (200, r#"["egress","ingress"]"#)),
        ]))
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert!(r.reachable && r.livez_ok && r.ready);
        assert_eq!(r.status_json, serde_json::json!(["egress", "ingress"]));
    }

    #[tokio::test]
    async fn starting_when_readyz_503() {
        let port = stub_server(HashMap::from([
            ("/livez", (200, "ok")),
            ("/readyz", (503, "unavailable")),
            ("/status/", (200, "[]")),
        ]))
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert!(r.reachable && r.livez_ok && !r.ready);
    }

    #[tokio::test]
    async fn unreachable_when_no_server() {
        // 端口 1 几乎不会有服务监听。
        let r = fetch_status(1).await;
        assert!(!r.reachable && !r.ready);
        assert_eq!(r.ingress_ids, json!([]));
        assert!(r.ingress_keys.is_null());
    }

    #[tokio::test]
    async fn fetches_first_ingress_keys_snapshot() {
        let port = stub_server(HashMap::from([
            ("/livez", (200, "ok")),
            ("/readyz", (200, "ok")),
            ("/status/", (200, r#"["ingress"]"#)),
            ("/status/ingress/", (200, r#"["1","2"]"#)),
            (
                "/status/ingress/1/ohttp/keys",
                (
                    200,
                    r#"{"servers":[{"url":"http://egress/","server_public_key":"abc","server_attestation":"jwt"}]}"#,
                ),
            ),
        ]))
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert_eq!(r.ingress_ids, json!(["1", "2"]));
        assert_eq!(r.ingress_keys["servers"][0]["server_public_key"], "abc");
        assert!(r.ingress_keys_error.is_none());
    }

    #[tokio::test]
    async fn empty_ingress_keys_are_valid_empty_state() {
        let port = stub_server(HashMap::from([
            ("/livez", (200, "ok")),
            ("/readyz", (200, "ok")),
            ("/status/", (200, r#"["ingress"]"#)),
            ("/status/ingress/", (200, r#"["7"]"#)),
            ("/status/ingress/7/ohttp/keys", (200, r#"{"servers":[]}"#)),
        ]))
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert_eq!(r.ingress_keys, serde_json::json!({"servers": []}));
        assert!(r.ingress_keys_error.is_none());
    }

    #[tokio::test]
    async fn keys_error_is_conserved_without_failing_probes() {
        let port = stub_server(HashMap::from([
            ("/livez", (200, "ok")),
            ("/readyz", (200, "ok")),
            ("/status/", (200, r#"["ingress"]"#)),
            ("/status/ingress/", (200, r#"["7"]"#)),
            ("/status/ingress/7/ohttp/keys", (503, "unavailable")),
        ]))
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert!(r.reachable && r.ready);
        assert!(r.ingress_keys.is_null());
        assert_eq!(
            r.ingress_keys_error.as_deref(),
            Some("ingress keys 请求返回 HTTP 503")
        );
    }

    #[tokio::test]
    async fn invalid_keys_json_is_conserved() {
        let port = stub_server(HashMap::from([
            ("/livez", (200, "ok")),
            ("/readyz", (200, "ok")),
            ("/status/", (200, r#"["ingress"]"#)),
            ("/status/ingress/", (200, r#"["7"]"#)),
            ("/status/ingress/7/ohttp/keys", (200, "{bad")),
        ]))
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert!(r.ingress_keys.is_null());
        assert_eq!(
            r.ingress_keys_error.as_deref(),
            Some("ingress keys 响应不是有效 JSON")
        );
    }

    #[tokio::test]
    async fn no_ingress_capability_has_empty_snapshot() {
        let port = stub_server(HashMap::from([
            ("/livez", (200, "ok")),
            ("/readyz", (200, "ok")),
            ("/status/", (200, r#"["egress"]"#)),
        ]))
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert_eq!(r.ingress_ids, json!([]));
        assert!(r.ingress_keys.is_null());
        assert!(r.ingress_keys_error.is_none());
    }

    #[test]
    fn ingress_id_snapshot_accepts_only_supported_ids() {
        let value = json!(["1", 7, {"bad": true}, null]);
        assert_eq!(
            ingress_id_snapshot(&value),
            vec!["1".to_string(), "7".to_string()]
        );
    }
}
