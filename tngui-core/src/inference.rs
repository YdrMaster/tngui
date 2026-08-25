//! 密态推理请求：通过 tng 透明代理发送 OpenAI 兼容 POST 请求。
//!
//! tng 不解析 HTTP path（按 Host 路由），透传到 egress `out`。无 --log-file → tng 日志走 stdout 被捕获。
//! 非流式：POST /v1/chat/completions，响应一次性返回。

use std::io;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// 发送推理请求，返回 assistant 响应文本（`choices[0].message.content`）。
pub async fn send_inference(
    port: u16,
    model: &str,
    api_key: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt }],
    })
    .to_string();

    let (status, body_str) = http_request(
        "127.0.0.1",
        port,
        "POST",
        "/v1/chat/completions",
        &[
            ("Authorization", format!("Bearer {api_key}").as_str()),
            ("Content-Type", "application/json"),
        ],
        &body,
    )
    .await
    .map_err(|e| format!("HTTP POST 失败: {e}"))?;

    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}: {body_str}"));
    }

    let v: Value =
        serde_json::from_str(&body_str).map_err(|e| format!("响应 JSON 解析失败: {e}"))?;
    let content = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| format!("响应缺少 choices[0].message.content: {body_str}"))?;
    Ok(content.to_string())
}

/// HTTP/1.x 请求（支持 GET/POST）。超时 30s。完整读到 EOF（Connection: close）。
///
/// 注：不做 chunked transfer-encoding 解析——假设非流式响应用 Content-Length（OpenAI 兼容默认）。
/// 若后续碰到 chunked 响应，在此加 de-chunk。
async fn http_request(
    host: &str,
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> io::Result<(u16, String)> {
    let addr = format!("{host}:{port}");
    let stream = tokio::time::timeout(Duration::from_secs(30), TcpStream::connect(&addr))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "连接超时"))??;

    let mut req = format!(
        "{method} {path} HTTP/1.0\r\nHost: {addr}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len(),
    );
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    if !body.is_empty() {
        req.push_str(body);
    }

    let (mut read, mut write) = stream.into_split();
    write.write_all(req.as_bytes()).await?;
    // 不半关闭写端（同 fetch_status 修复）

    let mut all = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = read.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        all.extend_from_slice(&buf[..n]);
        if all.len() > 10_000_000 {
            break;
        }
    }

    let text = String::from_utf8_lossy(&all);
    let header_end = text
        .find("\r\n\r\n")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "无响应头结束符"))?;
    let head = &text[..header_end];
    let body_resp = text[header_end + 4..].to_string();

    let status_line = head.lines().next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    Ok((status, body_resp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn send_inference_no_server_returns_err() {
        let r = send_inference(1, "model", "key", "prompt").await;
        assert!(r.is_err());
        let e = r.unwrap_err();
        assert!(e.contains("HTTP POST 失败") || e.contains("连接超时"));
    }
}
