# Tasks

## 1. Capi route metadata and direct proxy branch

- [x] 1.1 Add direct model-discovery origin metadata to the existing proxy route type, including an explicit absent-origin state, and verify the core crate compiles with `cargo check -p tngui-core`
- [x] 1.2 Extend ingress preparation to derive the model-discovery origin from `http_proxy` TLS semantics or `mapping out.host/out.port`, and add config tests for HTTPS, HTTP, explicit port, mapping, and invalid/absent origin cases
- [x] 1.3 Add TLS-enabled direct HTTP client support for model discovery and verify port/scheme/hostname handling compiles without changing the existing raw TCP tng-ingress forwarding path
- [x] 1.4 Add an exact `GET /v1/models` direct branch that preserves query and business-auth headers, ignores `x-model`, does not enter tng, and returns a clearly labeled failure when the capi origin is absent or unreachable
- [x] 1.5 Add proxy tests proving `/v1/models` and `/v1/models?trace=1` bypass the tng upstream while `/v1/models/other`, `POST /v1/models`, and the existing inference endpoints retain their current paths
- [x] 1.6 Run `cargo test -p tngui-core -- --test-threads=1` and confirm every new direct-origin/config/proxy test plus the existing proxy tests pass

## 2. Tauri model-discovery command

- [x] 2.1 Implement an OpenAI-compatible model-list parser that validates 2xx JSON object responses, extracts nonblank string `data[].id` values, preserves each ID exactly as returned, and returns an explicit error for invalid response shapes
- [x] 2.2 Add unit tests for successful parsing, empty `data`, blank IDs, a non-object response, a non-array `data`, and a non-2xx local-proxy response
- [x] 2.3 Add a Tauri `list_models(port)` command that requests the local pre-TNG proxy without sending the inference API key, and verify the command is registered alongside the existing inference commands
- [x] 2.4 Wrap the command in a dedicated internal HTTP request error type or shared failure diagnostic so the UI can distinguish model-discovery failure from a successful empty list
- [x] 2.5 Run `cargo test --workspace -- --test-threads=1` and confirm the new command/parser tests plus the existing Tauri command tests pass

## 3. Frontend state machine and inference view

- [x] 3.1 Extend the session-only inference composable with model list, loading, loaded-empty, loaded-nonempty, and failed states plus an invariant-preserving list replacement selector, and add focused state tests for 0/1/N models, retained selection, and first-item fallback
- [x] 3.2 Wire `InferenceView` lifecycle and the existing proxy endpoint watcher to call `list_models` when a local endpoint is available, and verify a failed or missing endpoint does not present selectable options
- [x] 3.3 Replace the free-text model input with a non-creatable, non-clearable option dropdown and verify 0, 1, multiple, loading, and failed states render the correct state text and disabled behavior
- [x] 3.4 Update the send gate and send handler so a model must be selected from the loaded list, and verify selecting a model causes `send_inference` to receive exactly that service-returned ID
- [x] 3.5 Update the cURL example and Model ID preview to reflect the selected model only, or the appropriate empty/failed state, and verify no arbitrary `model` placeholder is shown as a usable value
- [x] 3.6 Prove the model list and selected model stay session-only by ensuring the settings-cache payload construction and settings-cache tests contain neither model nor model-list fields
- [x] 3.7 Replace/extend `InferenceView` component tests to cover empty, single, multiple, failed, refresh-fallback, filtered-only selection, and send-disabled behavior for the model dropdown

## 4. Documentation and user-facing copy

- [x] 4.1 Update the README pre-TNG proxy description to document the exact `GET /v1/models` exception, query/header behavior, and unchanged inference path contract
- [x] 4.2 Update the UI guide's inference-page description to document the server-driven dropdown, empty/one/many model behavior, load-fail state, and session-only model selection rules
- [x] 4.3 Update user-facing state copy to distinguish the direct model-metadata path from the protected inference path, and read the completed docs to verify no claim applies remote attestation to `/v1/models`

## 5. Regression and validation

- [x] 5.1 Run the complete frontend regression with `cd frontend && npm test && npm run typecheck` and confirm every existing prompt/output test not replaced by this change still passes
- [x] 5.2 Run the complete Rust/Tauri regression in the documented Ubuntu chroot with `cargo test --workspace -- --test-threads=1` and confirm all workspace tests pass
- [x] 5.3 Run `openspec validate --change capi-model-discovery --strict` and resolve any formatting or modified-requirement consistency errors before implementation review
- [x] 5.4 Re-read the completed proposal, spec delta, design, and tasks side by side to confirm the release-review checklist, empty-string messaging, selected-model invariant, and direct-path security boundary are all represented without mutually contradictory scenarios
