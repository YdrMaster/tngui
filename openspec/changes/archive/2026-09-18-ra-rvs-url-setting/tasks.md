# Tasks

## 1. Config Model & Settings Cache

- [x] 1.1 Extend the frontend TNG config state and serializer with a global RVS address field, while keeping the field out of the TNG runtime JSON, and verify by a unit test that a config containing the field still serializes to valid TNG JSON.
- [x] 1.2 Add the RVS address to the settings-cache snapshot/parse shape with first-run default `https://rvs.tsk.com:9443`, and verify with cache tests covering default, valid-cache restore, and unknown/invalid-value fallback.
- [x] 1.3 Preserve and restore the user-entered RVS address on subsequent sessions, and verify with the cache-lifecycle tests that a user field is not overwritten by the default value.

## 2. Settings UI

- [x] 2.1 Add a “远程证明服务配置” block under the TNG configuration area when any ingress has RA enabled, and verify through a UI/config test that the block and input appear only in that state.
- [x] 2.2 Bind the RVS address input to the config state, use existing text-input accessibility settings where applicable, and verify the displayed and submitted values stay in sync with the config model.
- [x] 2.3 Include RVS-address changes in the existing TNG dirty/leave-settings auto-restart logic, and verify with settings-lifecycle tests that a change alone triggers save/restart when tng is running.
- [x] 2.4 Adjust the frontend launch wrapper so `launchTng` submits both the TNG config JSON and the current RVS address to the backend, and verify with a test that the backend receives the same value shown in the UI.

## 3. TNG Process Launch

- [x] 3.1 Extend the backend launch path to carry the RVS address from the Tauri command through `TngSupervisor::build_command`, and verify with a backend unit test that the address reaches the generated tng process command.
- [x] 3.2 Inject the configured value into `RATS_TEE_VERIFIER_URL` for RA launches while leaving non-RA launches unchanged, and verify with unit tests that env injection is RA-only.
- [x] 3.3 Confirm that the created `tng-runtime.json` never contains the UI-side RVS field, and verify with a config-generation regression test against a known TNG strict-schema sample.

## 4. Verification

- [x] 4.1 Run the frontend test suite and TypeScript checks, and verify the new/modified settings, cache, and launch tests pass locally.
- [x] 4.2 Run the Rust test suite, and verify the tng-supervisor and launch-command tests pass.
- [x] 4.3 Update or add docs only where needed for the new setting, and verify user-facing wording uses the exact title “远程证明服务配置”.
- [x] 4.4 Run `openspec validate ra-rvs-url-setting --type change --strict` locally and verify the planning artifacts pass validation.
