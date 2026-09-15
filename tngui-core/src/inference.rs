//! 密态推理请求：通过 tngui 反向代理对外端点发送 OpenAI 兼容 POST 请求。
//!
//! `send_inference` 是普通 OpenAI 客户端：仅带 `Authorization: Bearer` + JSON body
//! （`{model, messages}`）POST 到 `127.0.0.1:<port>`——`port` 调用方传的是 tngui 反代对外
//! 端口（`launch_tng` 启动反代、`proxy_endpoint` 命令暴露）；`x-model` 头由反代按
//! `body.model` 注入/覆盖，此处不注。反代透传到 tng 透明代理（ingress）。非流式：POST
//! /v1/chat/completions，响应一次性返回。

use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// 推理请求失败时的可读诊断。`request` 已脱敏 Authorization；
/// `response` 只在收到 HTTP 头后才存在。
#[derive(Debug)]
struct FailureDiagnostic {
    request: String,
    response: Option<String>,
    message: String,
}

impl FailureDiagnostic {
    fn into_error(self) -> String {
        let response = self
            .response
            .unwrap_or_else(|| "（无 HTTP 响应）".to_string());
        format!(
            "发送失败: {}\n\n--- 发送请求（Authorization 已脱敏） ---\n{}\n\n--- 收到的响应 ---\n{}",
            self.message, self.request, response
        )
    }
}

/// HTTP 响应的字节解码结果（chunked 已按需剥帧）。
#[derive(Debug)]
struct RawResponse {
    status: u16,
    head: String,
    body: String,
}

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

    let addr = format!("127.0.0.1:{port}");
    let authorization = format!("Bearer {api_key}");
    let headers = [
        ("Authorization", authorization.as_str()),
        ("Content-Type", "application/json"),
    ];
    let request = build_http_request(&addr, "POST", "/v1/chat/completions", &headers, &body);

    let response = http_request(&request, &addr)
        .await
        .map_err(|diag| diag.into_error())?;

    if !(200..300).contains(&response.status) {
        return Err(FailureDiagnostic {
            request: redact_request_debug(&request),
            response: Some(format_response_debug(&response.head, &response.body)),
            message: format!("HTTP {}", response.status),
        }
        .into_error());
    }

    let v: Value = serde_json::from_str(&response.body).map_err(|e| {
        FailureDiagnostic {
            request: redact_request_debug(&request),
            response: Some(format_response_debug(&response.head, &response.body)),
            message: format!("响应 JSON 解析失败: {e}"),
        }
        .into_error()
    })?;
    let content = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            FailureDiagnostic {
                request: redact_request_debug(&request),
                response: Some(format_response_debug(&response.head, &response.body)),
                message: "响应缺少 choices[0].message.content".to_string(),
            }
            .into_error()
        })?;
    Ok(content.to_string())
}

/// HTTP/1.x 请求（支持 GET/POST）。超时 30s。完整读到 EOF（Connection: close）。
async fn http_request(request: &str, addr: &str) -> Result<RawResponse, FailureDiagnostic> {
    let stream = match tokio::time::timeout(Duration::from_secs(30), TcpStream::connect(&addr))
        .await
    {
        Ok(result) => result.map_err(|e| diagnostic(&request, format!("连接失败: {e}"), None))?,
        Err(_) => {
            return Err(diagnostic(&request, "连接失败: 连接超时".to_string(), None));
        }
    };

    let (mut read, mut write) = stream.into_split();
    let mut all = Vec::new();
    let mut buf = [0u8; 4096];

    if let Err(e) = write.write_all(request.as_bytes()).await {
        return Err(diagnostic(&request, format!("发送请求失败: {e}"), None));
    }
    // 不半关闭写端（同 fetch_status 修复）。

    loop {
        match read.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                all.extend_from_slice(&buf[..n]);
                if all.len() > 10_000_000 {
                    break;
                }
            }
            Err(e) => {
                return Err(diagnostic(&request, format!("读取响应失败: {e}"), None));
            }
        }
    }

    // 响应在字节层切分：chunked 剥帧需在无损字节上进行（先转 String 会把帧
    // 尺寸/边界混进"行"概念，且 lossy 替换可能破坏帧严格性）。
    let header_end = all.windows(4).position(|w| w == b"\r\n\r\n");
    let Some(header_end) = header_end else {
        return Err(diagnostic(
            &request,
            "响应缺少头结束符".to_string(),
            if all.is_empty() { None } else { Some(&all) },
        ));
    };
    let head = String::from_utf8_lossy(&all[..header_end]).into_owned();
    let mut body_bytes = all[header_end + 4..].to_vec();

    // tng/上游 成帧既有 `Transfer-Encoding: chunked`（实测 tng 2.9.2 的 200 响应
    // 走 chunked）也有 `Content-Length`（tng 网关错误 JSON）。chunked 时按
    // RFC 7230 剥帧，否则 chunk 尺寸会混进 body 导致 JSON 解析失败。
    if resp_is_chunked(&head) {
        if let Some(decoded) = dechunk(&body_bytes) {
            body_bytes = decoded;
        }
        // 剥帧失败（帧不完整/格式异常）→ 沿原字节，让解析/诊断都能暴露真实形态。
    }
    let body_resp = String::from_utf8_lossy(&body_bytes).into_owned();

    let status_line = head.lines().next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    Ok(RawResponse {
        status,
        head,
        body: body_resp,
    })
}

/// 构建发往反代的实际请求（Content-Length 按 body 字节数计算）。
fn build_http_request(
    addr: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> String {
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
    req
}

/// 构建失败诊断；`raw_all` 仅在已收到部分/完整响应时用于展示。
fn diagnostic(request: &str, message: String, raw_all: Option<&[u8]>) -> FailureDiagnostic {
    FailureDiagnostic {
        request: redact_request_debug(request),
        response: raw_all.map(|all| {
            let text = String::from_utf8_lossy(all);
            truncate_chars(text.trim(), 8000)
        }),
        message,
    }
}

/// 脱敏调试请求中的 Authorization 值；请求 body 保持原样。
fn redact_request_debug(request: &str) -> String {
    request
        .lines()
        .map(|line| {
            let Some((key, _value)) = line.split_once(':') else {
                return line.to_string();
            };
            if key.trim().eq_ignore_ascii_case("authorization") {
                format!("{}: Bearer <已隐藏>", key.trim_end())
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 响应诊断正文：状态行/头保留，chunked 已在上层解码，正文截断到 8000 字符。
fn format_response_debug(head: &str, body: &str) -> String {
    let head_text = head
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{}\n\n{}", head_text, truncate_chars(body, 8000))
}

/// UI 诊断正文截断；不保留超长响应导致界面卡顿。
fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let cut = value.chars().take(max).collect::<String>();
    format!("{cut}\n...（诊断内容已截断）")
}

/// 判断响应头是否声明 chunked（头行大小写不敏感、跳过状态行）。
fn resp_is_chunked(head: &str) -> bool {
    head.lines().skip(1).any(|ln| {
        let ln = ln.trim_end_matches('\r');
        let Some((key, value)) = ln.split_once(':') else {
            return false;
        };
        key.trim().eq_ignore_ascii_case("transfer-encoding")
            && value.trim().eq_ignore_ascii_case("chunked")
    })
}

/// RFC 7230 chunked 帧解码（忽略 trailer）；不完整或异常返回 `None`。
fn dechunk(data: &[u8]) -> Option<Vec<u8>> {
    const MAX: usize = 10 * 1024 * 1024;
    let mut out = Vec::with_capacity(data.len());
    let mut pos = 0usize;
    loop {
        if data.len() - pos < 4 {
            return None;
        }
        let rel = data[pos..].windows(2).position(|w| w == b"\r\n")?;
        let line = std::str::from_utf8(&data[pos..pos + rel]).ok()?;
        pos += rel + 2;
        let size_str = line.split(';').next()?.trim();
        let size = usize::from_str_radix(size_str, 16).ok()?;
        if size == 0 {
            return Some(out);
        }
        if pos + size > data.len() || out.len() + size > MAX {
            return None;
        }
        out.extend_from_slice(&data[pos..pos + size]);
        pos += size;
        if data.get(pos..pos + 2) != Some(b"\r\n".as_slice()) {
            return None;
        }
        pos += 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn read_request_safely<S>(stream: &mut S) -> Vec<u8>
    where
        S: tokio::io::AsyncRead + Unpin,
    {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 1024];
        let header_end = loop {
            let n = stream.read(&mut tmp).await.unwrap();
            if n == 0 {
                break buf.len();
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos;
            }
        };
        let head = String::from_utf8_lossy(&buf[..header_end]);
        let content_length = head
            .lines()
            .skip(1)
            .filter_map(|line| {
                let line = line.trim_end_matches('\r');
                let (key, value) = line.split_once(':')?;
                if !key.trim().eq_ignore_ascii_case("content-length") {
                    return None;
                }
                value.trim().parse::<usize>().ok()
            })
            .next()
            .unwrap_or(0);
        let body_start = header_end + 4;
        while buf.len() < body_start + content_length {
            let n = stream.read(&mut tmp).await.unwrap();
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
        }
        buf
    }

    #[tokio::test]
    async fn send_inference_no_server_returns_err() {
        let r = send_inference(1, "model", "key", "prompt").await;
        assert!(r.is_err());
        let e = r.unwrap_err();
        assert!(e.contains("发送失败: 连接失败"), "{e}");
        assert!(e.contains("--- 发送请求"), "{e}");
        assert!(e.contains("（无 HTTP 响应）"), "{e}");
        assert!(!e.contains("Bearer key"), "{e}");
    }

    /// send_inference 退化为普通客户端：不注 x-model（由反代注入），并解析 choices。
    #[tokio::test]
    async fn send_inference_posts_without_x_model_and_returns_content() {
        use std::sync::{Arc, Mutex};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let seen: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let seen2 = seen.clone();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let request = read_request_safely(&mut s).await;
            let head = String::from_utf8_lossy(&request);
            let x_model = head.lines().skip(1).find_map(|ln| {
                let ln = ln.trim_end_matches('\r');
                let mut kv = ln.splitn(2, ':');
                let k = kv.next()?.trim();
                if k.eq_ignore_ascii_case("x-model") {
                    kv.next().map(|v| v.trim().to_string())
                } else {
                    None
                }
            });
            *seen2.lock().unwrap() = x_model;
            let body = r#"{"choices":[{"message":{"content":"hi-from-model"}}]}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = s.write_all(resp.as_bytes()).await;
            let _ = s.flush().await;
        });
        let r = send_inference(port, "gpt-x", "key", "ping").await.unwrap();
        assert_eq!(r, "hi-from-model");
        assert!(
            seen.lock().unwrap().is_none(),
            "send_inference 不应自注 x-model（由反代注入）"
        );
    }

    /// 真实上游链路（tng 2.9.2）的成功响应是 `Transfer-Encoding: chunked`（无
    /// `Content-Length`）——剥帧后才能 JSON 解析，否则 chunk 尺寸混进 body。
    #[tokio::test]
    async fn send_inference_dechunks_chunked_response() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let payload = serde_json::json!({
            "choices": [{ "message": { "content": "chunked-ok" } }]
        })
        .to_string();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{payload}\r\n0\r\n\r\n",
                payload.len()
            );
            let _ = s.write_all(resp.as_bytes()).await;
            let _ = s.flush().await;
        });
        let r = send_inference(port, "m", "k", "p").await.unwrap();
        assert_eq!(r, "chunked-ok");
    }

    /// 2xx 但响应体非 JSON（上游 WAF HTML 拦截页）：错误须带 body 摘要。
    #[tokio::test]
    async fn send_inference_non_json_2xx_reports_body_snippet() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let body = r#"<!DOCTYPE html><html><body>WAF block: 触发安全策略</body></html>"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = s.write_all(resp.as_bytes()).await;
            let _ = s.flush().await;
        });
        let r = send_inference(port, "m", "k", "p").await;
        let e = r.unwrap_err();
        assert!(e.contains("WAF block"), "错误应带 body 摘要: {e}");
        assert!(e.contains("响应 JSON 解析失败"), "{e}");
        assert!(
            e.contains("--- 发送请求（Authorization 已脱敏） ---"),
            "{e}"
        );
        assert!(e.contains("--- 收到的响应 ---"), "{e}");
        assert!(!e.contains("Bearer k"), "{e}");
        assert!(e.contains("Authorization: Bearer <已隐藏>"), "{e}");
    }

    /// 非 2xx（如 tng 网关 HttpCipherTextBadResponse 502 JSON）：报状态码和 body。
    #[tokio::test]
    async fn send_inference_non_2xx_reports_status_with_body() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let body = r#"{"code":"HttpCipherTextBadResponse","message":"..."}"#;
            let resp = format!(
                "HTTP/1.0 502 Bad Gateway\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = s.write_all(resp.as_bytes()).await;
            let _ = s.flush().await;
        });
        let r = send_inference(port, "m", "k", "p").await;
        let e = r.unwrap_err();
        assert!(e.starts_with("发送失败: HTTP 502"), "{e}");
        assert!(e.contains("HttpCipherTextBadResponse"), "{e}");
        assert!(
            e.contains("--- 发送请求（Authorization 已脱敏） ---"),
            "{e}"
        );
        assert!(e.contains("--- 收到的响应 ---"), "{e}");
        assert!(!e.contains("Bearer k"), "{e}");
    }

    #[test]
    fn response_debug_is_truncated() {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n";
        let formatted = format_response_debug(head, &"x".repeat(8001));
        assert!(formatted.contains("...（诊断内容已截断）"), "{formatted}");
    }

    #[test]
    fn dechunk_tailers_and_caps() {
        // 多块 + trailer 行。
        let raw =
            b"4\r\nWiki\r\n5\r\npedia\r\n1\r\n \r\na\r\nin chunks.\r\n0\r\nX-Trailer: 1\r\n\r\n";
        assert_eq!(dechunk(raw).unwrap(), b"Wikipedia in chunks.");
        // 半帧 → None（沿用原字节）。
        assert_eq!(dechunk(b"4\r\nWiki"), None);
        // 空输入 → None。
        assert_eq!(dechunk(&[]), None);
    }
}
