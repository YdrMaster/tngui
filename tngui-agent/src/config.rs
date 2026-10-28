//! Agent 单次运行的装配：provider / model / 只读工具集 / 内存会话 / 思考强度映射。
//!
//! 装配拆成若干纯函数，便于在没有真实模型服务的前提下用单测钉住关键不变量
//! （工具名集合、思考强度映射、base_url 形状）。

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use rpi_agent::{AgentEmitter, QueueMode};
use rpi_ai::Model;
use rpi_ai::model::{OpenaiCompletionsCompat, StreamingProtocolCompat};
use rpi_ai::provider::Provider;
use rpi_ai::providers::openai_completions::OpenAiCompletionsProvider;
use rpi_ai::types::{Api, ThinkingLevel, ThinkingLevelMap};
use rpi_harness::session::memory::{InMemorySessionStorage, SystemClock};
use rpi_harness::session::types::SessionMetadata;
use rpi_harness::session::{DefaultIdGenerator, Session};
use rpi_harness::types::{
    AgentHarnessOptions, AgentHarnessResources, AgentHarnessStreamOptions, CompactionSettings,
    DrivingMode, HarnessTool, HarnessToolExecution, RetryPolicy,
};
use rpi_tools::{
    ExecutionToolContext, OsExecutionEnv, create_find_tool, create_grep_tool, create_ls_tool,
    create_read_tool,
};

use crate::{AgentEffort, AgentMessage, AgentRole, AgentToolCall, AgentToolCallFunction};

/// provider 注册 id：必须与 [`Model::provider`] 一致，harness 才能把模型路由到它。
pub const PROVIDER_ID: &str = "tngui-proxy";

/// Agent 模式注册且只注册的只读工具（顺序即注册顺序）。
pub const READ_ONLY_TOOLS: [&str; 4] = ["read", "ls", "grep", "find"];

/// 工具结果摘要截断长度（字符），避免把超大文件内容灌进事件流。
pub const TOOL_SUMMARY_LIMIT: usize = 4000;

/// 思考强度 → rpi 的 `ThinkingLevel`。
pub fn thinking_level(effort: AgentEffort) -> ThinkingLevel {
    match effort {
        AgentEffort::None => ThinkingLevel::Off,
        AgentEffort::Low => ThinkingLevel::Low,
        AgentEffort::Medium => ThinkingLevel::Medium,
        AgentEffort::High => ThinkingLevel::High,
    }
}

/// 思考强度 → 请求里的 `reasoning_effort` 取值。
///
/// rpi 在 `ThinkingLevel::Off` 时默认**省略** `reasoning_effort`，而规格要求"关"必须
/// 发 `"none"`；`thinking_level_map` 的 `Off` 项正是为此而钉，其余档位同时钉住以免
/// 依赖 provider 默认值。
pub fn thinking_level_map() -> ThinkingLevelMap {
    BTreeMap::from([
        (ThinkingLevel::Off, Some("none".to_string())),
        (ThinkingLevel::Low, Some("low".to_string())),
        (ThinkingLevel::Medium, Some("medium".to_string())),
        (ThinkingLevel::High, Some("high".to_string())),
    ])
}

/// `reasoning_effort` 的取值（供单测与文档核对映射）。
pub fn reasoning_effort_for(effort: AgentEffort) -> String {
    thinking_level_map()
        .get(&thinking_level(effort))
        .cloned()
        .flatten()
        .unwrap_or_else(|| "none".to_string())
}

/// 反代对外端点的 base_url；rpi 会拼成 `<base>/v1/chat/completions`。
pub fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// 构造 OpenAI-compatible 模型：模型身份由 `id` 决定（对应 `body.model`）。
pub fn build_model(port: u16, model_id: &str) -> Model {
    let mut model = Model::new(
        model_id.to_string(),
        model_id.to_string(),
        Api::OpenaiCompletions,
        PROVIDER_ID,
        base_url(port),
    );
    model.reasoning = true;
    model.thinking_level_map = Some(thinking_level_map());
    model.compat = Some(StreamingProtocolCompat::OpenaiCompletions(
        OpenaiCompletionsCompat {
            supports_reasoning_effort: Some(true),
            // 与对话模式保持一致的请求形状：不发 stream_options。
            supports_usage_in_streaming: Some(false),
            ..Default::default()
        },
    ));
    model
}

/// 构造 provider；HTTP 客户端显式对回环地址关闭系统代理。
///
/// rpi 的 `client_builder_for` 会读进程环境里的代理变量，而 `reqwest::Client::builder()`
/// 默认还会自动套用系统代理；这里再显式 `no_proxy()`，保证调试对象始终是本机 tng。
pub fn build_provider(api_key: &str, model: Model) -> Result<Arc<dyn Provider>, String> {
    let base = model.base_url.clone();
    // 传一个 `no_proxy=*` 的环境快照，让 rpi 自己先判定"不代理"，顺带避开它对
    // SOCKS/PAC 代理 URL 的报错路径。
    let mut env = HashMap::new();
    env.insert("no_proxy".to_string(), "*".to_string());
    let http = rpi_ai::http::client_builder_for(&base, None, Some(&env))
        .map_err(|e| format!("构建推理 HTTP 客户端失败: {e}"))?
        .no_proxy()
        .build()
        .map_err(|e| format!("构建推理 HTTP 客户端失败: {e}"))?;
    Ok(Arc::new(OpenAiCompletionsProvider::with_models(
        PROVIDER_ID,
        Some(api_key.to_string()),
        http,
        vec![model],
    )))
}

/// 只读工具集：四个工具共用一个 `OsExecutionEnv`（真实文件系统 + 进程工作目录为基准，
/// 不限制访问路径）。绝不注册任何写工具。
pub fn build_tools() -> Vec<HarnessTool> {
    let env: Arc<OsExecutionEnv> = Arc::new(OsExecutionEnv::new());
    let context = ExecutionToolContext::new(env.clone(), Some(env));
    vec![
        HarnessTool::new(create_read_tool(&context, None)),
        HarnessTool::new(create_ls_tool(&context, None)),
        HarnessTool::new(create_grep_tool(&context, None)),
        HarnessTool::new(create_find_tool(&context, None)),
    ]
}

/// 只注册的工具名（即 `active_tool_names`）。
pub fn active_tool_names() -> Vec<String> {
    READ_ONLY_TOOLS
        .iter()
        .map(|name| name.to_string())
        .collect()
}

/// 进程内存会话；`InMemorySessionStorage` 天然不落盘。
pub fn build_session() -> Session {
    let storage = Arc::new(InMemorySessionStorage::new(
        SessionMetadata {
            id: "tngui-agent-run".to_string(),
            created_at: 0,
            parent_session_id: None,
        },
        Arc::new(SystemClock),
        Arc::new(DefaultIdGenerator::new()),
    ));
    Session::new(storage, None)
}

/// 组装 `AgentHarnessOptions`：只读工具、空 resources、关闭 compaction、事件走 emitter。
pub fn build_options(
    model: Model,
    effort: AgentEffort,
    system_prompt: Option<String>,
    provider: Arc<dyn Provider>,
    session: Session,
    emitter: Arc<dyn AgentEmitter>,
) -> AgentHarnessOptions {
    AgentHarnessOptions {
        model,
        thinking_level: thinking_level(effort),
        active_tool_names: active_tool_names(),
        tools: build_tools(),
        system_prompt,
        resources: AgentHarnessResources::empty(),
        stream_options: AgentHarnessStreamOptions::default(),
        retry: RetryPolicy::default(),
        // 非目标能力：不做 compaction（避免额外的摘要请求与上下文改写）。
        compaction: CompactionSettings {
            enabled: false,
            ..CompactionSettings::default()
        },
        steering_mode: QueueMode::default(),
        follow_up_mode: QueueMode::default(),
        tool_execution: HarnessToolExecution::default(),
        drive: DrivingMode::default(),
        session,
        allow_existing_session: false,
        models: vec![provider],
        to_provider_messages: None,
        entry_projectors: BTreeMap::new(),
        agent_emitter: Some(emitter),
        before_tool_call: None,
        after_tool_call: None,
        transform_context: None,
        entry_transforms: Vec::new(),
        provider_hooks: None,
    }
}

// ---------------------------------------------------------------------------
// 中性消息 ⇄ rpi 消息的机械转换（只在边界做，不做拍平）
// ---------------------------------------------------------------------------

/// 当前时间（毫秒）；rpi 消息带时间戳字段。
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 中性消息 → rpi `AgentMessage`。
pub fn to_rpi_message(
    message: &AgentMessage,
    api: Api,
    provider: &str,
    model: &str,
) -> rpi_agent::AgentMessage {
    use rpi_agent::AgentMessage as RpiMessage;
    use rpi_ai::types::{Content, StopReason, ToolResultRole, UserContent, UserMessage};

    match message.role {
        AgentRole::User => RpiMessage::User(UserMessage::new(
            UserContent::Text(message.content.clone()),
            now_ms(),
        )),
        AgentRole::Assistant => {
            let mut assistant = rpi_ai::types::AssistantMessage::empty(
                api,
                provider.to_string(),
                model.to_string(),
                now_ms(),
            );
            if !message.content.is_empty() {
                assistant
                    .content
                    .push(Content::text(message.content.clone()));
            }
            let tool_calls = message.tool_calls.clone().unwrap_or_default();
            for call in &tool_calls {
                let arguments = serde_json::from_str(&call.function.arguments)
                    .unwrap_or_else(|_| serde_json::Value::String(call.function.arguments.clone()));
                assistant.content.push(Content::tool_call(
                    call.id.clone(),
                    call.function.name.clone(),
                    arguments,
                ));
            }
            assistant.stop_reason = if tool_calls.is_empty() {
                StopReason::Stop
            } else {
                StopReason::ToolUse
            };
            RpiMessage::Assistant(Box::new(assistant))
        }
        AgentRole::Tool => {
            let result = rpi_ai::types::ToolResultMessage {
                role: ToolResultRole,
                tool_call_id: message.tool_call_id.clone().unwrap_or_default(),
                tool_name: String::new(),
                content: vec![Content::text(message.content.clone())],
                details: None,
                usage: None,
                added_tool_names: Vec::new(),
                is_error: false,
                timestamp: now_ms(),
            };
            RpiMessage::ToolResult(Box::new(result))
        }
    }
}

/// rpi `AgentMessage` → 中性消息。自定义/提示类消息返回 `None`（不进入会话上下文）。
pub fn to_neutral_message(message: &rpi_agent::AgentMessage) -> Option<AgentMessage> {
    use rpi_agent::AgentMessage as RpiMessage;
    use rpi_ai::types::Content;

    match message {
        RpiMessage::User(user) => {
            let content = match &user.content {
                rpi_ai::types::UserContent::Text(text) => text.clone(),
                rpi_ai::types::UserContent::Blocks(blocks) => Content::text_only(blocks, "\n"),
            };
            Some(AgentMessage::new(AgentRole::User, content))
        }
        RpiMessage::Assistant(assistant) => {
            let content = Content::text_only(&assistant.content, "\n");
            let mut tool_calls = Vec::new();
            for block in &assistant.content {
                if let Content::ToolCall(call) = block {
                    tool_calls.push(AgentToolCall {
                        id: call.id.clone(),
                        kind: crate::AgentToolCallKind::Function,
                        function: AgentToolCallFunction {
                            name: call.name.clone(),
                            arguments: call.arguments.to_string(),
                        },
                    });
                }
            }
            Some(AgentMessage {
                role: AgentRole::Assistant,
                content,
                tool_calls: (!tool_calls.is_empty()).then_some(tool_calls),
                tool_call_id: None,
            })
        }
        RpiMessage::ToolResult(result) => Some(AgentMessage {
            role: AgentRole::Tool,
            content: Content::text_only(&result.content, "\n"),
            tool_calls: None,
            tool_call_id: Some(result.tool_call_id.clone()),
        }),
        RpiMessage::Custom(_) => None,
    }
}

/// 工具结果的单行摘要：拼接文本块并截断。
pub fn summarize_tool_result(content: &[rpi_agent::types::TextContentOrImage]) -> String {
    let text = content
        .iter()
        .filter_map(|block| match block {
            rpi_agent::types::TextContentOrImage::Text(text) => Some(text.text.as_str()),
            rpi_agent::types::TextContentOrImage::Image(_) => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let text = text.trim();
    if text.is_empty() {
        return "(无输出)".to_string();
    }
    truncate_chars(text, TOOL_SUMMARY_LIMIT)
}

/// 按字符截断并加省略号。
pub fn truncate_chars(text: &str, limit: usize) -> String {
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= limit {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}
