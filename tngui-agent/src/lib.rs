//! TNG-GUI Agent 模式运行器：基于 rpi（`rpi-ai` / `rpi-agent` / `rpi-tools` /
//! `rpi-harness`）在单次用户交互内驱动"模型 ↔ 工具"多轮循环。
//!
//! 设计约束（见 `openspec/changes/inference-rpi-agent-mode/design.md`）：
//!
//! * 本 crate 是 `tngui-core` / `tngui-chat` 的**平行兄弟**，绝不依赖它们；rpi 的
//!   整套依赖图只出现在这里。tngui 反代命令层（`tngui-app`）负责把中性消息模型与
//!   这里的事件做**机械转换**。
//! * 只注册只读工具 `read` / `ls` / `grep` / `find`，不限制访问路径。
//! * 会话由 `InMemorySessionStorage` 支撑，天然不落盘。
//! * 事件以 [`InferenceEvent`] 流式暴露给调用方；本 crate 不感知 Tauri。

pub mod config;
pub mod runner;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

/// 中性工具调用类型；当前只支持 `function`（OpenAI compatible 唯一形态）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentToolCallKind {
    Function,
}

/// `tool_calls[].function`：工具名与 JSON 编码的参数串（原样透传）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentToolCallFunction {
    pub name: String,
    pub arguments: String,
}

/// OpenAI compatible 工具调用，只出现在 assistant 消息的 `tool_calls` 中。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: AgentToolCallKind,
    pub function: AgentToolCallFunction,
}

/// 中立的 OpenAI compatible 消息（与 `tngui-chat` 的消息模型同形，但本 crate 不
/// 依赖它；两者由 `tngui-app` 机械互转）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentMessage {
    pub role: AgentRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<AgentToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl AgentMessage {
    pub fn new(role: AgentRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
        }
    }
}

/// OpenAI compatible 消息角色（`system` 由 `system_prompt` 单独注入）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRole {
    User,
    Assistant,
    Tool,
}

/// 思考强度，取值与 GUI 的"关/低/中/高"一一对应。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentEffort {
    None,
    Low,
    #[default]
    Medium,
    High,
}

/// 工具调用在前端的执行状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolStatus {
    Running,
    Ok,
    Error,
    Cancelled,
}

/// Agent 模式暴露给前端的统一流式事件。
///
/// 形状与 `tngui_chat::InferenceEvent` 保持一致（同一份前端 reducer 消费两者）；
/// `tngui-app` 负责在命令层做一一对应的转换，本 crate 通过单测钉住这一形状。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InferenceEvent {
    /// 一轮模型请求开始；`turn` 从 1 开始计数。
    TurnStart { turn: u32 },
    /// reasoning 增量。
    ReasoningDelta { text: String },
    /// 正文（最终回答）增量。
    ContentDelta { text: String },
    /// 工具调用开始；`arguments` 是模型给出的 JSON 参数原文。
    ToolStart {
        id: String,
        name: String,
        arguments: String,
    },
    /// 工具调用结束；`summary` 是结果摘要。
    ToolEnd {
        id: String,
        status: ToolStatus,
        summary: String,
    },
    /// 提示信息，例如达到轮数上限的终止摘要。
    Notice { message: String },
    /// 本轮全部完成。
    Done,
    /// 本轮失败，`message` 是可读错误。
    Error { message: String },
}
