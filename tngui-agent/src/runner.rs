//! 单次 Agent 运行：装配 harness → 灌入既有上下文 → 驱动本轮（含工具循环）→ 导出新增消息。

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use futures::future::BoxFuture;
use rpi_agent::{AgentEmitter, AgentEvent};
use rpi_ai::types::AssistantMessageEvent;
use rpi_harness::agent_harness::{AgentHarness, HarnessRunOutcome, SendMessageResult};
use rpi_harness::events::RunStartEvent;
use rpi_harness::run_budget::{MAX_TURNS_ENV, RunBudget};
use rpi_harness::types::{MessageDelivery, SendMessageOptions};
use tokio::sync::oneshot;

use crate::config as assembly;
use crate::{AgentEffort, AgentMessage, InferenceEvent, ToolStatus};

/// 启动期补默认轮数上限（30）；用户已显式设置则完全尊重用户值。
///
/// rpi 的轮数上限只能经环境变量配置（`AgentHarness.max_turns` 无公开 setter），且
/// edition 2024 下 `set_env` 是 `unsafe`，因此只在进程启动、命令可执行之前调用一次。
pub const DEFAULT_MAX_TURNS: u32 = 30;

/// 若 `RPI_MAX_TURNS_PER_RUN` 未设置则写入 [`DEFAULT_MAX_TURNS`]；返回是否写入。
pub fn ensure_default_max_turns_env() -> bool {
    if std::env::var_os(MAX_TURNS_ENV).is_some() {
        return false;
    }
    // SAFETY: 只在进程启动、任何命令可执行之前单点写入；写入后不再修改。
    unsafe { std::env::set_var(MAX_TURNS_ENV, DEFAULT_MAX_TURNS.to_string()) };
    true
}

/// 事件接收端：命令层把它包成 Tauri `Channel`。
pub type EventSink = Arc<dyn Fn(InferenceEvent) + Send + Sync>;

/// 一次 Agent 运行的请求。
pub struct AgentRunRequest {
    /// 此前已完成的会话上下文（不含本轮用户输入）。
    pub context: Vec<AgentMessage>,
    /// 本轮用户输入（必须是一条 user 消息）。
    pub prompt: AgentMessage,
}

/// 运行配置（一次运行一份）。
pub struct AgentRunConfig {
    pub port: u16,
    pub model_id: String,
    pub api_key: String,
    pub system_prompt: Option<String>,
    pub effort: AgentEffort,
}

/// 运行结果：`stopped` 为 true 时 `messages` 必为空（停止的消息不进入上下文）。
#[derive(Debug)]
pub struct AgentRunOutcome {
    pub stopped: bool,
    pub messages: Vec<AgentMessage>,
}

/// `AgentEvent` → [`InferenceEvent`] 适配器；同时收集运行产生的消息序列。
pub struct InferenceEventEmitter {
    sink: EventSink,
    turns: AtomicU32,
    aborted: AtomicBool,
    completed: StdMutex<Vec<AgentMessage>>,
    budget: RunBudget,
}

impl InferenceEventEmitter {
    pub fn new(sink: EventSink) -> Self {
        Self {
            sink,
            turns: AtomicU32::new(0),
            aborted: AtomicBool::new(false),
            completed: StdMutex::new(Vec::new()),
            budget: RunBudget::from_env(),
        }
    }

    fn emit(&self, event: InferenceEvent) {
        (self.sink)(event);
    }

    /// 由命令层在请求取消时调用，用于把正在执行的工具标成"已取消"。
    pub fn mark_aborted(&self) {
        self.aborted.store(true, Ordering::SeqCst);
    }

    /// 取走运行产生的新增消息（工具结果 + assistant 消息，按到达顺序）。
    fn take_completed(&self) -> Vec<AgentMessage> {
        std::mem::take(&mut self.completed.lock().unwrap())
    }

    pub(crate) fn handle(&self, event: AgentEvent) {
        match event {
            AgentEvent::TurnStart => {
                let turn = self.turns.fetch_add(1, Ordering::SeqCst) + 1;
                self.emit(InferenceEvent::TurnStart { turn });
            }
            AgentEvent::MessageUpdate {
                assistant_message_event,
                ..
            } => match assistant_message_event {
                AssistantMessageEvent::ThinkingDelta { delta, .. } if !delta.is_empty() => {
                    self.emit(InferenceEvent::ReasoningDelta { text: delta });
                }
                AssistantMessageEvent::TextDelta { delta, .. } if !delta.is_empty() => {
                    self.emit(InferenceEvent::ContentDelta { text: delta });
                }
                _ => {}
            },
            AgentEvent::ToolExecutionStart {
                tool_call_id,
                tool_name,
                args,
            } => {
                self.emit(InferenceEvent::ToolStart {
                    id: tool_call_id,
                    name: tool_name,
                    arguments: args.to_string(),
                });
            }
            AgentEvent::ToolExecutionEnd {
                tool_call_id,
                result,
                is_error,
                ..
            } => {
                let status = if self.aborted.load(Ordering::SeqCst) {
                    ToolStatus::Cancelled
                } else if is_error {
                    ToolStatus::Error
                } else {
                    ToolStatus::Ok
                };
                self.emit(InferenceEvent::ToolEnd {
                    id: tool_call_id,
                    status,
                    summary: assembly::summarize_tool_result(&result.content),
                });
            }
            AgentEvent::RetryScheduled {
                attempt,
                max_retries,
                error,
                ..
            } => {
                self.emit(InferenceEvent::Notice {
                    message: format!("模型请求失败，正在重试（{attempt}/{max_retries}）：{error}"),
                });
            }
            AgentEvent::AgentEnd { messages } => {
                let neutral: Vec<AgentMessage> = messages
                    .iter()
                    .filter_map(assembly::to_neutral_message)
                    .collect();
                *self.completed.lock().unwrap() = neutral;
                let limit = self.budget.max_turns();
                let turns = self.turns.load(Ordering::SeqCst);
                if limit > 0 && turns >= limit {
                    self.emit(InferenceEvent::Notice {
                        message: format!(
                            "已达单次运行轮数上限（{turns}/{limit}），本次运行已停止，可发送后续消息继续。"
                        ),
                    });
                }
                self.emit(InferenceEvent::Done);
            }
            _ => {}
        }
    }
}

impl AgentEmitter for InferenceEventEmitter {
    fn emit(&self, event: AgentEvent) -> BoxFuture<'static, ()> {
        self.handle(event);
        Box::pin(async {})
    }

    fn try_emit(&self, event: AgentEvent) {
        self.handle(event);
    }
}

/// 驱动一次 Agent 运行。
///
/// 取消语义：`cancellation` 命中即调用 `AgentHarness::request_abort(run_id)` 并等待
/// harness 收敛，收敛后按 `stopped` 返回（不是失败）。
pub async fn run_agent_turn(
    config: AgentRunConfig,
    request: AgentRunRequest,
    cancellation: oneshot::Receiver<()>,
    sink: EventSink,
) -> Result<AgentRunOutcome, String> {
    let emitter = Arc::new(InferenceEventEmitter::new(sink));
    let model = assembly::build_model(config.port, &config.model_id);
    let api = model.api.clone();
    let provider = assembly::build_provider(&config.api_key, model.clone())?;
    let options = assembly::build_options(
        model,
        config.effort,
        config.system_prompt.clone(),
        provider,
        assembly::build_session(),
        emitter.clone(),
    );
    let harness = Arc::new(
        AgentHarness::create(options)
            .await
            .map_err(|e| format!("初始化 Agent 运行失败: {e}"))?,
    );

    // 灌入既有上下文（逐条 append，保持原顺序与角色）。
    for message in &request.context {
        let rpi_message = assembly::to_rpi_message(
            message,
            api.clone(),
            assembly::PROVIDER_ID,
            &config.model_id,
        );
        harness
            .append_message(rpi_message)
            .await
            .map_err(|e| format!("写入既有会话上下文失败: {e}"))?;
    }

    // 运行开始后拿到 run_id，供取消使用。
    let (run_id_tx, run_id_rx) = tokio::sync::watch::channel::<Option<String>>(None);
    let _run_start_guard = harness.events().on::<RunStartEvent, _>(move |event| {
        let _ = run_id_tx.send(Some(event.run_id.clone()));
    });

    let abort_emitter = emitter.clone();
    let abort_harness = harness.clone();
    let abort_task = tokio::spawn(async move {
        if cancellation.await.is_err() {
            return;
        }
        let mut run_id_rx = run_id_rx;
        let run_id = loop {
            let current = run_id_rx.borrow_and_update().clone();
            if current.is_some() {
                break current;
            }
            if run_id_rx.changed().await.is_err() {
                break None;
            }
        };
        if let Some(run_id) = run_id {
            abort_emitter.mark_aborted();
            let _ = abort_harness.request_abort(&run_id).await;
        }
    });

    let prompt = assembly::to_rpi_message(
        &request.prompt,
        api.clone(),
        assembly::PROVIDER_ID,
        &config.model_id,
    );
    let result = harness
        .send_message(
            prompt,
            SendMessageOptions {
                trigger_turn: Some(true),
                deliver_as: MessageDelivery::Steer,
            },
        )
        .await;
    abort_task.abort();

    match result {
        Ok(SendMessageResult::Run(run)) => match run.outcome {
            HarnessRunOutcome::Completed { .. } => {
                let mut messages = emitter.take_completed();
                // AgentEnd 会把本轮 prompt 原样回带；它已由前端记入共享会话，去重。
                if messages
                    .first()
                    .is_some_and(|first| first == &request.prompt)
                {
                    messages.remove(0);
                }
                Ok(AgentRunOutcome {
                    stopped: false,
                    messages,
                })
            }
            HarnessRunOutcome::Aborted { .. } => Ok(AgentRunOutcome {
                stopped: true,
                messages: Vec::new(),
            }),
            HarnessRunOutcome::Failed { error, .. } => {
                let message = format!("模型/工具运行失败: {}（{}）", error.message, error.code);
                emitter.emit(InferenceEvent::Error {
                    message: message.clone(),
                });
                Err(message)
            }
            HarnessRunOutcome::Suspended { .. } => {
                let message = "本次运行被挂起，当前不支持继续该运行".to_string();
                emitter.emit(InferenceEvent::Error {
                    message: message.clone(),
                });
                Err(message)
            }
        },
        Ok(other) => {
            let message = format!("Agent 运行未启动: {other:?}");
            emitter.emit(InferenceEvent::Error {
                message: message.clone(),
            });
            Err(message)
        }
        Err(error) => {
            let message = format!("Agent 运行失败: {error}");
            emitter.emit(InferenceEvent::Error {
                message: message.clone(),
            });
            Err(message)
        }
    }
}
