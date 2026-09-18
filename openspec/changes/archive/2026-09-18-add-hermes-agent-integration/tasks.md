# Tasks

## 1. Frontend asset and integration guide

- [x] 1.1 Move the supplied screenshot from the repository root to `frontend/src/assets/hermes-agent-config.png`, import it as a bundled Vite asset, and verify that the new asset file exists while the root-level `hermes-agent-config.png` is absent
- [x] 1.2 Replace the DeepSeek Client heading, visual mark, setup steps, and `deepSeekClientConfig` in `InferenceView.vue` with Hermes Agent introduction, safe official-homepage link, `hermes model` custom-endpoint steps, dynamic `hermesAgentConfig`, and responsive screenshot rendering; verify by the component test in task 2.1
- [x] 1.3 Replace `.deepseek-mark` in `frontend/src/assets/theme.css` with Hermes-specific styling and add responsive screenshot styles; verify `grep -R "deepSeekClientConfig\\|deepseek-mark\\|DeepSeek Client" frontend/src` returns no match

## 2. Tests and behavior verification

- [x] 2.1 Update `InferenceView.component.test.ts` so the integration-tab test verifies the Hermes Agent title, official link, custom-endpoint steps, dynamic configuration example, screenshot, local-endpoint security warning, and absence of DeepSeek Client guidance; verify with `npm test -- src/views/InferenceView.component.test.ts`
- [x] 2.2 Add focused assertions for unavailable-endpoint and model-discovery failure states so the Hermes configuration example shows visible fallback text without fabricating values; verify with `npm test -- src/views/InferenceView.component.test.ts`
- [x] 2.3 Run `npm run typecheck` and `npm test` in `frontend` and verify both complete successfully

## 3. Documentation and final consistency check

- [x] 3.1 Update `docs/tngui-ui-guide.md` section 4.2 to document Hermes Agent introduction, official homepage, `hermes model` custom-endpoint procedure, configuration example, screenshot, and local-address warning; verify the section no longer names DeepSeek Client
- [x] 3.2 Perform a final source consistency check that `frontend/src` and `docs/tngui-ui-guide.md` contain the Hermes Agent link with `target="_blank"` and `rel="noopener noreferrer"`, contain no DeepSeek Client integration guidance, and leave TNG configuration, backend, and protocol behavior untouched; verify with targeted grep and `git status --short`
