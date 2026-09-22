# Tasks

## 1. Identity Prompt State and UI

- [x] 1.1 Add a dedicated editable identity prompt constant in the密态推理调试页, and introduce the three page-local state refs (`identityPromptEnabled`, `identityPrompt`, `identityPromptEditorOpen`); verify with a component test that `identityPromptEnabled` default is `true`, `identityPromptEditorOpen` default is `false`, and `identityPrompt` exactly equals the built-in Ant Misuan / TEE / remote-attestation copy.
- [x] 1.2 Insert the identity control group into the existing request-toolbar space between the model select and thinking slider, and implement the fixed-width editor overlay below the “编辑身份” button; verify with `InferenceView.component.test.ts` that the controls render in the correct order, the editor backdrop is hidden by default, and the editor overlay uses `width: 480px` with `autoSize` set to `minRows: 4`, `maxRows: 12`.
- [x] 1.3 Preserve the identity state when switching views and reset it after a process-like remount; verify in the existing KeepAlive-style component test that `identityPromptEnabled`, `identityPrompt`, and `identityPromptEditorOpen` survive view switches and return to defaults after a fresh remount.
- [x] 1.4 Keep the identity state strictly page-local and confirm it never enters the settings cache, runtime config, or any persisted snapshot; verify with the existing `settingsCache` tests and updated InferenceView tests that no identity field leaks into those payload builders.
- [x] 1.5 Confirm the toggle-off and narrow-window behavior: when `identityPromptEnabled` is `false`, no system message is sent; verify with a component test that the send call passes `systemPrompt: null` and the editor remains hidden after the toggle is off, while the smallest supported window still aligns the three top-bar sections without overlap.

## 2. Request Contract and Backend

- [x] 2.1 Extend `frontend/src/tauri.ts` and the `send_inference_stream` command in `src/lib.rs` with an explicit `systemPrompt: string | null` argument, keeping `InferenceRole` as `user` / `assistant` only; verify with `frontend/src/tauri.test.ts` and the Rust command tests that the new parameter is round-tripped and that directly calling the command without identity injection still works.
- [x] 2.2 Update `tngui-core/src/inference.rs` request assembly so that when `systemPrompt` is present, a system message is prepended to `messages` before the existing user / assistant history, and `stream`, `reasoning_effort`, and other body semantics remain unchanged; verify with the Rust core test that `messages[0]` is system when enabled and no system message exists when disabled.
- [x] 2.3 Ensure the identity prompt text is never trimmed, transformed, or local-formatted anywhere in the path from the UI to the request body; verify with a dedicated unmodified-text assertion in both the component test and the Rust request-body test.
- [x] 2.4 Confirm that either a disabled toggle or a null `systemPrompt` produces an unchanged request body, while enabling the toggle with an empty string still sends a system message; verify with the Rust core request contract tests that Boolean presence, not string truthiness, drives the injection.

## 3. Regression and Interface Integrity

- [x] 3.1 Keep the reverse proxy contract unchanged; do not parse, add, or rewrite message roles in the proxy layer, and do not add any identity-specific header there. Verify by running the existing `tngui-core/src/proxy.rs` tests and confirming direct client requests still preserve body bytes and only rewrite the model path.
- [x] 3.2 Ensure the identity feature cannot affect direct reverse-proxy clients by keeping the debug-page-only send path fully separate from the proxy and route modules. Verify with a targeted regression check that direct client request bodies remain identical when the feature flag is enabled and disabled.
- [x] 3.3 Update `docs/tngui-ui-guide.md` section 4.1 to describe the identity controls, default prompt, fixed 480px editor, and page-only scope. Verify the documentation explicitly states that the feature is a debug-page assistant, not a general reverse-proxy behavior or global memory feature.

## 4. Build, Typecheck, and Full Validation

- [x] 4.1 Add or update the InferenceView component tests covering default-enabled, toggle-off, edit-prompt, in-flight request unchanged by later edits, page-state retention, and fresh-process reset. Verify with `npx vitest run src/views/InferenceView.component.test.ts`.
- [x] 4.2 Add or update the inference request and Tauri-wrapper tests to cover system prompt ordering, unmodified text, role boundaries, reverse-proxy unaffectedness, and toggle behavior. Verify with `cargo test send_inference_stream` and `npx vitest run src/tauri.test.ts`.
- [x] 4.3 Run the full frontend typecheck, frontend suite, Rust suite, and overall build. Verify via `npm run typecheck`, `npm test`, `cargo test`, and `cargo build` that the implementation and tests pass together.
