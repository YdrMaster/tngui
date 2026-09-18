//! 密态推理请求：通过 tngui 反向代理对外端点发送 OpenAI 兼容的流式 POST 请求。
//!
//! `send_inference_stream` 是普通 OpenAI 客户端：仅带 `Authorization: Bearer` + JSON
//! body（`{model, messages, stream: true, reasoning_effort}`）POST 到
//! `127.0.0.1:<port>`——`port` 调用方传的是 tngui 反代对外端口（`launch_tng` 启动反
//! 代、`proxy_endpoint` 命令暴露）；`body.model` 交给反代解析，并由 pre-TNG proxy
//! 改写模型 path，此处不改写 path、也绝不注入 `x-model`。流式：POST
//! /v1/chat/completions，响应为 OpenAI 兼容 SSE（`data: {...chunk...}` 逐事件、
//! `data: [DONE]` 终止）；chunked 帧增量剥除，每节非空
//! `choices[0].delta.reasoning` / `choices[0].delta.content` 按类型回调 `on_delta`，
//! 不等整包收齐。

use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// 响应累计上限（头+体裸字节）。超过即失败，防异常流无限累积。
const RESPONSE_LIMIT: usize = 10 * 1024 * 1024;

/// OpenAI compatible chat message 的受限角色集合。命令边界只接受 user / assistant。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InferenceRole {
    User,
    Assistant,
}

/// 思考强度。默认值为 medium，与 GUI 默认“中”保持一致。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InferenceEffort {
    None,
    Low,
    #[default]
    Medium,
    High,
}

/// 发送端 OpenAI compatible 消息。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct InferenceMessage {
    pub role: InferenceRole,
    pub content: String,
}

/// SSE 增量类型。vLLM 0.26 thinking 模型使用 `delta.reasoning`，最终回答为
/// `delta.content`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InferenceDeltaKind {
    Reasoning,
    Content,
}

/// 推送给 UI 的 typed SSE 增量。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct InferenceDelta {
    pub kind: InferenceDeltaKind,
    pub text: String,
}

/// 流式请求的命令层结果。Stopped 是用户主动取消的成功结果，不是网络错误。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InferenceStreamOutcome {
    Completed,
    Stopped,
}

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

/// 单批 `IncrementalDechunker::feed` 的解码产出。
#[derive(Debug, Default)]
struct DechunkFeed {
    /// 本批解码出的 chunk 数据（可能只是某个 chunk 的前半段）。
    data: Vec<u8>,
    /// 是否已见到终帧（0 尺寸行）；其后 trailer 一律忽略。
    finished: bool,
}

/// RFC 7230 chunked 增量解码器（忽略 trailer）。任意网络分片喂入即可，只消费
/// 完整可判定的部分；残帧留在缓冲等下一批字节。帧错误显式返回 Err。
#[derive(Debug)]
struct IncrementalDechunker {
    buf: Vec<u8>,
    /// `false`：等待尺寸行；`true`：帧体/帧尾收集中，剩余字节数在 `remaining`。
    in_body: bool,
    remaining: usize,
    finished: bool,
}

impl IncrementalDechunker {
    fn new() -> Self {
        Self {
            buf: Vec::new(),
            in_body: false,
            remaining: 0,
            finished: false,
        }
    }

    fn feed(&mut self, bytes: &[u8]) -> Result<DechunkFeed, String> {
        if self.finished {
            // 终帧后的 trailer/杂字节忽略。
            return Ok(DechunkFeed::default());
        }
        self.buf.extend_from_slice(bytes);
        let mut out = DechunkFeed::default();
        loop {
            if !self.in_body {
                // 尺寸行必须有 CRLF 才能解析；过长说明不是合法帧，尽早失败。
                let Some(rel) = self.buf.windows(2).position(|w| w == b"\r\n") else {
                    if self.buf.len() > 1024 {
                        return Err("chunked 尺寸行过长".to_string());
                    }
                    break;
                };
                let line = std::str::from_utf8(&self.buf[..rel])
                    .map_err(|e| format!("chunked 尺寸行非 UTF-8: {e}"))?
                    .to_string();
                let size_str = line.split(';').next().unwrap_or("").trim();
                let size = usize::from_str_radix(size_str, 16)
                    .map_err(|_| format!("chunked 尺寸行非法: {line:?}"))?;
                self.buf.drain(..rel + 2);
                if size == 0 {
                    self.finished = true;
                    out.finished = true;
                    break;
                }
                self.in_body = true;
                self.remaining = size;
            }

            // 帧体：有多少转发多少（SSE 层自缓冲），尽量不等整帧收齐。
            let take = self.remaining.min(self.buf.len());
            out.data.extend_from_slice(&self.buf[..take]);
            self.buf.drain(..take);
            self.remaining -= take;

            if self.remaining > 0 {
                break; // 帧体未到齐
            }
            // 帧尾 CRLF。
            if self.buf.len() < 2 {
                break;
            }
            if &self.buf[..2] != b"\r\n" {
                return Err("chunked 帧尾缺少 CRLF".to_string());
            }
            self.buf.drain(..2);
            self.in_body = false;
        }
        Ok(out)
    }
}

/// SSE 事件增量解析。`feed` 累积字节并按行（`\n`，容忍行尾 `\r`）切分，产出完整
/// 事件的 `data` 载荷（多行 data 按 WHATWG 语义以 `\n` 连接）。未完成的行留在
/// 缓冲等下一批字节。只关心 `data:` 字段；`:` 注释行与 `event:`/`id:`/`retry:`
/// 忽略。
#[derive(Debug)]
struct SseParser {
    buf: Vec<u8>,
    /// `buf` 前缀中已确认无 `\n` 的字节数（避免每批从头重扫长无换行前缀）。
    scanned: usize,
    data_lines: Vec<String>,
}

impl SseParser {
    fn new() -> Self {
        Self {
            buf: Vec::new(),
            scanned: 0,
            data_lines: Vec::new(),
        }
    }

    /// 返回本批产出的完整事件 `data` 载荷（按到达顺序）。
    fn feed(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.buf.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(nl) = self.buf[self.scanned..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| p + self.scanned)
        {
            self.scanned = 0;
            let line_bytes: Vec<u8> = self.buf[..nl].to_vec();
            self.buf.drain(..nl + 1);
            let line = String::from_utf8_lossy(&line_bytes)
                .trim_end_matches('\r')
                .to_string();
            if line.is_empty() {
                if !self.data_lines.is_empty() {
                    events.push(self.data_lines.join("\n"));
                    self.data_lines.clear();
                }
                continue;
            }
            if line.starts_with(':') {
                continue; // 注释行
            }
            let (name, value) = match line.split_once(':') {
                Some((n, v)) => (n, v.strip_prefix(' ').unwrap_or(v)),
                None => (line.as_str(), ""),
            };
            if name == "data" {
                self.data_lines.push(value.to_string());
            }
        }
        self.scanned = self.buf.len();
        Ok(events)
    }
}

/// 单个 SSE `data:` 载荷解释结果。
#[derive(Debug, PartialEq, Eq)]
enum SsePayload {
    /// 非空 reasoning/content 增量。
    Delta(InferenceDelta),
    /// `data: [DONE]`。
    Done,
    /// 无 content（如首节仅 role、终止节仅 finish_reason），跳过。
    Skip,
}

fn interpret_sse_data(data: &str) -> Result<SsePayload, String> {
    if data.trim() == "[DONE]" {
        return Ok(SsePayload::Done);
    }
    let v: Value = serde_json::from_str(data)
        .map_err(|e| format!("SSE data JSON 解析失败: {e}: {}", truncate_chars(data, 200)))?;
    fn non_empty_delta_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
        let text = value
            .get("choices")?
            .get(0)?
            .get("delta")?
            .get(field)?
            .as_str()?;
        (!text.is_empty()).then_some(text)
    }

    if let Some(text) = non_empty_delta_field(&v, "reasoning") {
        return Ok(SsePayload::Delta(InferenceDelta {
            kind: InferenceDeltaKind::Reasoning,
            text: text.to_string(),
        }));
    }
    if let Some(text) = non_empty_delta_field(&v, "content") {
        return Ok(SsePayload::Delta(InferenceDelta {
            kind: InferenceDeltaKind::Content,
            text: text.to_string(),
        }));
    }
    Ok(SsePayload::Skip)
}

/// 发送流式多轮推理请求。每节非空 `delta.reasoning` / `delta.content` 到达即调用
/// `on_delta`；收到 `data: [DONE]` 返回 `Ok(InferenceStreamOutcome::Completed)`。
/// 任何失败（连接失败、非 2xx、2xx 但非 chunked+`text/event-stream`、SSE 事件解析
/// 失败、`[DONE]` 前断流、响应超过上限）返回既有格式诊断（Authorization 脱敏）。
pub async fn send_inference_stream<F>(
    port: u16,
    model: &str,
    api_key: &str,
    messages: &[InferenceMessage],
    reasoning_effort: InferenceEffort,
    mut on_delta: F,
) -> Result<InferenceStreamOutcome, String>
where
    F: FnMut(InferenceDelta),
{
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "reasoning_effort": reasoning_effort,
    })
    .to_string();

    let addr = format!("127.0.0.1:{port}");
    let authorization = format!("Bearer {api_key}");
    let headers = [
        ("Authorization", authorization.as_str()),
        ("Content-Type", "application/json"),
        ("Accept", "text/event-stream"),
    ];
    let request = build_http_request(&addr, "POST", "/v1/chat/completions", &headers, &body);

    let stream =
        match tokio::time::timeout(Duration::from_secs(30), TcpStream::connect(&addr)).await {
            Ok(result) => {
                result.map_err(|e| connect_error(&request, format!("连接失败: {e}"), None))?
            }
            Err(_) => {
                return Err(connect_error(
                    &request,
                    "连接失败: 连接超时".to_string(),
                    None,
                ));
            }
        };
    let (mut read, mut write) = stream.into_split();
    if let Err(e) = write.write_all(request.as_bytes()).await {
        return Err(connect_error(&request, format!("发送请求失败: {e}"), None));
    }
    // 不半关闭写端（与 fetch_status 同法）。

    let mut all: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];
    // 头解析结果：(status, head 文本, body 起始偏移)。`None` = 尚未见到 `\r\n\r\n`。
    let mut head: Option<(u16, String, usize)> = None;
    let mut streaming = false;
    let mut dechunk = IncrementalDechunker::new();
    let mut sse = SseParser::new();
    // 流式路径的解码后正文账本（错误诊断展示用）。
    let mut decoded_body: Vec<u8> = Vec::new();
    let mut done = false;
    let mut stream_error: Option<String> = None;

    loop {
        let n = match read.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                return Err(connect_error(
                    &request,
                    format!("读取响应失败: {e}"),
                    (!all.is_empty()).then_some(&all),
                ));
            }
        };
        all.extend_from_slice(&buf[..n]);
        if all.len() > RESPONSE_LIMIT {
            let (head_text, body) = head
                .as_ref()
                .map(|(_, h, body_off)| {
                    let raw = &all[*body_off..];
                    let effective = if resp_is_chunked(h) {
                        IncrementalDechunker::new()
                            .feed(raw)
                            .map(|feed| feed.data)
                            .unwrap_or_else(|_| raw.to_vec())
                    } else {
                        raw.to_vec()
                    };
                    (h.clone(), String::from_utf8_lossy(&effective).into_owned())
                })
                .unwrap_or_default();
            return Err(FailureDiagnostic {
                request: redact_request_debug(&request),
                response: (!head_text.is_empty()).then(|| format_response_debug(&head_text, &body)),
                message: format!("响应累计超过 {} 字节上限", RESPONSE_LIMIT),
            }
            .into_error());
        }

        if head.is_none() {
            let Some(head_end) = all.windows(4).position(|w| w == b"\r\n\r\n") else {
                continue;
            };
            let head_text = String::from_utf8_lossy(&all[..head_end]).into_owned();
            let status = parse_status(&head_text);
            streaming = (200..300).contains(&status)
                && resp_is_chunked(&head_text)
                && resp_is_event_stream(&head_text);
            head = Some((status, head_text, head_end + 4));
            if streaming {
                if let Err(e) = consume_sse_bytes(
                    &all[head_end + 4..],
                    &mut dechunk,
                    &mut sse,
                    &mut decoded_body,
                    &mut on_delta,
                    &mut done,
                ) {
                    stream_error = Some(e);
                    break;
                }
                if done {
                    return Ok(InferenceStreamOutcome::Completed);
                }
            }
            continue;
        }

        if streaming {
            if let Err(e) = consume_sse_bytes(
                &buf[..n],
                &mut dechunk,
                &mut sse,
                &mut decoded_body,
                &mut on_delta,
                &mut done,
            ) {
                stream_error = Some(e);
                break;
            }
            if done {
                return Ok(InferenceStreamOutcome::Completed);
            }
        }
        // 缓冲路径：持续累积到 EOF（外层 break）再统一诊断。
    }

    let Some((status, head_text, body_offset)) = head else {
        return Err(connect_error(
            &request,
            "响应缺少头结束符".to_string(),
            (!all.is_empty()).then_some(&all),
        ));
    };

    if streaming {
        // EOF（或流内错误）都走这里：走到此即未见到 [DONE]（见到已提前返回）。
        let body = String::from_utf8_lossy(&decoded_body).into_owned();
        let message = stream_error.unwrap_or_else(|| "流中断: 连接关闭，未收到 [DONE]".to_string());
        return Err(FailureDiagnostic {
            request: redact_request_debug(&request),
            response: Some(format_response_debug(&head_text, &body)),
            message,
        }
        .into_error());
    }

    // 缓冲诊断路径：正文按需整段去帧（chunked）后展示。
    let body_bytes = &all[body_offset..];
    let effective_body = if resp_is_chunked(&head_text) {
        let mut decoder = IncrementalDechunker::new();
        match decoder.feed(body_bytes) {
            Ok(feed) => feed.data,
            Err(_) => body_bytes.to_vec(), // 帧异常时保留原始字节供诊断暴露真实形态
        }
    } else {
        body_bytes.to_vec()
    };
    let body_resp = String::from_utf8_lossy(&effective_body).into_owned();

    let message = if !(200..300).contains(&status) {
        format!("HTTP {status}")
    } else {
        format!(
            "HTTP {status}，但响应不是 SSE 数据流（Content-Type: {}，Transfer-Encoding 非值或不为 chunked）",
            resp_header_value(&head_text, "content-type").unwrap_or("缺失")
        )
    };
    Err(FailureDiagnostic {
        request: redact_request_debug(&request),
        response: Some(format_response_debug(&head_text, &body_resp)),
        message,
    }
    .into_error())
}

/// 喂入一段（可能不完整的）响应体字节：按需 chunked 剥帧 → SSE 事件 → delta 回调。
fn consume_sse_bytes<F>(
    bytes: &[u8],
    dechunk: &mut IncrementalDechunker,
    sse: &mut SseParser,
    decoded_body: &mut Vec<u8>,
    on_delta: &mut F,
    done: &mut bool,
) -> Result<(), String>
where
    F: FnMut(InferenceDelta),
{
    let feed = dechunk.feed(bytes)?;
    decoded_body.extend_from_slice(&feed.data);
    for data in sse.feed(&feed.data)? {
        match interpret_sse_data(&data)? {
            SsePayload::Delta(delta) => on_delta(delta),
            SsePayload::Done => {
                *done = true;
                return Ok(());
            }
            SsePayload::Skip => {}
        }
    }
    Ok(())
}

/// 构建发往反代的实际请求（HTTP/1.1；Content-Length 按 body 字节数计算）。
fn build_http_request(
    addr: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> String {
    let mut req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Length: {}\r\nConnection: close\r\n",
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

/// 连接/读失败诊断（无完整头时的通用构造）。
fn connect_error(request: &str, message: String, raw_all: Option<&[u8]>) -> String {
    FailureDiagnostic {
        request: redact_request_debug(request),
        response: raw_all.map(|all| {
            let text = String::from_utf8_lossy(all);
            truncate_chars(text.trim(), 8000)
        }),
        message,
    }
    .into_error()
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

/// 响应诊断正文：状态行/头保留，正文截断到 8000 字符。
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

/// 解析状态行 status code（如 `HTTP/1.1 200 OK` → 200）。
fn parse_status(head: &str) -> u16 {
    head.lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

/// 判断响应头是否声明 chunked（头行大小写不敏感、跳过状态行）。
fn resp_is_chunked(head: &str) -> bool {
    resp_header_value(head, "transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked"))
}

/// 判断响应头是否声明 `Content-Type: text/event-stream`（参数如 charset 忽略）。
fn resp_is_event_stream(head: &str) -> bool {
    resp_header_value(head, "content-type").is_some_and(|v| {
        v.trim()
            .to_ascii_lowercase()
            .starts_with("text/event-stream")
    })
}

/// 取响应头字段值（大小写不敏感、跳过状态行；合并多值为首值——本用途不需要）。
fn resp_header_value<'t>(head: &'t str, name: &str) -> Option<&'t str> {
    head.lines().skip(1).find_map(|ln| {
        let ln = ln.trim_end_matches('\r');
        let (key, value) = ln.split_once(':')?;
        key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// 读请求到“头 + Content-Length body”完整后返回（供 fake 服务端取请求断言）。
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

    /// 逐字节断言：任何拆包点下解码结果与一次性喂入一致。
    #[test]
    fn dechunker_decodes_at_every_split_offset() {
        let frame =
            b"4\r\nWiki\r\n5\r\npedia\r\n1\r\n \r\na\r\nin chunks.\r\n0\r\nX-Trailer: 1\r\n\r\n";
        let expect = b"Wikipedia in chunks.".to_vec();
        for split in 0..=frame.len() {
            let mut d = IncrementalDechunker::new();
            let mut got = Vec::new();
            let mut finished = false;
            for piece in [&frame[..split] as &[u8], &frame[split..]] {
                let feed = d.feed(piece).unwrap();
                got.extend_from_slice(&feed.data);
                finished |= feed.finished;
            }
            assert!(finished, "split={split} 应见到终帧");
            assert_eq!(got, expect, "split={split}");
        }
    }

    /// 半帧/空输入保持 pending，不产出也不报错。
    #[test]
    fn dechunker_pending_partial_frame() {
        let mut d = IncrementalDechunker::new();
        let feed = d.feed(b"4\r\nWi").unwrap();
        assert_eq!(feed.data, b"Wi");
        assert!(!feed.finished);
        let feed2 = d.feed(b"ki\r\n").unwrap();
        assert_eq!(feed2.data, b"ki");
        assert!(!feed2.finished);
        let empty = d.feed(&[]).unwrap();
        assert!(empty.data.is_empty());
        assert!(!empty.finished);
    }

    #[test]
    fn dechunker_rejects_bad_frames() {
        let mut d = IncrementalDechunker::new();
        assert!(d.feed(b"zz\r\n").is_err(), "尺寸行非 hex 应报错");

        d = IncrementalDechunker::new();
        let overlong = format!("{}\r\n1234", "f".repeat(2000));
        assert!(d.feed(overlong.as_bytes()).is_err(), "尺寸行过长应报错");

        d = IncrementalDechunker::new();
        d.feed(b"4\r\nWiki").unwrap();
        assert!(d.feed(b"XX").is_err(), "帧尾非 CRLF 应报错");
    }

    #[test]
    fn sse_parser_events_crlf_comments_and_fragments() {
        let raw = ": ping\ndata: one\r\n\r\ndata: two\n\nf: ignored\ndata:[DONE]\n\n";
        let mut p = SseParser::new();
        let mut got = Vec::new();
        // 拆两半喂入（事件跨分片）。
        for piece in [&raw[..11] as &str, &raw[11..]] {
            got.extend(p.feed(piece.as_bytes()).unwrap());
        }
        assert_eq!(
            got,
            vec!["one".to_string(), "two".to_string(), "[DONE]".to_string()]
        );
    }

    #[test]
    fn sse_parser_joins_multiline_data() {
        let raw = "data: line1\ndata: line2\n\ndata: [DONE]\n\n";
        let mut p = SseParser::new();
        let got = p.feed(raw.as_bytes()).unwrap();
        assert_eq!(got, vec!["line1\nline2".to_string(), "[DONE]".to_string()]);
    }

    fn message(content: &str) -> InferenceMessage {
        InferenceMessage {
            role: InferenceRole::User,
            content: content.to_string(),
        }
    }

    #[test]
    fn typed_contracts_serialize_and_reject_invalid_roles_and_efforts() {
        let turn = message("你好");
        let json = serde_json::to_value(&turn).unwrap();
        assert_eq!(json, serde_json::json!({"role":"user","content":"你好"}));
        assert_eq!(turn, serde_json::from_value(json).unwrap());

        assert_eq!(
            serde_json::to_value(InferenceEffort::Medium).unwrap(),
            serde_json::json!("medium")
        );
        assert_eq!(InferenceEffort::default(), InferenceEffort::Medium);
        assert!(
            serde_json::from_str::<InferenceMessage>(r#"{"role":"system","content":"x"}"#).is_err()
        );
        assert!(serde_json::from_str::<InferenceEffort>("\"extreme\"").is_err());

        let delta = InferenceDelta {
            kind: InferenceDeltaKind::Reasoning,
            text: "先思考".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&delta).unwrap(),
            serde_json::json!({"kind":"reasoning","text":"先思考"})
        );
        assert_eq!(
            delta,
            serde_json::from_value(serde_json::to_value(&delta).unwrap()).unwrap()
        );

        assert_eq!(
            serde_json::to_value(InferenceStreamOutcome::Completed).unwrap(),
            serde_json::json!("completed")
        );
        assert_eq!(
            serde_json::to_value(InferenceStreamOutcome::Stopped).unwrap(),
            serde_json::json!("stopped")
        );
    }

    /// 无 reasoning/content 事件（仅 role / finish_reason / 空 delta）跳过；两类文本
    /// 均产出 typed delta。
    #[test]
    fn interpret_skips_empty_and_extracts_typed_delta() {
        let role = r#"{"choices":[{"delta":{"role":"assistant","reasoning":"","content":""}}]}"#;
        match interpret_sse_data(role).unwrap() {
            SsePayload::Skip => {}
            other => panic!("role-only 应跳过: {other:?}"),
        }
        let finish = r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        assert!(matches!(
            interpret_sse_data(finish).unwrap(),
            SsePayload::Skip
        ));
        let thinking = r#"{"choices":[{"delta":{"reasoning":"先分析"}}]}"#;
        assert_eq!(
            interpret_sse_data(thinking).unwrap(),
            SsePayload::Delta(InferenceDelta {
                kind: InferenceDeltaKind::Reasoning,
                text: "先分析".to_string(),
            })
        );
        let text = r#"{"choices":[{"delta":{"content":"你"}}]}"#;
        assert_eq!(
            interpret_sse_data(text).unwrap(),
            SsePayload::Delta(InferenceDelta {
                kind: InferenceDeltaKind::Content,
                text: "你".to_string(),
            })
        );
        assert!(matches!(
            interpret_sse_data("[DONE]").unwrap(),
            SsePayload::Done
        ));
        assert!(
            interpret_sse_data("not json").is_err(),
            "非 JSON data 应报错"
        );
    }

    #[tokio::test]
    async fn stream_no_server_returns_err() {
        let messages = vec![message("prompt")];
        let r = send_inference_stream(
            1,
            "model",
            "key",
            &messages,
            InferenceEffort::default(),
            |_| {},
        )
        .await;
        assert!(r.is_err());
        let e = r.unwrap_err();
        assert!(e.contains("发送失败: 连接失败"), "{e}");
        assert!(e.contains("--- 发送请求"), "{e}");
        assert!(e.contains("（无 HTTP 响应）"), "{e}");
        assert!(!e.contains("Bearer key"), "{e}");
    }

    fn sse_head() -> String {
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_string()
    }

    fn chunk_delta_field(field: &str, text: &str) -> String {
        let event = serde_json::json!({
            "id": "x", "object": "chat.completion.chunk",
            "choices": [{
                "index": 0,
                "delta": { field: text },
                "finish_reason": null
            }]
        })
        .to_string();
        format!("data: {event}\n\n")
    }

    fn chunk_delta(content: &str) -> String {
        chunk_delta_field("content", content)
    }

    fn chunk_empty_delta() -> String {
        let event = serde_json::json!({
            "id": "x", "object": "chat.completion.chunk",
            "choices": [{ "index": 0, "delta": {}, "finish_reason": null }]
        })
        .to_string();
        format!("data: {event}\n\n")
    }

    fn chunk_role_and_finish() -> String {
        let role = serde_json::json!({
            "id": "x", "object": "chat.completion.chunk",
            "choices": [{ "index": 0, "delta": { "role": "assistant", "content": "" }, "finish_reason": null }]
        })
        .to_string();
        let finish = serde_json::json!({
            "id": "x", "object": "chat.completion.chunk",
            "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }]
        })
        .to_string();
        format!("data: {role}\n\ndata: {finish}\n\n")
    }

    /// 多轮 body + 思考强度 + 流式契约：模型身份只在 body（由反代转 path），绝不注入
    /// x-model；body 恒带 stream:true 与 reasoning_effort；成功流逐 delta 顺序回调。
    #[tokio::test]
    async fn stream_posts_multiturn_stream_reasoning_and_no_x_model() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let seen: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let request = read_request_safely(&mut s).await;
            *seen2.lock().unwrap() = request;
            let body = format!(
                "{}{}{}{}",
                chunk_role_and_finish(),
                chunk_delta("你"),
                chunk_delta("好"),
                "data: [DONE]\n\n",
            );
            let resp = format!("{}{:x}\r\n{body}\r\n0\r\n\r\n", sse_head(), body.len());
            // 拆 3 段写：头 / 半帧 / 余下（网络分片）。
            let bytes = resp.as_bytes();
            let a = bytes.len() / 3;
            let b = 2 * a;
            s.write_all(&bytes[..a]).await.unwrap();
            s.write_all(&bytes[a..b]).await.unwrap();
            s.write_all(&bytes[b..]).await.unwrap();
            s.flush().await.unwrap();
        });

        let request_messages = vec![
            message("第一轮"),
            InferenceMessage {
                role: InferenceRole::Assistant,
                content: "第一轮回答".to_string(),
            },
            message("第二轮"),
        ];
        let deltas = Arc::new(Mutex::new(Vec::new()));
        let d2 = deltas.clone();
        let r = send_inference_stream(
            port,
            "gpt-x",
            "key",
            &request_messages,
            InferenceEffort::default(),
            move |delta| {
                d2.lock().unwrap().push(delta);
            },
        )
        .await;
        assert_eq!(r.unwrap(), InferenceStreamOutcome::Completed);

        let request = String::from_utf8_lossy(&seen.lock().unwrap()).into_owned();
        assert!(
            !request.lines().skip(1).any(|ln| ln
                .trim_end_matches('\r')
                .to_ascii_lowercase()
                .starts_with("x-model:")),
            "send_inference_stream 不应注入 x-model"
        );
        let body = request
            .split_once("\r\n\r\n")
            .map(|(_, body)| serde_json::from_str::<Value>(body).unwrap())
            .unwrap();
        assert_eq!(body["model"], serde_json::json!("gpt-x"));
        assert_eq!(body["stream"], serde_json::json!(true));
        assert_eq!(body["reasoning_effort"], serde_json::json!("medium"));
        assert_eq!(
            body["messages"],
            serde_json::json!([
                {"role":"user","content":"第一轮"},
                {"role":"assistant","content":"第一轮回答"},
                {"role":"user","content":"第二轮"}
            ])
        );
        assert!(
            !request.lines().skip(1).any(|ln| ln.contains("x-model")),
            "send_inference_stream 不应注入 x-model"
        );
        assert!(
            !request.contains("Bearer <已隐藏>"),
            "实际请求应带真实凭据（仅诊断脱敏）"
        );
        assert_eq!(
            *deltas.lock().unwrap(),
            vec![
                InferenceDelta {
                    kind: InferenceDeltaKind::Content,
                    text: "你".to_string(),
                },
                InferenceDelta {
                    kind: InferenceDeltaKind::Content,
                    text: "好".to_string(),
                },
            ]
        );
    }

    /// vLLM 0.26 thinking 模型顺序：role → reasoning → 空 delta → content → [DONE]。
    #[tokio::test]
    async fn stream_parses_reasoning_and_content_in_order() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let body = format!(
                "{}{}{}{}{}",
                chunk_role_and_finish().replace(",\"content\":\"\"", ""),
                chunk_delta_field("reasoning", "先分析"),
                chunk_empty_delta(),
                chunk_delta_field("content", "回答"),
                "data: [DONE]\n\n",
            );
            let resp = format!("{}{:x}\r\n{body}\r\n0\r\n\r\n", sse_head(), body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
            s.flush().await.unwrap();
        });

        let messages = vec![message("thinking")];
        let deltas: Arc<Mutex<Vec<InferenceDelta>>> = Arc::new(Mutex::new(Vec::new()));
        let d2 = deltas.clone();
        send_inference_stream(
            port,
            "m",
            "k",
            &messages,
            InferenceEffort::High,
            move |delta| {
                d2.lock().unwrap().push(delta);
            },
        )
        .await
        .unwrap();
        assert_eq!(
            *deltas.lock().unwrap(),
            vec![
                InferenceDelta {
                    kind: InferenceDeltaKind::Reasoning,
                    text: "先分析".to_string(),
                },
                InferenceDelta {
                    kind: InferenceDeltaKind::Content,
                    text: "回答".to_string(),
                },
            ]
        );
    }

    /// vLLM 常见顺序：role → tokens → finish → [DONE]；role/finish 不回调。
    #[tokio::test]
    async fn stream_skips_contentless_events() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let mut body = String::new();
            body.push_str(&chunk_role_and_finish());
            body.push_str(&chunk_delta("1"));
            body.push_str(&chunk_delta("2"));
            body.push_str(&chunk_delta("3"));
            body.push_str("data: [DONE]\n\n");
            let resp = format!("{}{:x}\r\n{body}\r\n0\r\n\r\n", sse_head(), body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
            s.flush().await.unwrap();
        });
        let messages = vec![message("p")];
        let deltas: Arc<Mutex<Vec<InferenceDelta>>> = Arc::new(Mutex::new(Vec::new()));
        let d2 = deltas.clone();
        send_inference_stream(
            port,
            "m",
            "k",
            &messages,
            InferenceEffort::Low,
            move |delta| {
                d2.lock().unwrap().push(delta);
            },
        )
        .await
        .unwrap();
        assert_eq!(
            *deltas.lock().unwrap(),
            vec![
                InferenceDelta {
                    kind: InferenceDeltaKind::Content,
                    text: "1".to_string(),
                },
                InferenceDelta {
                    kind: InferenceDeltaKind::Content,
                    text: "2".to_string(),
                },
                InferenceDelta {
                    kind: InferenceDeltaKind::Content,
                    text: "3".to_string(),
                },
            ]
        );
    }

    /// [DONE] 前连接关闭：失败诊断标注断流且无明文凭据；已产 delta 不影响 Err。
    #[tokio::test]
    async fn stream_aborted_before_done_reports_interrupted() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let body = chunk_delta("部分");
            let resp = format!("{}{:x}\r\n{body}\r\n", sse_head(), body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
            s.flush().await.unwrap();
            drop(s); // 无 0 终帧、无 [DONE] 直接断
        });
        let r = send_inference_stream(
            port,
            "m",
            "k",
            &[message("p")],
            InferenceEffort::None,
            |_| {},
        )
        .await;
        let e = r.unwrap_err();
        assert!(e.contains("流中断"), "{e}");
        assert!(e.contains("未收到 [DONE]"), "{e}");
        assert!(e.contains("Transfer-Encoding: chunked"), "{e}");
        assert!(!e.contains("Bearer k"), "{e}");
        assert!(e.contains("Authorization: Bearer <已隐藏>"), "{e}");
    }

    /// SSE data 非 JSON：失败带 data 上下文，不只报“JSON 解析失败”。
    #[tokio::test]
    async fn stream_bad_sse_data_json_reports_context() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let body = "data: {not-json}\n\n";
            let resp = format!("{}{:x}\r\n{body}\r\n0\r\n\r\n", sse_head(), body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
            s.flush().await.unwrap();
        });
        let r = send_inference_stream(
            port,
            "m",
            "k",
            &[message("p")],
            InferenceEffort::None,
            |_| {},
        )
        .await;
        let e = r.unwrap_err();
        assert!(e.contains("SSE data JSON 解析失败"), "{e}");
        assert!(e.contains("{not-json}"), "{e}");
        assert!(!e.contains("Bearer k"), "{e}");
    }

    /// 2xx 但响应体是非 SSE（WAF HTML 拦截页）：错误须带 body 摘要。
    #[tokio::test]
    async fn stream_2xx_non_sse_reports_body_snippet() {
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
            s.write_all(resp.as_bytes()).await.unwrap();
            s.flush().await.unwrap();
        });
        let r = send_inference_stream(
            port,
            "m",
            "k",
            &[message("p")],
            InferenceEffort::None,
            |_| {},
        )
        .await;
        let e = r.unwrap_err();
        assert!(e.contains("WAF block"), "错误应带 body 摘要: {e}");
        assert!(e.contains("不是 SSE 数据流"), "{e}");
        assert!(e.contains("--- 收到的响应 ---"), "{e}");
        assert!(!e.contains("Bearer k"), "{e}");
    }

    /// 非 2xx（如 tng 网关 HttpCipherTextBadResponse 502 JSON）：报状态码和 body。
    #[tokio::test]
    async fn stream_non_2xx_reports_status_with_body() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            let body = r#"{"code":"HttpCipherTextBadResponse","message":"..."}"#;
            let resp = format!(
                "HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            s.write_all(resp.as_bytes()).await.unwrap();
            s.flush().await.unwrap();
        });
        let r = send_inference_stream(
            port,
            "m",
            "k",
            &[message("p")],
            InferenceEffort::None,
            |_| {},
        )
        .await;
        let e = r.unwrap_err();
        assert!(e.starts_with("发送失败: HTTP 502"), "{e}");
        assert!(e.contains("HttpCipherTextBadResponse"), "{e}");
        assert!(!e.contains("Bearer k"), "{e}");
    }

    /// 响应超 10 MiB：即使还在流式帧里也立即失败，不无限累积。
    #[tokio::test]
    async fn stream_response_over_limit_fails() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            read_request_safely(&mut s).await;
            // 12 条合法 1 MiB 帧：头+体累计超 10 MiB；无终帧（客户端应先到上限）。
            s.write_all(sse_head().as_bytes()).await.unwrap();
            let frame = format!("{:x}\r\n{}\r\n", 1024 * 1024, "x".repeat(1024 * 1024));
            for _ in 0..12 {
                if s.write_all(frame.as_bytes()).await.is_err() {
                    break; // 客户端及时收手关闭也接受
                }
            }
        });
        let r = send_inference_stream(
            port,
            "m",
            "k",
            &[message("p")],
            InferenceEffort::None,
            |_| {},
        )
        .await;
        let e = r.unwrap_err();
        assert!(e.contains("上限"), "{e}");
    }

    #[test]
    fn response_debug_is_truncated() {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n";
        let formatted = format_response_debug(head, &"x".repeat(8001));
        assert!(formatted.contains("...（诊断内容已截断）"), "{formatted}");
    }
}
