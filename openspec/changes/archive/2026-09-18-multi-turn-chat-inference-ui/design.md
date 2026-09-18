# Design

## Context

See proposal.md for the user-facing motivation. The current implementation is split across three layers: `InferenceView.vue` owns a single prompt string, a five-step timer, one `output` string and a response card; `send_inference_stream` in `tngui-core` hard-codes a one-message OpenAI body and calls its callback with pure text; the Tauri command forwards that callback through `Channel<String>`. The vLLM 0.26 thinking stream measured on `deepseek-v4-flash-0731` emits `delta.reasoning` first, then `delta.content`; `reasoning_effort` controls whether reasoning is enabled, while `thinking_token_budget` is only a budget after reasoning is already enabled.

App.vue currently renders each page with `v-if`, so navigating away unmounts `InferenceView` and loses all component-local state, including the request tab, prompt/output, stage phase, diagnostics, and the send lock. Current inference also has no request ID or command-level cancellation path, so the frontend cannot stop a long-running vLLM stream after it has started. The existing response card also has two incompatible height models: streaming grows an unbounded flex child, while the completed branch constrains text with a max height. The stage timer and first delta race, so the stream can interrupt the stage animation at an arbitrary phase.

## Goals / Non-Goals

**Goals:**

- Replace the single-request layout with a process-memory multi-turn chat transcript and a bottom composer.
- Retain the complete inference page state across application-internal navigation while the GUI process lives, without writing it to disk.
- Carry true OpenAI-compatible multi-message context without leaking assistant reasoning into later requests.
- Preserve the staged security animation as a deliberate prelude while the network stream continues in the background.
- Separate vLLM 0.26 `reasoning` and `content` increments at the protocol boundary and render both without ambiguity.
- Make the transcript, not each individual response, the only scrolling surface during streaming.
- Let the user stop the active inference request and distinguish complete, stopped, and failed outcomes.
- Use a calm three-color bubble language: light green for normal dialogue, light gold for user-stopped responses, and light red for abnormal termination.
- Keep authorization, model identity, path injection and diagnostic redaction semantics unchanged.

**Non-Goals:**

- Do not persist chat history beyond the GUI process.
- Do not provide conversation export, regeneration, branch editing or token accounting.
- Do not expose `thinking_token_budget`, temperature, max_tokens, top_p or other sampling controls.
- Do not change TNG configuration, the reverse proxy, model discovery, OHTTP/RA semantics, or the `/v1/chat/completions` endpoint shape.
- Do not implement conversation trimming or context compaction; the existing reverse-proxy request-size limit continues to act as the transport guardrail.

## Decisions

### D1: Model the conversation in the frontend with explicit message states

Use a process-scoped message array rather than a single prompt/output pair. Each item is either a durable user message or an assistant turn:

```ts
type ChatRole = "user" | "assistant";
type ChatStatus = "stage-playing" | "streaming" | "complete" | "failed" | "stopped";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  status: ChatStatus;
  phase?: number;
  diagnostic?: string;
}
```

`stopped` is an explicit terminal status, not a subtype of failure: it means the user requested cancellation, not that transport or parsing failed. `InferenceView` owns this array in GUI-process memory, so the message history stays a UI-process concern and does not enter `useInferenceConfig`, settings cache, tng runtime or any backend state. This keeps the model/API-key/ref store focused on configuration and avoids creating an accidental persistence surface.

On send:

1. validate the existing usable gate and non-empty input without trimming input content;
2. append `{role: "user", content}` and clear the composer;
3. append a new assistant turn in `stage-playing`;
4. construct the request from prior completed context plus the new user message;
5. disable further sends until the assistant turn reaches a terminal status after reveal.

For later context, include only user messages and completed assistant turns whose `content` is present. Failed turns remain visible for debugging but are excluded from `messages`; assistant `reasoning` is never copied into a later message.

Alternative considered: store a separate history array only for requests. Rejected because it would duplicate the visible transcript and could diverge from what the user sees.

### D2: Move OpenAI `messages` into the Rust/Tauri contract

Replace the one-string `prompt` parameter with a typed message list at each boundary:

```ts
interface InferenceMessage {
  role: "user" | "assistant";
  content: string;
}
```

The Tauri command and core function take validated `messages`, an `InferenceEffort` enum/string and the existing model/API-key/port parameters. Core serializes the request body as:

```json
{
  "model": "...",
  "messages": [
    {"role":"user","content":"..."},
    {"role":"assistant","content":"..."},
    {"role":"user","content":"..."}
  ],
  "stream": true,
  "reasoning_effort": "medium"
}
```

Core rejects roles other than `user` and `assistant` at the command boundary rather than relying on the UI to sanitize them. Keeping this at the core boundary prevents future callers from injecting unsupported tool/system roles through the command layer.

Alternative considered: keep the prompt string and let the frontend serialize a user-only history into one string. Rejected because it is not real OpenAI-compatible multi-turn context and would lose role boundaries.

### D3: Use a typed two-kind delta channel for vLLM 0.26 reasoning streams

Change the internal SSE payload from a string to:

```ts
type InferenceDeltaKind = "reasoning" | "content";

interface InferenceDelta {
  kind: InferenceDeltaKind;
  text: string;
}
```

In Rust, represent the two kinds as an enum and preserve the existing `Skip`/`Done` classification. Parse non-empty `choices[0].delta.reasoning` as `reasoning`; parse non-empty `choices[0].delta.content` as `content`. An event without either non-empty field remains a no-op, and `data: [DONE]` remains the complete marker.

The Tauri channel should carry the typed payload. Encoding it as a prefixed string would be smaller, but a struct is a compile-time contract and avoids a second string protocol between Rust, TypeScript and tests. The legacy `reasoning_content` name is not added; vLLM 0.26 is the target contract and the current measured stream uses `reasoning`.

Assistant UI rendering keeps the two strings separate. The reasoning block appears above the final content, is visually secondary, and can be collapsed. When content begins, it appears below the thinking block; reasoning is never appended into `content`.

Alternative considered: concatenate reasoning and content using heuristic markers. Rejected because it contaminates the final answer, makes failure-state recovery unreliable, and re-creates the need to strip reasoning before future requests.

### D4: Map the thinking slider directly to `reasoning_effort`

The model select header contains a compact slider with four stops: `关`, `低`, `中`, `高`. Store an in-memory enum defaulting to `medium` and map it to `none`, `low`, `medium`, or `high`. Changing the slider updates only future requests.

`thinking_token_budget` is intentionally not mapped or exposed:

- the measured model does not enter thinking mode when only `thinking_token_budget` is supplied;
- it is a model-specific sampling budget, not a stable high-level strength metaphor;
- `reasoning_effort` is the OpenAI-style field supported by vLLM 0.26 and automatically activates thinking behavior for the measured model.

Alternative considered: a numeric token-budget slider. Rejected because it exposes an implementation detail and still requires another field to enable reasoning on this model.

### D5: Use a four-way stage/stream race state machine

Each assistant turn has one state machine rather than letting the current global `streaming` flag mutate all response rendering:

```text
stage-playing
  -> final-stage-hold
  -> streaming
  -> complete | failed | stopped
```

The stage timer follows the existing five-step/520ms cadence. When the phase reaches the final index, record `finalStageAt`; the timer stops. A reveal is triggered only when all of the following are true:

```text
phase == final index
performance.now() - finalStageAt >= 500
receivedReasoning || receivedContent
```

The network request and stage animation start concurrently. Before reveal, delta handlers only update buffers and booleans on the current assistant message; they do not mutate visible text. When reveal happens, copy buffered reasoning/content into the message and set `status = "streaming"`. Later deltas append directly to the appropriate field.

If `[DONE]` resolves before reveal, retain a `networkComplete` flag and wait for the same reveal condition. On reveal, show buffered text and immediately mark the turn complete. If the request rejects, cancel the pending reveal timer, set `failed`, preserve whatever reasoning/content arrived, and show the redacted diagnostic. A rejection with no delta still enters the failure branch; it does not wait for the one-delta condition.

Timers must be tracked per turn and cleared when the turn reaches a terminal state or when the application actually unmounts; switching to another application page must not clear them. User cancellation also enters a terminal state immediately. If output is already visible (`streaming`), prior reasoning/content remains exactly as displayed. If output is still hidden (`stage-playing`), buffered reasoning/content is discarded and never revealed; the assistant bubble body is blank apart from its status marker. After `stopped`, any delta that was already queued in the Tauri channel is ignored. Time and animation cadence should be constants so component tests can use fake timers or inject deterministic delay helpers rather than sleeping through the real 2.58-second prelude.

Alternative considered: let the first delta cancel the stage animation as today. Rejected because its phase is determined by network speed, not by the security narrative, and it prevents the final card from being legible.

### D6: Make the transcript the only fixed-height streaming scroller

The chat card is a vertical flex container:

```text
chat card
+-------------------------------------------+
| header: model select + thinking control    |
+-------------------------------------------+
| transcript: flex: 1; min-height: 0;        |
| overflow-y: auto                           |
+-------------------------------------------+
| composer: textarea auto-size 1..8 + send   |
+-------------------------------------------+
```

The transcript gets a fixed card height, `min-height: 0`, and `overflow-y: auto`. User and assistant bubbles may grow, but the card does not. The completed state reuses the same transcript nodes instead of switching to a separate response-card branch, eliminating the current grow-then-shrink behavior.

Auto-scroll after `nextTick` whenever a message is added, stage reveal occurs, or a delta lands. Set `scrollTop = scrollHeight` directly. The requirements intentionally ask for always-follow behavior, so no “user scrolled up” suppression heuristic is added. Many deltas in the same animation frame can coalesce to one scroll update through `requestAnimationFrame` or Vue batching to avoid layout thrashing while preserving visibility semantics.

The composer uses Ant Design Vue textarea autosize with `minRows: 1`, `maxRows: 8`, and `resize: none`. It keeps `autocapitalize="off"`, `autocorrect="off"`, and `spellcheck="false"`; actual sent text is not trimmed.

Alternative considered: constrain each assistant bubble with its own max height and scroll. Rejected because the requirement is a coherent multi-turn transcript, and nested per-response scroll areas make the latest conversation tail harder to see.

### D7: Keep the inference page alive across application navigation

Preserve the inference page by caching the actual `InferenceView` component rather than copying its state into another store. In `App.vue`, render the active view through a dynamic component wrapped with `<KeepAlive include="InferenceView">`, and give `InferenceView.vue` an explicit `defineOptions({ name: "InferenceView" })`. Only this view is cached, so Overview and Settings keep their existing lifecycle semantics.

While the user leaves the inference page, Vue emits `deactivated` instead of `unmounted`; the component, refs, watchers, pending Tauri promise, stage timers, message array, model-discovery state, draft, and send lock remain alive. The stream callback may continue mutating process-scoped state. `onDeactivated` must not reset state, cancel the request, or clear timers. On return, `activated` runs after `nextTick` and scrolls the transcript to the new bottom if output arrived while detached. `onBeforeUnmount` remains the final cleanup point for application teardown; process exit inherently discards the JavaScript heap.

Alternative considered: move every field into a module-level or app-provided singleton store. That would preserve state under remounting, but it duplicates the component state model, requires explicit handoff for tabs, scroll position, timers, and in-flight requests, and still risks divergence. KeepAlive preserves the real component instance and its reactive state directly.

### D8: Stop inference as an explicit per-request operation

The composer action is context-sensitive:

```text
idle / terminal    -> 发送
in-flight          -> 停止
```

Each send generates a unique request ID that travels with the assistant turn. The Tauri layer keeps a process-memory registry for the currently active request, mapping that ID to a cancellation sender. A separate `stop_inference_stream` command receives the request ID, removes the sender from the registry, and signals cancellation. The send command races the core stream future against cancellation:

```text
core stream finishes normally -> Completed
cancellation wins             -> Stopped
```

Cancellation returns a successful outcome rather than an error string. Dropping the core future closes its TCP stream, so the server-side stream terminates without sending another SSE event to the client. The registry entry is removed on normal completion, stop, error, and command teardown to keep the operation idempotent; a stop call for an already terminal request is a benign no-op.

The frontend marks the turn `stopped` as soon as the user clicks stop and ignores later channel deltas. This prevents a long-running stream from continuing to mutate the visible transcript while the backend command returns. The request lock releases after the turn reaches `stopped`, and the next request excludes that assistant turn from context. If normal completion wins before cancellation is applied, the turn remains `complete`; no terminal state is downgraded.

Alternative considered: rely only on frontend promise cancellation. Rejected because Tauri command execution and the Rust TCP reader would continue in the backend, leaving the inference stream alive.

### D9: Use calm outcome-tinted bubble colors

Bubble color describes the response outcome and is defined in theme tokens to avoid scattered hard-coded styles:

```css
--chat-bubble-success-bg: #f4faee;
--chat-bubble-success-border: rgba(82, 196, 26, .22);
--chat-bubble-stopped-bg: #fff6df;
--chat-bubble-stopped-border: rgba(217, 119, 6, .22);
--chat-bubble-failed-bg: #fff1ef;
--chat-bubble-failed-border: rgba(255, 77, 79, .22);
```

User bubbles and assistant bubbles in `stage-playing`, `streaming`, and `complete` states use the same soft-green success tone, so the visual base of a normal conversation stays stable while the status tag distinguishes “安全链路” and “生成中”. A user-stopped assistant turn uses the warm light-gold token. A connection, HTTP, SSE, or parsing failure uses the soft red token. Text stays dark and the status tag follows the same success/warning/error semantics.

Alternative considered: reuse only Ant status tag colors and leave bubbles neutral. Rejected because the user explicitly requested a visible, at-a-glance classification for normal, intentionally interrupted, and abnormal responses.

## Risks / Trade-offs

- [Large buffered reasoning can appear all at once] → Reveal copies buffered data once and only fires subsequent DOM appends for new deltas; tests cover a long reasoning burst, reveal and follow-up streaming.
- [High delta rate may cause layout thrashing] → Coalesce automatic scrolling once per frame and let Vue batch state mutation; do not batch or drop delta payloads at the protocol layer.
- [Session context can grow toward the reverse proxy request-size cap] → Preserve the existing proxy 10 MiB guardrail and show its existing failure diagnostic; do not silently trim or rewrite user context.
- [The 500ms final-stage hold increases perceived latency] → This is deliberate to satisfy the requested animation contract; no chunk does not force an empty reveal.
- [`reasoning_effort` may be ignored by non-thinking models or rejected by third-party OpenAI-compatible servers] → Keep the error and request/response diagnostic path; do not silently resend without the field.
- [Typed Tauri payload changes the command contract] → Update core, wrapper and component tests in the same change so stale call sites fail compilation/type checking rather than sending malformed bodies.
- [Timer races on completion] → Use one per-turn state machine, clear stage and reveal timers on terminal/application-unmount, and test completion-before-reveal, failure-before-reveal, and stop-before-reveal explicitly.
- [Stop and normal completion can race] → Use one request ID plus a process-memory cancellation registry; whichever terminal state is applied first wins, the other path is idempotent, and component tests exercise both orderings.
- [Late Tauri channel events could mutate a stopped turn] → Mark the turn stopped synchronously and ignore incoming deltas when a turn is no longer active or already terminal.
- [KeepAlive can keep stale timers or requests alive] → It is intentional for in-flight inference; use the existing single-send lock, continue all state transitions while detached, and clean up only on terminal state or final component unmount.
- [Process-lifetime memory grows without persistence] → This is intentional; no disk migration is introduced, and process exit resets the transcript, model discovery, slider, and in-flight state.

## Migration Plan

1. Introduce typed delta and message contracts, update the core function and Tauri channel first.
2. Replace the single prompt/output UI with the message transcript and composer while preserving the existing model gate.
3. Integrate the reasoning/content streams, thinking slider, buffered stage reveal, request cancellation, and terminal-state bubble colors; keep `InferenceView` alive across application navigation.
4. Update component/core tests and docs in the same change.
5. Validate with the existing local vLLM 0.26 endpoint: default medium reasoning, off/low/medium/high mapping, one-turn and multi-turn request bodies, stop during stage animation, stop during visible streaming, stream interruption with partial text, failure diagnostic redaction, and retention of state when navigating away and back within the same process.

Rollback is a single revert of the UI/core commit. No persisted schema or TNG configuration migration is introduced.
