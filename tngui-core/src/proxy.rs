//! tngui pre-TNG 反向代理：对外暴露推理入口，在转发前按 `body.model` 注入模型 path。
//!
//! 形态——tng 全包在内部：
//! - tng 的 ingress 本地监听端口由 tngui 在启动时选取空闲回环端口注入（见
//!   `config::prepare_config`），仅 `127.0.0.1` 可达、对用户隐藏不外配；
//! - tngui 自此进程内起 HTTP 反代对外（host 由 UI toggle 在 `127.0.0.1`/`0.0.0.0` 间
//!   切换、port 用户可配），把推理请求透传到 tng 内部 ingress，并把可用模型请求改写为
//!   `/models/{model-segment}{original-path}`（capi path 模型鉴权契约）。
//!
//! 行为：
//! - 完整反代：透传 method / query / 头 / body，响应原样回传。
//! - 对 `POST /v1/chat/completions`、`POST /v1/messages` 和无状态
//!   `POST /v1/responses`，解析 UTF-8 JSON object 顶层字符串 `model` 后生成
//!   单一路径 model segment。非法/缺失 model fail-closed。
//! - 不注入、不生成、不读取 `x-model`；body 字节原样保留。
//!
//! 实现：原生 tokio TCP（无额外依赖，与 `inference.rs` 同向；design D2 由 axum 调整为
//! 原生 TCP：本沙箱网络受限、避免拉新依赖、与 codebase 风格一致，且非流式单跳足够）。
//! 不链接任何 tng crate；以 tokio spawned task 托管，`stop` 时 abort 全部监听。

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
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
    /// 远端目标 host[:port]（转发 tng 内部 ingress 时用作 Host 头）：mapping 的
    /// out.host、http_proxy 的 domain（dst_filters 配了有效端口时拼为 `domain:port`——
    /// tng 的 http_proxy 上游目标跟随 Host 头 host 与端口，须带 dst 端口才能路由到
    /// 非 `:80` 的上游，如 https 的 443/30090）。须为非本机地址，避开 recursion 检测。
    pub remote_host: String,
    /// 模型发现 direct capi origin，如 `https://inference.cloud.misuan.com:443`。
    /// `None` 表示当前 ingress 无法得出有效模型发现目标。
    pub models_origin: Option<String>,
}

/// 本地反代诊断快照。字段是固定类别，不含任何动态 label。
#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
pub struct ProxyDiagnosticsSnapshot {
    pub proxy_running: bool,
    pub identity_valid_total: u64,
    pub identity_rejected_total: u64,
    pub payload_rejected_total: u64,
    pub discovery_success_total: u64,
    pub discovery_failure_total: u64,
    pub upstream_failure_total: u64,
}

/// 当前反代会话内累计的固定类别计数。
#[derive(Debug, Default)]
pub struct ProxyDiagnostics {
    identity_valid_total: AtomicU64,
    identity_rejected_total: AtomicU64,
    payload_rejected_total: AtomicU64,
    discovery_success_total: AtomicU64,
    discovery_failure_total: AtomicU64,
    upstream_failure_total: AtomicU64,
}

impl ProxyDiagnostics {
    fn increment_identity_valid(&self) {
        self.identity_valid_total.fetch_add(1, Ordering::Relaxed);
    }

    fn increment_identity_rejected(&self) {
        self.identity_rejected_total.fetch_add(1, Ordering::Relaxed);
    }

    fn increment_payload_rejected(&self) {
        self.payload_rejected_total.fetch_add(1, Ordering::Relaxed);
    }

    fn increment_discovery_success(&self) {
        self.discovery_success_total.fetch_add(1, Ordering::Relaxed);
    }

    fn increment_discovery_failure(&self) {
        self.discovery_failure_total.fetch_add(1, Ordering::Relaxed);
    }

    fn increment_upstream_failure(&self) {
        self.upstream_failure_total.fetch_add(1, Ordering::Relaxed);
    }

    /// Tauri 调用方在无句柄时使用的保守零值。
    pub fn conservative_snapshot(proxy_running: bool) -> ProxyDiagnosticsSnapshot {
        ProxyDiagnosticsSnapshot {
            proxy_running,
            identity_valid_total: 0,
            identity_rejected_total: 0,
            payload_rejected_total: 0,
            discovery_success_total: 0,
            discovery_failure_total: 0,
            upstream_failure_total: 0,
        }
    }

    fn snapshot(&self, proxy_running: bool) -> ProxyDiagnosticsSnapshot {
        ProxyDiagnosticsSnapshot {
            proxy_running,
            identity_valid_total: self.identity_valid_total.load(Ordering::Relaxed),
            identity_rejected_total: self.identity_rejected_total.load(Ordering::Relaxed),
            payload_rejected_total: self.payload_rejected_total.load(Ordering::Relaxed),
            discovery_success_total: self.discovery_success_total.load(Ordering::Relaxed),
            discovery_failure_total: self.discovery_failure_total.load(Ordering::Relaxed),
            upstream_failure_total: self.upstream_failure_total.load(Ordering::Relaxed),
        }
    }
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
    diagnostics: Arc<ProxyDiagnostics>,
}

impl ProxyHandle {
    /// 当前会话的本地诊断快照；不包含敏感请求内容或动态标签。
    pub fn diagnostics(&self) -> ProxyDiagnosticsSnapshot {
        self.diagnostics.snapshot(!self.listeners.is_empty())
    }

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
    let diagnostics = Arc::new(ProxyDiagnostics::default());
    let mut listeners = Vec::with_capacity(routes.len());
    for route in routes {
        match start_one(route, diagnostics.clone()).await {
            Ok(l) => listeners.push(l),
            Err(e) => {
                for l in listeners {
                    l.stop().await;
                }
                return Err(e);
            }
        }
    }
    Ok(ProxyHandle {
        listeners,
        diagnostics,
    })
}

async fn start_one(
    route: ProxyRoute,
    diagnostics: Arc<ProxyDiagnostics>,
) -> Result<ProxyListener, String> {
    let bind = format!("{}:{}", route.out_host, route.out_port);
    let listener = TcpListener::bind(&bind)
        .await
        .map_err(|e| format!("反代绑定 {bind} 失败: {e}"))?;
    let internal_port = route.internal_port;
    let remote_host = route.remote_host.clone();
    let models_origin = route.models_origin.clone();
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
                    let mo = models_origin.clone();
                    let dg = diagnostics.clone();
                    tokio::spawn(async move {
                        let _ = handle_conn(stream, port, rh, mo, dg).await;
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

/// 处理一条客户端连接：读请求 → 注入模型 path → 转发内部 ingress → 原样回传响应。
async fn handle_conn(
    mut client: TcpStream,
    internal_port: u16,
    remote_host: String,
    models_origin: Option<String>,
    diagnostics: Arc<ProxyDiagnostics>,
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

    // 2. 读 body（按 Content-Length；缺失则取已读到的；超限时先丢弃声明长度——
    //    不建立 upstream，也避免关闭套接字时未读数据触发 RST 掩盖 413）
    let mut body: Vec<u8> = buf[body_off..].to_vec();
    if let Some(n) = content_length {
        if n > BODY_LIMIT {
            diagnostics.increment_payload_rejected();
            let mut remaining = n.saturating_sub(body.len());
            let mut discard = [0u8; 8192];
            while remaining > 0 {
                let take = remaining.min(discard.len());
                client.read_exact(&mut discard[..take]).await?;
                remaining -= take;
            }
            return write_simple_response(&mut client, 413, "Payload Too Large").await;
        }
        if body.len() < n {
            let mut tail = vec![0u8; n - body.len()];
            client.read_exact(&mut tail).await?;
            body.extend_from_slice(&tail);
        }
        body.truncate(n);
    }

    // 3.1 direct capi model discovery exception：精确 GET /v1/models 不进入 tng。
    if is_exact_model_discovery(&method, &path) {
        return match models_origin.as_deref() {
            Some(origin) => match direct_model_request(origin, &path, &headers).await {
                Ok(response) => {
                    if (200..300).contains(&response.status) {
                        diagnostics.increment_discovery_success();
                    } else {
                        diagnostics.increment_discovery_failure();
                    }
                    write_direct_response(&mut client, response).await
                }
                Err(message) => {
                    diagnostics.increment_discovery_failure();
                    write_model_discovery_failure(&mut client, &format!("请求失败: {message}"))
                        .await
                }
            },
            None => {
                diagnostics.increment_discovery_failure();
                write_model_discovery_failure(
                    &mut client,
                    "当前 ingress 未提供有效的 capi 模型发现地址",
                )
                .await
            }
        };
    }

    // 3. pre-TNG 模型 path：只从 supported endpoint 的原始 body 语义决定 path。
    //    body 本身永不改写；`x-model` 与模型身份解耦，不做读取、覆盖或删除决策。
    let path = match resolve_model_path(&method, &path, &body) {
        ModelOverride::Unsupported => path,
        ModelOverride::Invalid => {
            diagnostics.increment_identity_rejected();
            return write_simple_response(&mut client, 400, "Bad Request").await;
        }
        ModelOverride::Path(v) => {
            diagnostics.increment_identity_valid();
            v
        }
    };

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
    let up = match tokio::time::timeout(
        UPSTREAM_TIMEOUT,
        TcpStream::connect(("127.0.0.1", internal_port)),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        Ok(Err(error)) => {
            diagnostics.increment_upstream_failure();
            return Err(error.into());
        }
        Err(_) => {
            diagnostics.increment_upstream_failure();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "连接上游超时",
            ));
        }
    };
    let (mut up_rd, mut up_wr) = up.into_split();

    let fwd = build_request_bytes(&method, &path, &headers, &body);
    if let Err(error) = up_wr.write_all(&fwd).await {
        diagnostics.increment_upstream_failure();
        return Err(error);
    }
    if let Err(error) = up_wr.flush().await {
        diagnostics.increment_upstream_failure();
        return Err(error);
    }

    // 6. 原样回传：把 upstream 字节逐块透传给客户端，直到 upstream EOF（其对 upstream 发了
    //    Connection: close，响应完成后关闭）。逐块写出即流式——SSE 响应经此逐 token 到达客户端。
    let mut pipe = vec![0u8; 8192];
    loop {
        let n = match tokio::time::timeout(UPSTREAM_TIMEOUT, up_rd.read(&mut pipe)).await {
            Ok(Ok(n)) => n,
            Ok(Err(error)) => {
                diagnostics.increment_upstream_failure();
                return Err(error);
            }
            Err(_) => {
                diagnostics.increment_upstream_failure();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "读上游超时",
                ));
            }
        };
        if n == 0 {
            break;
        }
        if let Err(error) = client.write_all(&pipe[..n]).await {
            return Err(error);
        }
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

/// 支持模型 path 注入的 endpoint。只匹配去掉 query 后的完整请求 path——
/// `/v1/chat/completions/foo` 等非精确匹配不注入模型前缀；responseId
/// 寻址接口不纳入模型化请求，由上游/edge 的 fail-closed 行为处理。
fn is_supported_model_path(path_with_query: &str) -> bool {
    let path = path_with_query
        .split_once('?')
        .map(|(p, _)| p)
        .unwrap_or(path_with_query);
    matches!(
        path,
        "/v1/chat/completions" | "/v1/messages" | "/v1/responses"
    )
}

fn is_supported_model_method(method: &str) -> bool {
    method == "POST"
}

/// 上层 path 注入决定：supported endpoint 上的任何无效 model 语义都阻断；
/// 非 supported endpoint 保持原 path。
#[derive(Debug, PartialEq, Eq)]
enum ModelOverride {
    Unsupported,
    Invalid,
    Path(String),
}

/// `body.model` → pre-TNG path。supported endpoint 必须产出有效路径；其余路径
/// 不产生模型语义。
fn resolve_model_path(method: &str, path_with_query: &str, body: &[u8]) -> ModelOverride {
    if !is_supported_model_method(method) || !is_supported_model_path(path_with_query) {
        return ModelOverride::Unsupported;
    }
    let model = match extract_body_model(body) {
        Some(v) => v,
        None => return ModelOverride::Invalid,
    };
    let (raw_path, query) = path_with_query
        .split_once('?')
        .unwrap_or((path_with_query, ""));
    let prefix = format!("/models/{}", encode_model_segment(&model));
    ModelOverride::Path(if query.is_empty() {
        prefix + raw_path
    } else {
        prefix + raw_path + "?" + query
    })
}

/// 解析 UTF-8 JSON object 顶层字符串 `model`；字符串身份保持原样，不做 trim。
fn extract_body_model(body: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    if !v.is_object() {
        return None;
    }
    let model = v.get("model")?.as_str()?.to_string();
    if model.is_empty() { None } else { Some(model) }
}

/// 模型名作为**单一路径 segment** 编码：只保留 RFC3986 unreserved
/// 字母数字与 `-._~`，其余 UTF-8 字节（含 `/`、`%`、空格、控制字符、多字节）转成 `%XX`。
fn encode_model_segment(model: &str) -> String {
    let mut encoded = String::new();
    for &b in model.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            encoded.push(b as char);
        } else {
            encoded.extend(format!("%{b:02X}").chars());
        }
    }
    encoded
}

/// 精确 `GET /v1/models` 判定：只匹配 query 之前的完整 path。
fn is_exact_model_discovery(method: &str, path_with_query: &str) -> bool {
    if method != "GET" {
        return false;
    }
    path_with_query
        .split_once('?')
        .map(|(p, _)| p)
        .unwrap_or(path_with_query)
        == "/v1/models"
}

/// 直连 capi 的模型发现响应。保留状态、安全可回传的响应头与响应体字节。
struct DirectModelResponse {
    status: u16,
    reason: &'static str,
    headers: HeaderMap,
    body: Vec<u8>,
}

fn is_model_request_header(key: &str) -> bool {
    !matches!(
        key.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "transfer-encoding"
            | "upgrade"
            | "proxy-authorization"
            | "host"
            | "content-length"
            | "x-model"
    )
}

async fn direct_model_request(
    origin: &str,
    path: &str,
    headers: &Headers,
) -> Result<DirectModelResponse, String> {
    let url = reqwest::Url::parse(&format!("{origin}{path}"))
        .map_err(|e| format!("capi 模型发现地址无效: {e}"))?;
    let mut request_headers = HeaderMap::new();
    for (key, value) in headers {
        if !is_model_request_header(key) {
            continue;
        }
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|e| format!("模型发现请求头无效: {key} {e}"))?;
        let val =
            HeaderValue::from_str(value).map_err(|e| format!("模型发现请求头值无效: {key} {e}"))?;
        request_headers.insert(name, val);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("构建模型发现客户端失败: {e}"))?;
    let response = client
        .get(url)
        .headers(request_headers)
        .send()
        .await
        .map_err(|e| format!("请求 capi 模型列表失败: {e}"))?;
    let status = response.status().as_u16();
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        502 => "Bad Gateway",
        _ => "",
    };
    let response_headers = response.headers().clone();
    let body = response
        .bytes()
        .await
        .map_err(|e| format!("读取 capi 模型列表响应失败: {e}"))?
        .to_vec();
    Ok(DirectModelResponse {
        status,
        reason,
        headers: response_headers,
        body,
    })
}

async fn write_model_discovery_failure(
    client: &mut TcpStream,
    message: &str,
) -> std::io::Result<()> {
    let body = format!("模型发现失败: {message}");
    let response = format!(
        "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    client.write_all(response.as_bytes()).await?;
    client.flush().await
}

async fn write_direct_response(
    client: &mut TcpStream,
    response: DirectModelResponse,
) -> std::io::Result<()> {
    let reason = if response.reason.is_empty() {
        "Reason"
    } else {
        response.reason
    };
    let mut out = format!("HTTP/1.1 {} {}\r\n", response.status, reason);
    for (name, value) in response.headers.iter() {
        let lower = name.as_str().to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "transfer-encoding" | "connection" | "content-length"
        ) {
            continue;
        }
        if let Ok(value) = std::str::from_utf8(value.as_bytes()) {
            out.push_str(&format!("{}: {}\r\n", name.as_str(), value));
        }
    }
    out.push_str(&format!(
        "content-length: {}\r\nconnection: close\r\n\r\n",
        response.body.len()
    ));
    client.write_all(out.as_bytes()).await?;
    client.write_all(&response.body).await?;
    client.flush().await?;
    Ok(())
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

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct MockReceived {
        method: String,
        path: String,
        headers: Headers,
        body: Vec<u8>,
    }

    /// 起 mock upstream：记录请求行与 body，回应插件式稳定响应以验证透传。
    async fn mock_upstream(
        port: u16,
        received: Arc<Mutex<Option<MockReceived>>>,
        ready: Arc<Notify>,
    ) {
        let l = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        ready.notify_one();
        let (mut s, _) = l.accept().await.unwrap();
        let (buf, body_off) = read_until_double_crlf(&mut s).await.unwrap().unwrap();
        let head = String::from_utf8_lossy(&buf[..body_off]);
        let (method, path) = parse_request_line(&head).unwrap();
        let body_recvd = buf[body_off..].to_vec();
        *received.lock().await = Some(MockReceived {
            method,
            path: path.clone(),
            headers: parse_headers(&head),
            body: body_recvd,
        });
        let body = r#"{"ok":true,"path":"PATH_PLACEHOLDER"}"#.replace("PATH_PLACEHOLDER", &path);
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(resp.as_bytes()).await.unwrap();
        s.flush().await.unwrap();
    }

    async fn run_once_full(
        client_headers: &[(&str, &str)],
        body: Vec<u8>,
    ) -> (String, Option<MockReceived>) {
        run_once_at("POST", "/v1/chat/completions", client_headers, body).await
    }

    async fn run_once_at(
        method: &str,
        path: &str,
        client_headers: &[(&str, &str)],
        body: Vec<u8>,
    ) -> (String, Option<MockReceived>) {
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
            models_origin: None,
        }])
        .await
        .unwrap();
        let resp = send_request_bytes(out_port, method, path, client_headers, body).await;
        handle.stop().await;
        let got = received.lock().await.clone();
        (resp, got)
    }

    async fn send_request_bytes(
        out_port: u16,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: Vec<u8>,
    ) -> String {
        let s = TcpStream::connect(("127.0.0.1", out_port)).await.unwrap();
        let req_head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{out_port}\r\nContent-Length: {}\r\n",
            body.len()
        );
        let mut req = req_head.into_bytes();
        for (k, v) in headers {
            req.extend_from_slice(format!("{k}: {v}\r\n").as_bytes());
        }
        req.extend_from_slice(b"\r\n");
        req.extend_from_slice(&body);
        // fail-closed 响应可能在请求 body 写完前发出（尤其是超限时）。
        // 分离读写，模拟普通 HTTP client 可收到 early response 的行为。
        let (mut rd, mut wr) = s.into_split();
        let write_task = tokio::spawn(async move {
            wr.write_all(&req).await?;
            wr.flush().await?;
            Ok::<(), std::io::Error>(())
        });
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = tokio::time::timeout(Duration::from_secs(5), rd.read(&mut buf))
                .await
                .unwrap()
                .unwrap();
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
        }
        write_task.await.unwrap().unwrap();
        String::from_utf8_lossy(&out).to_string()
    }

    fn unique_port() -> u16 {
        crate::config::pick_free_port().unwrap()
    }

    #[test]
    fn encode_model_segment_preserves_unreserved() {
        assert_eq!(encode_model_segment("model-a.b_c~1"), "model-a.b_c~1");
    }

    #[test]
    fn encode_model_segment_encodes_single_segment_characters_and_unicode() {
        assert_eq!(encode_model_segment("provider/model"), "provider%2Fmodel");
        assert_eq!(encode_model_segment("100%"), "100%25");
        assert_eq!(encode_model_segment("模型 A"), "%E6%A8%A1%E5%9E%8B%20A");
        assert_eq!(encode_model_segment("a\t?&"), "a%09%3F%26");
    }

    #[test]
    fn resolve_model_path_preserves_model_whitespace_and_query() {
        let got = resolve_model_path(
            "POST",
            "/v1/chat/completions?trace=1",
            br#"{"model":" model-a ","messages":[]}"#,
        );
        assert_eq!(
            got,
            ModelOverride::Path("/models/%20model-a%20/v1/chat/completions?trace=1".to_string(),)
        );
    }

    #[test]
    fn resolve_model_path_encodes_provider_slash() {
        let got = resolve_model_path("POST", "/v1/messages", br#"{"model":"provider/model"}"#);
        assert_eq!(
            got,
            ModelOverride::Path("/models/provider%2Fmodel/v1/messages".to_string())
        );
    }

    #[test]
    fn diagnostics_are_fixed_process_local_categories() {
        let diagnostics = ProxyDiagnostics::default();
        diagnostics.increment_identity_valid();
        diagnostics.increment_identity_rejected();
        diagnostics.increment_identity_rejected();
        diagnostics.increment_payload_rejected();
        diagnostics.increment_discovery_success();
        diagnostics.increment_discovery_failure();
        diagnostics.increment_upstream_failure();
        let snapshot = diagnostics.snapshot(true);
        assert_eq!(
            snapshot,
            ProxyDiagnosticsSnapshot {
                proxy_running: true,
                identity_valid_total: 1,
                identity_rejected_total: 2,
                payload_rejected_total: 1,
                discovery_success_total: 1,
                discovery_failure_total: 1,
                upstream_failure_total: 1,
            }
        );
    }

    #[test]
    fn resolve_model_path_rejects_model_semantics_without_forward() {
        for body in [
            b"{}".as_slice(),
            br#"{"model":""}"#,
            br#"{"model":1}"#,
            b"[1,2]",
            b"not-json",
            b"\xEF\xBB\xBF {\"model\":\"m\"}",
        ] {
            assert_eq!(
                resolve_model_path("POST", "/v1/chat/completions", body),
                ModelOverride::Invalid
            );
            assert_eq!(
                resolve_model_path("POST", "/v1/responses", body),
                ModelOverride::Invalid
            );
        }
        for target in [
            "/v1/completions",
            "/v1/chat/completions/extra",
            "/models/m/v1/messages",
        ] {
            assert_eq!(
                resolve_model_path("POST", target, br#"{"model":"m"}"#),
                ModelOverride::Unsupported
            );
        }
        assert_eq!(
            resolve_model_path("GET", "/v1/chat/completions", br#"{"model":"m"}"#),
            ModelOverride::Unsupported
        );
    }

    #[test]
    fn resolve_model_path_supports_responses_with_query() {
        let body = br#"{"model":"model-a","input":"ascii input"}"#;
        assert_eq!(
            resolve_model_path("POST", "/v1/responses?trace=1", body),
            ModelOverride::Path("/models/model-a/v1/responses?trace=1".to_string())
        );
    }

    #[test]
    fn resolve_model_path_excludes_responses_state_control_paths() {
        for (method, path) in [
            ("GET", "/v1/responses/resp-123"),
            ("POST", "/v1/responses/resp-123/cancel"),
            ("DELETE", "/v1/responses/resp-123"),
            ("POST", "/v1/responses/resp-123"),
        ] {
            assert_eq!(
                resolve_model_path(method, path, br#"{"model":"m"}"#),
                ModelOverride::Unsupported,
                "{method} {path}"
            );
        }
        assert_eq!(
            resolve_model_path("GET", "/v1/responses", br#"{"model":"m"}"#),
            ModelOverride::Unsupported
        );
    }

    async fn start_capi_mock(received: Arc<Mutex<Option<MockReceived>>>) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let (buf, body_off) = read_until_double_crlf(&mut stream).await.unwrap().unwrap();
            let head = String::from_utf8_lossy(&buf[..body_off]);
            let (method, path) = parse_request_line(&head).unwrap();
            received.lock().await.replace(MockReceived {
                method,
                path: path.clone(),
                headers: parse_headers(&head),
                body: buf[body_off..].to_vec(),
            });
            let body = r#"{"object":"list","data":[{"id":"model-a"}]}"#.to_string();
            let response = format!(
                "HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: {}
Connection: close

{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.flush().await.unwrap();
        });
        port
    }

    #[test]
    fn exact_model_discovery_match_and_non_match() {
        assert!(is_exact_model_discovery("GET", "/v1/models"));
        assert!(is_exact_model_discovery("GET", "/v1/models?trace=1"));
        assert!(!is_exact_model_discovery("GET", "/v1/models/other"));
        assert!(!is_exact_model_discovery("POST", "/v1/models"));
        assert!(!is_model_request_header("x-model"));
        assert!(is_model_request_header("Authorization"));
        assert!(is_model_request_header("x-api-key"));
    }

    #[tokio::test]
    async fn non_exact_model_discovery_paths_go_to_existing_upstream() {
        for (method, path) in [("POST", "/v1/models"), ("GET", "/v1/models/other")] {
            let (response, received) = run_once_at(method, path, &[], vec![]).await;
            assert!(
                response.starts_with("HTTP/1.1 200"),
                "{method} {path} response={response}"
            );
            let received = received.expect("upstream should receive request");
            assert_eq!(received.method, method);
            assert_eq!(received.path, path);
        }
    }

    #[tokio::test]
    async fn model_discovery_directly_reaches_capi_and_not_tng() {
        let received = Arc::new(Mutex::new(None));
        let capi_port = start_capi_mock(received.clone()).await;
        let proxy_port = unique_port();
        let handle = start_proxy(vec![ProxyRoute {
            out_host: BIND_LOCALHOST.to_string(),
            out_port: proxy_port,
            internal_port: 1,
            remote_host: "10.0.0.1".to_string(),
            models_origin: Some(format!("http://127.0.0.1:{capi_port}")),
        }])
        .await
        .unwrap();
        let response = send_request_bytes(
            proxy_port,
            "GET",
            "/v1/models?trace=1",
            &[
                ("Authorization", "Bearer key"),
                ("x-api-key", "api-key"),
                ("x-model", "ignored-model"),
            ],
            vec![],
        )
        .await;
        assert!(response.starts_with("HTTP/1.1 200"), "response={response}");
        assert!(response.contains("model-a"));
        let got = received
            .lock()
            .await
            .clone()
            .expect("capi should receive request");
        assert_eq!(got.method, "GET");
        assert_eq!(got.path, "/v1/models?trace=1");
        assert!(
            got.headers
                .iter()
                .any(|(k, v)| k == "authorization" && v == "Bearer key")
        );
        assert!(
            got.headers
                .iter()
                .any(|(k, v)| k == "x-api-key" && v == "api-key")
        );
        assert!(
            !got.headers
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case("x-model"))
        );
        assert_eq!(
            handle.diagnostics(),
            ProxyDiagnosticsSnapshot {
                proxy_running: true,
                identity_valid_total: 0,
                identity_rejected_total: 0,
                payload_rejected_total: 0,
                discovery_success_total: 1,
                discovery_failure_total: 0,
                upstream_failure_total: 0,
            }
        );
    }

    #[tokio::test]
    async fn unreachable_models_origin_returns_explicit_failure() {
        let capi_port = unique_port();
        let out_port = unique_port();
        let handle = start_proxy(vec![ProxyRoute {
            out_host: BIND_LOCALHOST.to_string(),
            out_port,
            internal_port: 1,
            remote_host: "10.0.0.1".to_string(),
            models_origin: Some(format!("http://127.0.0.1:{capi_port}")),
        }])
        .await
        .unwrap();
        let response = send_request_bytes(out_port, "GET", "/v1/models", &[], vec![]).await;
        assert!(response.starts_with("HTTP/1.1 502"), "response={response}");
        assert!(
            response.contains("请求 capi 模型列表失败"),
            "response={response}"
        );
        assert_eq!(handle.diagnostics().discovery_failure_total, 1);
        handle.stop().await;
    }

    #[tokio::test]
    async fn model_discovery_without_origin_returns_explicit_failure() {
        let out_port = unique_port();
        let handle = start_proxy(vec![ProxyRoute {
            out_host: BIND_LOCALHOST.to_string(),
            out_port,
            internal_port: 1,
            remote_host: "10.0.0.1".to_string(),
            models_origin: None,
        }])
        .await
        .unwrap();
        let response = send_request_bytes(out_port, "GET", "/v1/models", &[], vec![]).await;
        assert!(response.starts_with("HTTP/1.1 502"), "response={response}");
        assert!(response.contains("当前 ingress 未提供有效的 capi 模型发现地址"));
        assert_eq!(handle.diagnostics().discovery_failure_total, 1);
        handle.stop().await;
    }
    #[tokio::test]
    async fn proxy_diagnostics_snapshot_classifies_exact_model_requests() {
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
            models_origin: None,
        }])
        .await
        .unwrap();

        // Supported endpoint with a whitespace model identity: percent-encode
        // it as one segment and keep the request body untouched.
        let response = send_request_bytes(
            out_port,
            "POST",
            "/v1/chat/completions",
            &[],
            br#"{"model":" model-a ","messages":[]}"#.to_vec(),
        )
        .await;
        assert!(response.starts_with("HTTP/1.1 200"), "response={response}");
        let got = received.lock().await.clone().expect("valid path forwarded");
        assert_eq!(got.path, "/models/%20model-a%20/v1/chat/completions");
        assert_eq!(got.body, br#"{"model":" model-a ","messages":[]}"#.to_vec());
        assert_eq!(
            handle.diagnostics(),
            ProxyDiagnosticsSnapshot {
                proxy_running: true,
                identity_valid_total: 1,
                identity_rejected_total: 0,
                payload_rejected_total: 0,
                discovery_success_total: 0,
                discovery_failure_total: 0,
                upstream_failure_total: 0,
            }
        );

        let response = send_request_bytes(
            out_port,
            "POST",
            "/v1/chat/completions",
            &[],
            b"{}".to_vec(),
        )
        .await;
        assert!(response.starts_with("HTTP/1.1 400"), "response={response}");

        let response = send_request_bytes(
            out_port,
            "POST",
            "/v1/chat/completions",
            &[],
            vec![b' '; BODY_LIMIT + 1],
        )
        .await;
        assert!(response.starts_with("HTTP/1.1 413"), "response={response}");

        let snapshot = handle.diagnostics();
        assert_eq!(snapshot.identity_valid_total, 1);
        assert_eq!(snapshot.identity_rejected_total, 1);
        assert_eq!(snapshot.payload_rejected_total, 1);
        assert_eq!(snapshot.discovery_success_total, 0);
        assert_eq!(snapshot.discovery_failure_total, 0);
        assert_eq!(snapshot.upstream_failure_total, 0);
        handle.stop().await;
    }

    #[tokio::test]
    async fn upstream_connect_failure_bumps_upstream_category() {
        let out_port = unique_port();
        let internal_port = unique_port();
        let handle = start_proxy(vec![ProxyRoute {
            out_host: BIND_LOCALHOST.to_string(),
            out_port,
            internal_port,
            remote_host: "10.0.0.1".to_string(),
            models_origin: None,
        }])
        .await
        .unwrap();
        let response = send_request_bytes(
            out_port,
            "POST",
            "/v1/chat/completions",
            &[],
            br#"{"model":"m"}"#.to_vec(),
        )
        .await;
        // Upstream failure may close before a complete response is readable.
        assert!(response.is_empty() || !response.starts_with("HTTP/1.1 2"));
        assert_eq!(handle.diagnostics().upstream_failure_total, 1);
        handle.stop().await;
    }

    #[tokio::test]
    async fn injects_model_path_and_preserves_query_body_credentials() {
        let json = br#"{"model":" model-a ", "messages":[]}"#;
        let (resp, got) = run_once_at(
            "POST",
            "/v1/chat/completions?trace=1",
            &[
                ("Authorization", "Bearer key"),
                ("x-api-key", "another-key"),
                ("Content-Type", "application/json"),
            ],
            json.to_vec(),
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        assert!(resp.contains(r#""ok":true"#), "resp={resp}");
        let got = got.expect("upstream should receive request");
        assert_eq!(got.method, "POST");
        assert_eq!(
            got.path,
            "/models/%20model-a%20/v1/chat/completions?trace=1"
        );
        assert_eq!(got.body, json);
    }

    /// 直接反代客户端没有调试页功能开关参数；同一原始 body 在两次调用间必须字节一致。
    #[tokio::test]
    async fn direct_client_body_is_identity_feature_invariant() {
        let raw_body =
            r#"{"model":"direct-model","messages":[{"role":"user","content":"直接客户端原文"}]}"#
                .as_bytes();
        let mut received_bodies = Vec::new();
        for _feature_state in ["disabled", "enabled"] {
            let (resp, got) =
                run_once_full(&[("Authorization", "Bearer direct-key")], raw_body.to_vec()).await;
            assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
            let got = got.expect("upstream should receive request");
            assert_eq!(got.path, "/models/direct-model/v1/chat/completions");
            assert!(
                !got.headers
                    .iter()
                    .any(|(key, _)| key.eq_ignore_ascii_case("x-tngui-identity")),
                "直接反代请求不得新增身份专用头"
            );
            received_bodies.push(got.body);
        }
        assert_eq!(received_bodies, vec![raw_body.to_vec(), raw_body.to_vec()]);
    }

    #[tokio::test]
    async fn injects_anthropic_model_path_and_keeps_x_api_key() {
        let json = br#"{"model":"provider/model"}"#;
        let (resp, got) = run_once_at(
            "POST",
            "/v1/messages",
            &[("x-api-key", "another-key")],
            json.to_vec(),
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        let got = got.unwrap();
        assert_eq!(got.path, "/models/provider%2Fmodel/v1/messages");
        assert_eq!(got.body, json);
    }

    #[tokio::test]
    async fn injects_responses_model_path_and_preserves_payload() {
        let json = br#"{"model":"model-a","input":"\u4f60\u597d"}"#;
        let (resp, got) = run_once_at(
            "POST",
            "/v1/responses?trace=1",
            &[
                ("Authorization", "Bearer key"),
                ("x-api-key", "another-key"),
                ("Content-Type", "application/json"),
            ],
            json.to_vec(),
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        let got = got.expect("upstream should receive request");
        assert_eq!(got.method, "POST");
        assert_eq!(got.path, "/models/model-a/v1/responses?trace=1");
        assert_eq!(got.body, json);
        assert!(
            got.headers
                .iter()
                .any(|(k, _v)| k.eq_ignore_ascii_case("authorization"))
                && got
                    .headers
                    .iter()
                    .any(|(k, _v)| k.eq_ignore_ascii_case("x-api-key"))
        );
    }

    #[tokio::test]
    async fn client_x_model_does_not_affect_model_path() {
        let json = br#"{"model":"real-model","messages":[]}"#;
        let (resp, got) = run_once_full(
            &[
                ("Authorization", "Bearer key"),
                ("x-model", "spoof-by-client"),
            ],
            json.to_vec(),
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        let got = got.unwrap();
        assert_eq!(got.path, "/models/real-model/v1/chat/completions");
        assert_eq!(got.body, json);
    }

    #[tokio::test]
    async fn unsupported_path_has_no_model_semantics() {
        let (resp, got) = run_once_at(
            "POST",
            "/v1/completions",
            &[("Authorization", "Bearer key")],
            br#"{"model":"m"}"#.to_vec(),
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        let got = got.unwrap();
        assert_eq!(got.path, "/v1/completions");
    }

    #[tokio::test]
    async fn invalid_model_fails_closed_with_400() {
        for body in [
            b"{}".as_slice(),
            b"{\"messages\":[]}",
            b"{\"model\":1}",
            b"[1,2,3]",
            b"not-json",
            b"\xEF\xBB\xBF {\"model\":\"m\"}",
        ] {
            let (resp, got) = run_once_full(
                &[("Authorization", "Bearer key"), ("x-api-key", "key")],
                body.to_vec(),
            )
            .await;
            assert!(
                resp.starts_with("HTTP/1.1 400"),
                "body={:?} resp={resp}",
                body
            );
            assert!(got.is_none(), "invalid request must not reach upstream");
        }
    }

    #[tokio::test]
    async fn oversized_body_fails_closed_with_413() {
        let body = vec![b' '; BODY_LIMIT + 1];
        let (resp, got) = run_once_full(&[("Authorization", "Bearer key")], body).await;
        assert!(resp.starts_with("HTTP/1.1 413"), "resp={resp}");
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn response_relayed_verbatim() {
        let (resp, _) = run_once_full(
            &[("Authorization", "Bearer key")],
            br#"{"model":"m","messages":[]}"#.to_vec(),
        )
        .await;
        assert!(resp.starts_with("HTTP/1.1 200"), "resp={resp}");
        assert!(resp.contains("Connection: close"));
        assert!(resp.contains(r#""ok":true"#), "resp={resp}");
    }
}
