//! 控制面契约（B）：只读轮询 `GET /livez`、`/readyz`、`/status/`。
//!
//! 不引入 reqwest/TLS——目标是 `127.0.0.1` 上的明文 HTTP，手写一个
//! 极简的 HTTP/1.0 GET 即可，避免 openssl/rustls/aws-lc-sys 等重依赖。
//! 行为与设计稿一致（D5）。

use std::io;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// 单次状态轮询结果，直接序列化交给前端。
#[derive(Debug, Clone, Serialize)]
pub struct StatusReport {
    /// 能否连上控制端口。连不上 ⇒ 进程未运行/已退出（红）。
    pub reachable: bool,
    /// `/livez` 是否 2xx（tng 中硬编码为 200，弱信号）。
    pub livez_ok: bool,
    /// `/readyz` 是否 2xx（真正的就绪信号）。
    pub ready: bool,
    /// `/status/` 返回的 JSON（取不到则为 null）。
    pub status_json: Value,
    /// 连接/解析错误信息（仅当 reachable=false 时可能有值）。
    pub error: Option<String>,
}

/// 轮询 `127.0.0.1:<port>` 的三个端点，汇总成 `StatusReport`。
pub async fn fetch_status(port: u16) -> StatusReport {
    let livez = http_get(port, "/livez").await;
    let livez_ok = matches!(&livez, Ok(r) if (200..300).contains(&r.status));

    if livez.is_err() {
        // livez 都连不上 ⇒ 视为不可达
        return StatusReport {
            reachable: false,
            livez_ok: false,
            ready: false,
            status_json: Value::Null,
            error: livez.err().map(|e| e.to_string()),
        };
    }

    let ready = http_get(port, "/readyz").await;
    let ready_ok = matches!(&ready, Ok(r) if (200..300).contains(&r.status));

    let status_json = match http_get(port, "/status/").await {
        Ok(r) if (200..300).contains(&r.status) => {
            serde_json::from_str(&r.body).unwrap_or(Value::String(r.body))
        }
        _ => Value::Null,
    };

    StatusReport {
        reachable: true,
        livez_ok,
        ready: ready_ok,
        status_json,
        error: None,
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
    write.shutdown().await.ok();

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
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    /// 起一个回固定响应的桩 HTTP 服务，返回实际监听端口。
    async fn stub_server(livez: u16, readyz: u16, status_body: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = match listener.accept().await {
                    Ok(p) => p,
                    Err(_) => break,
                };
                // 读掉请求行（不关心内容）
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                // 取路径
                let req = String::from_utf8_lossy(&buf);
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (code, body) = match path.as_str() {
                    "/livez" => (livez, "ok"),
                    "/readyz" => (readyz, "ok"),
                    "/status/" => (200, status_body),
                    _ => (404, "{}"),
                };
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
        let port = stub_server(200, 200, r#"["egress","ingress"]"#).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert!(r.reachable);
        assert!(r.livez_ok);
        assert!(r.ready, "readyz=200 应就绪: {r:?}");
        assert_eq!(r.status_json, serde_json::json!(["egress", "ingress"]));
    }

    #[tokio::test]
    async fn starting_when_readyz_503() {
        let port = stub_server(200, 503, "[]").await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = fetch_status(port).await;
        assert!(r.reachable);
        assert!(r.livez_ok);
        assert!(!r.ready, "readyz=503 应未就绪: {r:?}");
    }

    #[tokio::test]
    async fn unreachable_when_no_server() {
        // 端口 1 几乎不会有服务监听
        let r = fetch_status(1).await;
        assert!(!r.reachable, "无服务应不可达: {r:?}");
        assert!(!r.ready);
    }
}
