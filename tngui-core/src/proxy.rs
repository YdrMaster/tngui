//! tngui 反向代理：对外暴露推理入口，在转发前注入 `x-model` 头。
//!
//! 形态——tng 全包在内部：
//! - tng 的 ingress 本地监听端口由 tngui 在启动时选取空闲回环端口注入（见
//!   `config::prepare_config`），仅 `127.0.0.1` 可达、对用户隐藏不外配；
//! - tngui 自此进程内起 HTTP 反代对外（host 由 D1 toggle 在 `127.0.0.1`/`0.0.0.0` 间
//!   切换、port 用户可配），把推理请求透传到 tng 内部 ingress，并在转发前按 `body.model`
//!   设置/覆盖 `x-model` 头，使任意 OpenAI 兼容客户端经反代即可走 api-key 鉴权。
//!
//! 行为：
//! - 完整反代（先非流式）：透传 method / path / 头 / body，响应原样回传。
//! - `x-model`：解析 JSON body 取 `model`；含 `model` 字段则在转发前设
//!   `x-model: <model>`——若请求已带 `x-model` 则**覆盖**之（不沿用客户端发来的值），
//!   且不改写 body；无 `model` 或 body 非 JSON 时不设/覆盖 `x-model`、原样转发
//!   （既有的客户端 `x-model` 头原样透传）。
//!
//! 实现：原生 tokio TCP（无额外依赖，与 `inference.rs` 同向；design D2 由 axum 调整为
//! 原生 TCP：本沙箱网络受限、避免拉新依赖、与 codebase 风格一致，且非流式单跳足够）。
//! 不链接任何 tng crate；以 tokio spawned task 托管，`stop` 时 abort 全部监听。

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// 对外绑定 host 候选（D1：默认仅本机；0.0.0.0 为用户显式 opt-in）。
pub const BIND_LOCALHOST: &str = "127.0.0.1";
pub const BIND_ANY: &str = "0.0.0.0";

/// 单条 ingress 的反代路由：对外绑定 + 对内 upstream（tng 内部 ingress 本地监听端口）。
#[derive(Clone, Debug)]
pub struct ProxyRoute {
    pub out_host: String,
    pub out_port: u16,
    pub internal_port: u16,
    /// 远端目标 host（转发 tng 内部 ingress 时用作 Host 头）：mapping 的 out.host /
    /// http_proxy 的 domain。须为非本机地址，避开 tng 的 recursion 检测。
    pub remote_host: String,
}

/// 一个对外监听器的运行句柄；`stop` 即停该监听。
pub struct ProxyListener {
    route: ProxyRoute,
    abort: oneshot::Sender<()>,
    join: JoinHandle<()>,
}

impl ProxyListener {
    /// 对外端点 `(host, port)`。
    pub fn endpoint(&self) -> (String, u16) {
        (self.route.out_host.clone(), self.route.out_port)
    }

    /// 停止该对外监听器并等待 task 退出。
    pub async fn stop(self) {
        let _ = self.abort.send(());
        let _ = self.join.await;
    }
}

/// 全批反代路由的运行句柄。
pub struct ProxyHandle {
    listeners: Vec<ProxyListener>,
}

impl ProxyHandle {
    /// 按启用路由顺序的对外端点列表（供 Tauri `proxy_endpoint` 暴露给前端）。
    pub fn endpoints(&self) -> Vec<(String, u16)> {
        self.listeners.iter().map(|l| l.endpoint()).collect()
    }

    /// 停止所有监听器并等待退出。
    pub async fn stop(self) {
        for l in self.listeners {
            l.stop().await;
        }
    }
}

/// 对每条 route 起一个对外监听器。任一绑定失败即整批失败并回滚已起的（fail-fast：
/// 不留 tng 在跑却缺对外入口的状态）。
pub async fn start_proxy(routes: Vec<ProxyRoute>) -> Result<ProxyHandle, String> {
    let mut listeners = Vec::with_capacity(routes.len());
    for route in routes {
        match start_one(route).await {
            Ok(l) => listeners.push(l),
            Err(e) => {
                for l in listeners {
                    l.stop().await;
                }
                return Err(e);
            }
        }
    }
    Ok(ProxyHandle { listeners })
}

async fn start_one(route: ProxyRoute) -> Result<ProxyListener, String> {
    let bind = format!("{}:{}", route.out_host, route.out_port);
    let listener = TcpListener::bind(&bind)
        .await
        .map_err(|e| format!("反代绑定 {bind} 失败: {e}"))?;
    let internal_port = route.internal_port;
    let remote_host = route.remote_host.clone();
    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = &mut abort_rx => break,
                res = listener.accept() => {
                    let (stream, _peer) = match res {
                        Ok(v) => v,
                        Err(_) => continue, // 单次 accept 失败不终止监听
                    };
                    let port = internal_port;
                    let rh = remote_host.clone();
                    tokio::spawn(async move {
                        let _ = handle_conn(stream, port, rh).await;
                    });
                }
            }
        }
    });
    Ok(ProxyListener {
        route,
        abort: abort_tx,
        join,
    })
}

const BODY_LIMIT: usize = 10 * 1024 * 1024; // 10 MiB（与 inference.rs 对齐）
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(60);

/// 处理一条客户端连接：读请求 → 注入/覆盖 `x-model` → 转发内部 ingress → 原样回传响应。
async fn handle_conn(
    mut client: TcpStream,
    internal_port: u16,
    remote_host: String,
) -> std::io::Result<()> {
    // 1. 读请求头（到 \r\n\r\n）
    let (buf, body_off) = match read_until_double_crlf(&mut client).await? {
        Some(x) => x,
        None => return Ok(()), // 客户端未发完整头即关闭
    };
    let head_str = String::from_utf8_lossy(&buf[..body_off]);
    let (method, path) = parse_request_line(&head_str).unwrap_or_default();
    let mut headers = parse_headers(&head_str);
    let content_length: Option<usize> =
        header_get(&headers, "content-length").and_then(|v| v.trim().parse().ok());

    // 2. 读 body（按 Content-Length；缺失则取已读到的；超限 413）
    let mut body: Vec<u8> = buf[body_off..].to_vec();
    if let Some(n) = content_length {
        if n > BODY_LIMIT {
            return write_simple_response(&mut client, 413, "Payload Too Large").await;
        }
        if body.len() < n {
            let mut tail = vec![0u8; n - body.len()];
            client.read_exact(&mut tail).await?;
            body.extend_from_slice(&tail);
        }
        body.truncate(n);
    }

    // 3. x-model：解析 body.model；含 model（字符串）则设/覆盖 x-model；无则不设
    if let Some(m) = parse_body_model(&body) {
        set_header(&mut headers, "x-model", &m);
    }

    // 4. 剥离 hop-by-hop 头；对 upstream 设 Connection: close。
    //    Host 须为远端目标（mapping 的 out.host / http_proxy 的 domain）：tng 内部 ingress
    //    把命中本机监听（如 127.0.0.1:internal_port）的 Host 判为递归、回 400
    //    "recursion is detected"。故改用非本机远端地址；remote_host 缺省（http_proxy 未配
    //    domain 的退化情形）退回原内部地址。
    strip_hop_by_hop(&mut headers);
    let host_value = if remote_host.is_empty() {
        format!("127.0.0.1:{internal_port}")
    } else {
        remote_host
    };
    set_header(&mut headers, "host", &host_value);
    set_header(&mut headers, "connection", "close");
    set_header(&mut headers, "content-length", &body.len().to_string());

    // 5. 转发到 upstream 127.0.0.1:<internal_port>
    let up = tokio::time::timeout(
        UPSTREAM_TIMEOUT,
        TcpStream::connect(("127.0.0.1", internal_port)),
    )
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "连接上游超时"))??;
    let (mut up_rd, mut up_wr) = up.into_split();

    let fwd = build_request_bytes(&method, &path, &headers, &body);
    up_wr.write_all(&fwd).await?;
    up_wr.flush().await?;

    // 6. 原样回传：把 upstream 字节透传给客户端，直到 upstream EOF（其对 upstream 发了
    //    Connection: close，响应完成后关闭；与 inference::http_request 读到 EOF 同法，非流式按此成帧）。
    let mut pipe = vec![0u8; 8192];
    loop {
        let n = tokio::time::timeout(UPSTREAM_TIMEOUT, up_rd.read(&mut pipe))
            .await
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "读上游超时"))??;
        if n == 0 {
            break;
        }
        client.write_all(&pipe[..n]).await?;
    }
    client.flush().await?;
    Ok(())
}

/// 读到 `\r\n\r\n`。返回 `(已读全部字节, body 起始偏移)`；偏移之后为可能已读到的 body 字节。
/// EOF 前未见到 `\r\n\r\n` 返回 `None`。
async fn read_until_double_crlf(
    stream: &mut TcpStream,
) -> std::io::Result<Option<(Vec<u8>, usize)>> {
    let mut buf = Vec::new();
    loop {
        if buf.len() > BODY_LIMIT {
            return Err(std::io::Error::other("请求头过大"));
        }
        let mut tmp = [0u8; 4096];
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(idx) = find_double_crlf(&buf) {
            return Ok(Some((buf, idx + 4)));
        }
    }
}

fn find_double_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// 解析请求行 `(method, path)`。如 `POST /v1 HTTP/1.1` → `("POST","/v1")`。
fn parse_request_line(head: &str) -> Option<(String, String)> {
    let line = head.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    Some((method, path))
}

type Headers = Vec<(String /*原始 key*/, String /*value*/)>;

fn parse_headers(head: &str) -> Headers {
    header_lines_after_request_line(head)
        .filter_map(|l| {
            let mut kv = l.splitn(2, ':');
            let k = kv.next()?.trim().to_string();
            if k.is_empty() {
                return None;
            }
            let v = kv.next().map(|x| x.trim().to_string()).unwrap_or_default();
            Some((k, v))
        })
        .collect()
}

fn header_lines_after_request_line(head: &str) -> impl Iterator<Item = &str> {
    let mut started = false;
    head.split('\n').filter_map(move |raw| {
        let l = raw.trim_end_matches('\r');
        if !started {
            started = true;
            return None;
        }
        if l.is_empty() {
            return None;
        }
        Some(l)
    })
}

fn header_get<'a>(h: &'a Headers, key: &str) -> Option<&'a str> {
    h.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

fn set_header(h: &mut Headers, key: &str, value: &str) {
    let existing_key = h
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(k, _)| k.clone());
    h.retain(|(k, _)| !k.eq_ignore_ascii_case(key));
    let stored = existing_key.unwrap_or_else(|| key.to_string());
    h.push((stored, value.to_string()));
}

fn strip_hop_by_hop(h: &mut Headers) {
    h.retain(|(k, _)| {
        !matches!(
            k.to_ascii_lowercase().as_str(),
            "connection"
                | "keep-alive"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "te"
                | "trailer"
                | "transfer-encoding"
                | "upgrade"
        )
    });
}

fn parse_body_model(body: &[u8]) -> Option<String> {
    if body.is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    // 仅当 model 是字符串（OpenAI 兼容形态）才注入；其余形态不设/覆盖。
    v.get("model")?.as_str().map(|s| s.to_string())
}

fn build_request_bytes(method: &str, path: &str, headers: &Headers, body: &[u8]) -> Vec<u8> {
    let mut s = format!("{method} {path} HTTP/1.1\r\n");
    for (k, v) in headers {
        s.push_str(&format!("{k}: {v}\r\n"));
    }
    s.push_str("\r\n");
    let mut out = s.into_bytes();
    out.extend_from_slice(body);
    out
}

async fn write_simple_response(
    client: &mut TcpStream,
    status: u16,
    reason: &str,
) -> std::io::Result<()> {
    let body = reason.as_bytes();
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    client.write_all(resp.as_bytes()).await?;
    client.write_all(body).await?;
    client.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::{Mutex, Notify};

    /// 起 mock upstream：读一行请求（到 \r\n\r\n + body），取出 `x-model` 头值，
    /// 回 200 + JSON，其 content 标注收到的 x-model。
    async fn mock_upstream(port: u16, received: Arc<Mutex<Option<String>>>, ready: Arc<Notify>) {
        let l = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        ready.notify_one();
        let (mut s, _) = l.accept().await.unwrap();
        let (buf, body_off) = read_until_double_crlf(&mut s).await.unwrap().unwrap();
        let head = String::from_utf8_lossy(&buf[..body_off]);
        let x_model = parse_headers(&head)
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("x-model"))
            .map(|(_, v)| v.clone());
        let _body_recvd = &buf[body_off..]; // body 字节（测试不做内容校验）
        *received.lock().await = x_model.clone();
        let echoed = x_model.unwrap_or_else(|| "<none>".to_string());
        let body = format!("{{\"got_x_model\":\"{echoed}\"}}");
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(resp.as_bytes()).await.unwrap();
        s.flush().await.unwrap();
    }

    async fn send_request(out_port: u16, headers: &[(&str, &str)], body: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", out_port)).await.unwrap();
        let mut req = format!(
            "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{out_port}\r\nContent-Length: {}\r\n",
            body.len()
        );
        for (k, v) in headers {
            req.push_str(&format!("{k}: {v}\r\n"));
        }
        req.push_str("\r\n");
        req.push_str(body);
        s.write_all(req.as_bytes()).await.unwrap();
        s.flush().await.unwrap();
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = tokio::time::timeout(Duration::from_secs(5), s.read(&mut buf))
                .await
                .unwrap()
                .unwrap();
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
        }
        String::from_utf8_lossy(&out).to_string()
    }

    async fn run_once(client_headers: &[(&str, &str)], body: &str) -> (String, Option<String>) {
        let up_port = unique_port();
        let out_port = unique_port();
        let received = Arc::new(Mutex::new(None));
        let ready = Arc::new(Notify::new());
        {
            let received = received.clone();
            let ready = ready.clone();
            tokio::spawn(async move {
                mock_upstream(up_port, received, ready).await;
            });
        }
        ready.notified().await;
        let handle = start_proxy(vec![ProxyRoute {
            out_host: BIND_LOCALHOST.to_string(),
            out_port,
            internal_port: up_port,
            remote_host: "10.0.0.1".to_string(),
        }])
        .await
        .unwrap();
        let resp = send_request(out_port, client_headers, body).await;
        handle.stop().await;
        let got = received.lock().await.clone();
        (resp, got)
    }

    fn unique_port() -> u16 {
        crate::config::pick_free_port().unwrap()
    }

    #[tokio::test]
    async fn injects_x_model_from_body_model() {
        let (resp, got) = run_once(
            &[
                ("Authorization", "Bearer key"),
                ("Content-Type", "application/json"),
            ],
            r#"{"model":"gpt-x","messages":[]}"#,
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        assert_eq!(got.as_deref(), Some("gpt-x"));
    }

    #[tokio::test]
    async fn overwrites_client_supplied_x_model_with_body_model() {
        let (resp, got) = run_once(
            &[
                ("Authorization", "Bearer key"),
                ("x-model", "spoof-by-client"),
            ],
            r#"{"model":"real-model","messages":[]}"#,
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        assert_eq!(got.as_deref(), Some("real-model"), "应被 body.model 覆盖");
    }

    #[tokio::test]
    async fn no_model_passes_through_existing_x_model_unchanged() {
        let (resp, got) = run_once(
            &[("Authorization", "Bearer key"), ("x-model", "client-value")],
            r#"{"messages":[]}"#,
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        assert_eq!(got.as_deref(), Some("client-value"));
    }

    #[tokio::test]
    async fn no_model_and_no_x_model_passes_through_none() {
        let (resp, got) = run_once(&[("Authorization", "Bearer key")], r#"{"messages":[]}"#).await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        assert_eq!(got, None);
    }

    #[tokio::test]
    async fn non_json_body_no_model_passes_through() {
        let (resp, got) = run_once(
            &[("Authorization", "Bearer key"), ("x-model", "keep-me")],
            "not-json-at-all",
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        assert_eq!(got.as_deref(), Some("keep-me"));
    }

    #[tokio::test]
    async fn response_relayed_verbatim() {
        let (resp, _) = run_once(
            &[("Authorization", "Bearer key")],
            r#"{"model":"m","messages":[]}"#,
        )
        .await;
        assert!(resp.contains("Connection: close"));
        assert!(
            resp.contains(r#""got_x_model":"m""#),
            "应原样回传 body: {resp}"
        );
    }
}
