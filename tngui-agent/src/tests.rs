//! `tngui-agent` 单测：装配不变量、事件映射、真实（本地假服务）多轮工具调用、取消、代理绕过。

use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use rpi_agent::{AgentEvent, AgentMessage as RpiMessage};
use rpi_ai::types::{AssistantMessage, AssistantMessageEvent, Content};
use rpi_harness::run_budget::MAX_TURNS_ENV;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;

use crate::config;
use crate::runner::{self, AgentRunConfig, AgentRunRequest, EventSink, InferenceEventEmitter};
use crate::{AgentEffort, AgentMessage, AgentRole, InferenceEvent, ToolStatus};

// ---------------------------------------------------------------------------
// 装配不变量
// ---------------------------------------------------------------------------

#[test]
fn registers_exactly_the_read_only_tools() {
    let mut names: Vec<String> = config::build_tools()
        .iter()
        .map(|tool| tool.tool.schema().name.clone())
        .collect();
    names.sort();
    assert_eq!(names, vec!["find", "grep", "ls", "read"]);
    assert_eq!(
        config::active_tool_names(),
        vec!["read", "ls", "grep", "find"]
    );
    // 绝不包含任何写/执行工具。
    for forbidden in ["write", "edit", "bash", "powershell", "image"] {
        assert!(!names.iter().any(|name| name == forbidden));
    }
}

#[test]
fn base_url_is_loopback_root_so_rpi_appends_v1_chat_completions() {
    let model = config::build_model(18080, "my-model");
    assert_eq!(model.base_url, "http://127.0.0.1:18080");
    assert!(!model.base_url.ends_with("/v1"));
    assert_eq!(model.id, "my-model");
    assert_eq!(model.provider, config::PROVIDER_ID);
    assert!(model.reasoning);
    assert_eq!(config::base_url(1234), "http://127.0.0.1:1234");
}

#[test]
fn thinking_level_map_pins_all_four_levels() {
    assert!(matches!(
        config::thinking_level(AgentEffort::None),
        rpi_ai::types::ThinkingLevel::Off
    ));
    assert_eq!(config::reasoning_effort_for(AgentEffort::None), "none");
    assert_eq!(config::reasoning_effort_for(AgentEffort::Low), "low");
    assert_eq!(config::reasoning_effort_for(AgentEffort::Medium), "medium");
    assert_eq!(config::reasoning_effort_for(AgentEffort::High), "high");
}

#[test]
fn max_turns_env_defaults_to_30_and_respects_user_value() {
    let saved = std::env::var_os(MAX_TURNS_ENV);
    // SAFETY: 测试以 --test-threads=1 运行，无并发访问环境变量。
    unsafe { std::env::remove_var(MAX_TURNS_ENV) };
    assert!(runner::ensure_default_max_turns_env());
    assert_eq!(std::env::var(MAX_TURNS_ENV).unwrap(), "30");
    unsafe { std::env::set_var(MAX_TURNS_ENV, "7") };
    assert!(!runner::ensure_default_max_turns_env());
    assert_eq!(std::env::var(MAX_TURNS_ENV).unwrap(), "7");
    match saved {
        Some(value) => unsafe { std::env::set_var(MAX_TURNS_ENV, value) },
        None => unsafe { std::env::remove_var(MAX_TURNS_ENV) },
    }
}

// ---------------------------------------------------------------------------
// 事件映射
// ---------------------------------------------------------------------------

fn event_kind(event: &InferenceEvent) -> &'static str {
    match event {
        InferenceEvent::TurnStart { .. } => "turnStart",
        InferenceEvent::ReasoningDelta { .. } => "reasoningDelta",
        InferenceEvent::ContentDelta { .. } => "contentDelta",
        InferenceEvent::ToolStart { .. } => "toolStart",
        InferenceEvent::ToolEnd { .. } => "toolEnd",
        InferenceEvent::Notice { .. } => "notice",
        InferenceEvent::Done => "done",
        InferenceEvent::Error { .. } => "error",
    }
}

fn partial() -> Arc<AssistantMessage> {
    Arc::new(AssistantMessage::empty(
        rpi_ai::types::Api::OpenaiCompletions,
        "faux",
        "faux",
        0,
    ))
}

#[test]
fn maps_agent_events_to_unified_inference_events() {
    let captured: Arc<StdMutex<Vec<InferenceEvent>>> = Arc::new(StdMutex::new(Vec::new()));
    let sink_events = captured.clone();
    let sink: EventSink = Arc::new(move |event| sink_events.lock().unwrap().push(event));
    let emitter = InferenceEventEmitter::new(sink);

    let mut assistant =
        AssistantMessage::empty(rpi_ai::types::Api::OpenaiCompletions, "faux", "faux", 0);
    assistant.content.push(Content::text("最终回答"));

    emitter.handle(AgentEvent::AgentStart);
    emitter.handle(AgentEvent::TurnStart);
    emitter.handle(AgentEvent::MessageUpdate {
        message: partial(),
        assistant_message_event: AssistantMessageEvent::ThinkingDelta {
            content_index: 0,
            delta: "思考中".to_string(),
            partial: partial(),
        },
    });
    emitter.handle(AgentEvent::MessageUpdate {
        message: partial(),
        assistant_message_event: AssistantMessageEvent::TextDelta {
            content_index: 1,
            delta: "回答".to_string(),
            partial: partial(),
        },
    });
    emitter.handle(AgentEvent::ToolExecutionStart {
        tool_call_id: "call_1".to_string(),
        tool_name: "read".to_string(),
        args: json!({ "path": "/tmp/x" }),
    });
    emitter.handle(AgentEvent::ToolExecutionEnd {
        tool_call_id: "call_1".to_string(),
        tool_name: "read".to_string(),
        result: rpi_agent::types::AgentToolResult::text("文件内容"),
        is_error: false,
    });
    emitter.handle(AgentEvent::RetryScheduled {
        attempt: 1,
        max_retries: 3,
        delay_ms: 10,
        error: "boom".to_string(),
    });
    emitter.handle(AgentEvent::AgentEnd {
        messages: vec![
            rpi_user_message("问题"),
            RpiMessage::Assistant(Box::new(assistant)),
        ],
    });

    let events = captured.lock().unwrap();
    let kinds: Vec<&str> = events.iter().map(event_kind).collect();
    assert_eq!(
        kinds,
        vec![
            "turnStart",
            "reasoningDelta",
            "contentDelta",
            "toolStart",
            "toolEnd",
            "notice",
            "done"
        ]
    );
    // AgentStart 不额外产出 TurnStart；TurnStart 的轮次从 1 开始。
    assert_eq!(events[0], InferenceEvent::TurnStart { turn: 1 });
    assert_eq!(
        events[1],
        InferenceEvent::ReasoningDelta {
            text: "思考中".to_string()
        }
    );
    assert_eq!(
        events[2],
        InferenceEvent::ContentDelta {
            text: "回答".to_string()
        }
    );
    assert_eq!(
        events[3],
        InferenceEvent::ToolStart {
            id: "call_1".to_string(),
            name: "read".to_string(),
            arguments: "{\"path\":\"/tmp/x\"}".to_string(),
        }
    );
    assert_eq!(
        events[4],
        InferenceEvent::ToolEnd {
            id: "call_1".to_string(),
            status: ToolStatus::Ok,
            summary: "文件内容".to_string(),
        }
    );
}

fn rpi_user_message(text: &str) -> RpiMessage {
    config::to_rpi_message(
        &AgentMessage::new(AgentRole::User, text),
        rpi_ai::types::Api::OpenaiCompletions,
        "faux",
        "faux",
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_tool_execution_is_marked_cancelled() {
    let captured: Arc<StdMutex<Vec<InferenceEvent>>> = Arc::new(StdMutex::new(Vec::new()));
    let sink_events = captured.clone();
    let sink: EventSink = Arc::new(move |event| sink_events.lock().unwrap().push(event));
    let emitter = InferenceEventEmitter::new(sink);
    emitter.mark_aborted();
    emitter.handle(AgentEvent::ToolExecutionEnd {
        tool_call_id: "call_1".to_string(),
        tool_name: "read".to_string(),
        result: rpi_agent::types::AgentToolResult::text("部分内容"),
        is_error: true,
    });
    let events = captured.lock().unwrap();
    assert!(matches!(
        events.as_slice(),
        [InferenceEvent::ToolEnd {
            status: ToolStatus::Cancelled,
            ..
        }]
    ));
}

// ---------------------------------------------------------------------------
// 本地假 OpenAI 服务
// ---------------------------------------------------------------------------

struct Captured {
    path: String,
    body: Value,
}

struct FakeServer {
    port: u16,
    captured: Arc<StdMutex<Vec<Captured>>>,
}

enum Round {
    Frames(Vec<Value>),
    Stall,
}

async fn read_request(stream: &mut TcpStream) -> Vec<u8> {
    let mut buf = Vec::new();
    let header_end = loop {
        let mut tmp = [0u8; 1024];
        let n = stream.read(&mut tmp).await.unwrap();
        if n == 0 {
            break buf.len();
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let content_length = head
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (key, value) = line.trim_end_matches('\r').split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .next()
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buf.len() < body_start + content_length {
        let mut tmp = [0u8; 1024];
        let n = stream.read(&mut tmp).await.unwrap();
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
    }
    buf
}

async fn spawn_fake_openai(rounds: Vec<Round>) -> FakeServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let captured = Arc::new(StdMutex::new(Vec::new()));
    let captured_task = captured.clone();
    tokio::spawn(async move {
        for round in rounds {
            let (mut stream, _) = listener.accept().await.unwrap();
            let raw = read_request(&mut stream).await;
            let text = String::from_utf8_lossy(&raw).into_owned();
            let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
            let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
            let body = serde_json::from_str::<Value>(body).unwrap_or(Value::Null);
            captured_task.lock().unwrap().push(Captured { path, body });
            match round {
                Round::Stall => {
                    // 不响应，等待调用方取消。
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
                Round::Frames(chunks) => {
                    let mut response = String::from(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                    );
                    for chunk in chunks {
                        let frame = format!("data: {chunk}\n\n");
                        response.push_str(&format!("{:x}\r\n{frame}\r\n", frame.len()));
                    }
                    let done = "data: [DONE]\n\n";
                    response.push_str(&format!("{:x}\r\n{done}\r\n", done.len()));
                    response.push_str("0\r\n\r\n");
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.flush().await;
                }
            }
        }
    });
    FakeServer { port, captured }
}

fn text_chunk(text: &str) -> Value {
    json!({"choices": [{"delta": {"content": text}, "finish_reason": null}]})
}

fn tool_call_chunk(id: &str, name: &str, arguments: &str) -> Value {
    json!({"choices": [{"delta": {"tool_calls": [
        {"index": 0, "id": id, "type": "function", "function": {"name": name, "arguments": arguments}}
    ]}, "finish_reason": null}]})
}

fn finish_chunk(reason: &str) -> Value {
    json!({"choices": [{"delta": {}, "finish_reason": reason}]})
}

fn collector() -> (EventSink, Arc<StdMutex<Vec<InferenceEvent>>>) {
    let captured: Arc<StdMutex<Vec<InferenceEvent>>> = Arc::new(StdMutex::new(Vec::new()));
    let sink_events = captured.clone();
    let sink: EventSink = Arc::new(move |event| sink_events.lock().unwrap().push(event));
    (sink, captured)
}

fn unique_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("tngui-agent-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// ---------------------------------------------------------------------------
// 多轮工具调用往返（同时验证 URL 路径、stream/reasoning_effort、上下文再灌入）
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn runs_multiround_tool_loop_and_replays_context_without_distortion() {
    let dir = unique_dir("roundtrip");
    let file = dir.join("note.txt");
    std::fs::write(&file, "hello from tool\n").unwrap();
    let file_arg = json!({ "path": file.to_string_lossy() }).to_string();

    let server = spawn_fake_openai(vec![
        Round::Frames(vec![
            tool_call_chunk("call_1", "read", &file_arg),
            finish_chunk("tool_calls"),
        ]),
        Round::Frames(vec![
            text_chunk("文件内容是 hello from tool"),
            finish_chunk("stop"),
        ]),
    ])
    .await;

    let (sink, events) = collector();
    let (_tx, rx) = oneshot::channel();
    let outcome = runner::run_agent_turn(
        AgentRunConfig {
            port: server.port,
            model_id: "m1".to_string(),
            api_key: "secret-key".to_string(),
            system_prompt: Some("你是测试助手".to_string()),
            effort: AgentEffort::Medium,
        },
        AgentRunRequest {
            context: vec![],
            prompt: AgentMessage::new(AgentRole::User, "读一下文件"),
        },
        rx,
        sink,
    )
    .await
    .unwrap();

    assert!(!outcome.stopped);
    // 导出：assistant(tool_calls) → tool(result) → assistant(content)
    assert_eq!(outcome.messages.len(), 3, "{:?}", outcome.messages);
    assert_eq!(outcome.messages[0].role, AgentRole::Assistant);
    assert_eq!(
        outcome.messages[0].tool_calls.as_ref().unwrap()[0]
            .function
            .name,
        "read"
    );
    assert_eq!(outcome.messages[1].role, AgentRole::Tool);
    assert_eq!(outcome.messages[1].tool_call_id.as_deref(), Some("call_1"));
    assert!(outcome.messages[1].content.contains("hello from tool"));
    assert_eq!(outcome.messages[2].role, AgentRole::Assistant);
    assert_eq!(outcome.messages[2].content, "文件内容是 hello from tool");

    // 事件序列包含工具开始/结束与完成。
    let kinds: Vec<&str> = events.lock().unwrap().iter().map(event_kind).collect();
    assert!(kinds.contains(&"toolStart"));
    assert!(kinds.contains(&"toolEnd"));
    assert_eq!(*kinds.last().unwrap(), "done");

    {
        let captured = server.captured.lock().unwrap();
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].path, "/v1/chat/completions");
        assert_eq!(captured[1].path, "/v1/chat/completions");
        assert_eq!(captured[0].body["model"], "m1");
        assert_eq!(captured[0].body["stream"], true);
        assert_eq!(captured[0].body["reasoning_effort"], "medium");
        assert_ne!(captured[0].body["messages"][0]["role"], "user");
        assert!(
            captured[0].body["messages"][0]["content"]
                .as_str()
                .unwrap()
                .contains("你是测试助手")
        );
        // 第二轮请求把工具结果回填给了模型。
        let second_messages = captured[1].body["messages"].as_array().unwrap();
        assert!(
            second_messages
                .iter()
                .any(|message| message["role"] == "tool" && message["tool_call_id"] == "call_1")
        );
        assert!(
            second_messages
                .iter()
                .any(|message| message["role"] == "assistant"
                    && message["tool_calls"][0]["function"]["name"] == "read")
        );
    }

    // 把导出结果再作为下一次运行的上下文灌入，验证不失真。
    let server2 = spawn_fake_openai(vec![Round::Frames(vec![
        text_chunk("收到历史"),
        finish_chunk("stop"),
    ])])
    .await;
    let mut context = vec![AgentMessage::new(AgentRole::User, "读一下文件")];
    context.extend(outcome.messages.clone());
    let (sink2, _events2) = collector();
    let (_tx2, rx2) = oneshot::channel();
    runner::run_agent_turn(
        AgentRunConfig {
            port: server2.port,
            model_id: "m1".to_string(),
            api_key: "secret-key".to_string(),
            system_prompt: None,
            effort: AgentEffort::Low,
        },
        AgentRunRequest {
            context,
            prompt: AgentMessage::new(AgentRole::User, "继续"),
        },
        rx2,
        sink2,
    )
    .await
    .unwrap();

    let captured = server2.captured.lock().unwrap();
    let messages = captured[0].body["messages"].as_array().unwrap();
    let assistant_tool = messages
        .iter()
        .find(|message| {
            message["role"] == "assistant" && message["tool_calls"][0]["function"]["name"] == "read"
        })
        .expect("工具调用 assistant 消息应逐字保留");
    assert_eq!(assistant_tool["tool_calls"][0]["id"], "call_1");
    let tool_result = messages
        .iter()
        .find(|message| message["role"] == "tool")
        .expect("工具结果消息应逐字保留");
    assert_eq!(tool_result["tool_call_id"], "call_1");
    assert!(
        tool_result["content"]
            .as_str()
            .unwrap()
            .contains("hello from tool")
    );
    // reasoning 不进入上下文（导出的 assistant 消息只有最终 content）。
    assert!(
        messages
            .iter()
            .all(|message| message["reasoning_content"].is_null())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reasoning_effort_none_is_sent_for_off() {
    let server = spawn_fake_openai(vec![Round::Frames(vec![
        text_chunk("ok"),
        finish_chunk("stop"),
    ])])
    .await;
    let (sink, _events) = collector();
    let (_tx, rx) = oneshot::channel();
    runner::run_agent_turn(
        AgentRunConfig {
            port: server.port,
            model_id: "m1".to_string(),
            api_key: "k".to_string(),
            system_prompt: None,
            effort: AgentEffort::None,
        },
        AgentRunRequest {
            context: vec![],
            prompt: AgentMessage::new(AgentRole::User, "hi"),
        },
        rx,
        sink,
    )
    .await
    .unwrap();
    let captured = server.captured.lock().unwrap();
    assert_eq!(captured[0].body["reasoning_effort"], "none");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn provider_ignores_system_proxy_for_loopback() {
    let server = spawn_fake_openai(vec![Round::Frames(vec![
        text_chunk("绕过代理"),
        finish_chunk("stop"),
    ])])
    .await;

    // 指向一个必然连不上的代理；若 provider 复用了系统代理，请求会失败。
    let saved: Vec<(&str, Option<std::ffi::OsString>)> = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]
        .iter()
        .map(|key| (*key, std::env::var_os(key)))
        .collect();
    for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
        // SAFETY: 单线程测试。
        unsafe { std::env::set_var(key, "http://127.0.0.1:1") };
    }

    let (sink, _events) = collector();
    let (_tx, rx) = oneshot::channel();
    let result = runner::run_agent_turn(
        AgentRunConfig {
            port: server.port,
            model_id: "m1".to_string(),
            api_key: "k".to_string(),
            system_prompt: None,
            effort: AgentEffort::Medium,
        },
        AgentRunRequest {
            context: vec![],
            prompt: AgentMessage::new(AgentRole::User, "hi"),
        },
        rx,
        sink,
    )
    .await;

    for (key, value) in saved {
        match value {
            Some(value) => unsafe { std::env::set_var(key, value) },
            None => unsafe { std::env::remove_var(key) },
        }
    }

    assert!(result.is_ok(), "回环请求不应被系统代理劫持: {result:?}");
}

// ---------------------------------------------------------------------------
// 取消
// ---------------------------------------------------------------------------

async fn wait_for_tool_end(events: &Arc<StdMutex<Vec<InferenceEvent>>>) -> bool {
    for _ in 0..200 {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event, InferenceEvent::ToolEnd { .. }))
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    false
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancellation_aborts_the_tool_loop_and_reports_stopped() {
    let dir = unique_dir("cancel");
    let file = dir.join("note.txt");
    std::fs::write(&file, "data\n").unwrap();
    let file_arg = json!({ "path": file.to_string_lossy() }).to_string();

    let server = spawn_fake_openai(vec![
        Round::Frames(vec![
            tool_call_chunk("call_1", "read", &file_arg),
            finish_chunk("tool_calls"),
        ]),
        Round::Stall,
    ])
    .await;

    let (sink, events) = collector();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let run = tokio::spawn(runner::run_agent_turn(
        AgentRunConfig {
            port: server.port,
            model_id: "m1".to_string(),
            api_key: "k".to_string(),
            system_prompt: None,
            effort: AgentEffort::Medium,
        },
        AgentRunRequest {
            context: vec![],
            prompt: AgentMessage::new(AgentRole::User, "读文件"),
        },
        cancel_rx,
        sink,
    ));

    assert!(wait_for_tool_end(&events).await, "应至少执行完一次工具调用");
    let _ = cancel_tx.send(());

    let outcome = tokio::time::timeout(Duration::from_secs(15), run)
        .await
        .expect("取消后 harness 应在限时内收敛")
        .expect("运行任务不应 panic")
        .expect("取消不是失败");
    assert!(outcome.stopped);
    assert!(outcome.messages.is_empty());
}
