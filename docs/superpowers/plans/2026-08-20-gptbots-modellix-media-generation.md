# GPTBots + Modellix Media Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure local companion service that drives GPTBots conversations, validates GPTBots media-tool proposals, submits fixed Modellix image/video adapters, persists async jobs, and saves successful outputs into the existing local media library.

**Architecture:** Vite loads a focused local-companion plugin that serves same-origin `/api/*` endpoints and keeps provider secrets outside the repository. Pure parser, adapter, provider-client, and job-state modules remain independently testable; React consumes those endpoints through a typed client and retains only visible/transient interaction state.

**Tech Stack:** React 19, TypeScript 7, Vite 8 plugin middleware, Node.js built-ins, Vitest, Testing Library, File System Access API, GPTBots Conversation API V2, Modellix async REST API.

**Spec:** `docs/superpowers/specs/2026-08-20-gptbots-modellix-media-generation-design.md`

## Global Constraints

- Use the local companion; never send a provider API key to browser code.
- Store macOS settings at `~/Library/Application Support/Lumina AI Video Editor/settings.json` with mode `0600`; tests inject temporary paths.
- GPTBots Agent configuration is user-owned and out of scope.
- Accept at most one fenced `modellix_tool` command per assistant turn.
- Require explicit user confirmation before every Modellix task submission.
- Only explicitly referenced images from the triggering turn may enter a generation proposal.
- Keep the fixed fifteen-adapter registry; verify each endpoint and request mapping against its official Modellix page.
- Do not generate audio, video-to-video, or auto-insert generated media into the timeline.
- Treat local-directory persistence as the completion boundary.
- Tests use fake fetch implementations only and never call production provider endpoints.
- This workspace does not expose writable Git metadata; replace commit steps with passing-test checkpoints.

---

### Task 1: Secure Local Settings and Same-Origin Companion Shell

**Files:**
- Create: `server/settings.ts`
- Create: `server/settings.test.ts`
- Create: `server/http.ts`
- Create: `server/plugin.ts`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `ProviderSettings`, `MaskedSettings`, `SettingsStore`, `maskSettings(settings)`, `redactSecrets(value)`, and `companionPlugin(options?)`.
- Produces same-origin `GET /api/settings` and `PUT /api/settings`.

- [ ] **Step 1: Add Node type support and write failing settings tests**

```ts
it('never exposes complete provider keys', async () => {
  const store = new SettingsStore(tempFile);
  await store.write({ gptbotsApiKey: 'gb-secret-1234', modellixApiKey: 'mx-secret-5678', gptbotsRegion: 'sg', gptbotsUserId: 'editor-user' });
  expect(await store.readMasked()).toMatchObject({
    gptbotsApiKey: { configured: true, lastFour: '1234' },
    modellixApiKey: { configured: true, lastFour: '5678' },
  });
  expect(JSON.stringify(await store.readMasked())).not.toContain('gb-secret');
});
```

Add `@types/node` to dev dependencies and include `"node"` in the TypeScript type list.

- [ ] **Step 2: Run RED**

Run: `pnpm test server/settings.test.ts`

Expected: FAIL because `SettingsStore` does not exist.

- [ ] **Step 3: Implement atomic owner-only settings storage**

Implement `SettingsStore` with an injectable filename, `mkdir({recursive:true})`, a sibling temporary file, `writeFile(..., {mode: 0o600})`, `chmod(0o600)`, and `rename`. The default filename is derived from `os.homedir()` and never evaluated in browser modules. Empty submitted key fields preserve existing secrets; an explicit `clearGptbotsKey`/`clearModellixKey` clears them.

- [ ] **Step 4: Add minimal JSON middleware and Vite plugin**

`companionPlugin()` handles only `/api/*`, caps JSON bodies at 24 MiB, returns `{ error: { code, message } }`, and delegates all non-API paths to Vite. Mount the settings routes and add the plugin before React in `vite.config.ts`.

- [ ] **Step 5: Verify checkpoint**

Run: `pnpm test server/settings.test.ts && pnpm run build`

Expected: settings tests and TypeScript/Vite build PASS.

### Task 2: Strict GPTBots Tool Protocol

**Files:**
- Create: `server/toolProtocol.ts`
- Create: `server/toolProtocol.test.ts`

**Interfaces:**
- Produces: `MediaGenerationProposal`, `ParsedAssistantReply`, `parseAssistantReply(text)`, and `validateProposal(proposal, context)`.
- Consumes adapter lookup from Task 3 through an injected `getAdapter(id)` callback to avoid a module cycle.

- [ ] **Step 1: Write parser RED tests**

```ts
it('extracts one hidden tool block and preserves assistant text', () => {
  const result = parseAssistantReply('I can animate this.\n```modellix_tool\n{"action":"generate_media","adapter_id":"seedance-2.0-i2v","prompt":"move","reference_asset_ids":["a"],"parameters":{}}\n```');
  expect(result.text).toBe('I can animate this.');
  expect(result.proposal?.adapter_id).toBe('seedance-2.0-i2v');
});

it('rejects multiple tool blocks', () => {
  expect(() => parseAssistantReply(`${block}\n${block}`)).toThrow('Only one media action is allowed');
});
```

Also cover invalid JSON, unknown top-level fields, missing prompt, and non-current-turn references.

- [ ] **Step 2: Run RED**

Run: `pnpm test server/toolProtocol.test.ts`

Expected: FAIL because the parser module is missing.

- [ ] **Step 3: Implement strict parsing and validation**

Do not execute JSON embedded in ordinary fences. Require exactly the six schema keys (`action`, `adapter_id`, `prompt`, `reference_asset_ids`, `parameters`; with no extra keys) and `action === 'generate_media'`. Return the plain assistant text separately. Validation returns a typed error instead of throwing for user-caused payload errors.

- [ ] **Step 4: Verify checkpoint**

Run: `pnpm test server/toolProtocol.test.ts`

Expected: protocol tests PASS.

### Task 3: Fixed Modellix Adapter Registry

**Files:**
- Create: `server/modellix/types.ts`
- Create: `server/modellix/adapters.ts`
- Create: `server/modellix/adapters.test.ts`

**Interfaces:**
- Produces: `ModellixAdapter`, `AdapterParameter`, `ValidatedGenerationInput`, `modellixAdapters`, `getAdapter(id)`, `validateAdapterInput(adapter,input)`.
- Every adapter produces `{ endpoint, body, outputKind }` from normalized input.

- [ ] **Step 1: Write registry completeness and representative mapping tests**

```ts
it('contains the fifteen approved adapters', () => {
  expect(modellixAdapters.map((item) => item.id)).toEqual(expect.arrayContaining([
    'seedance-1.5-pro-t2v', 'seedance-2.0-i2v', 'kling-image-o1',
    'kling-v3-t2v', 'kling-v3-i2v', 'hailuo-2.3-t2v',
    'hailuo-2.3-fast-i2v', 'wan2.7-image-pro', 'wan2.7-image-pro-edit',
    'wan3.0-t2v', 'wan3.0-i2v', 'nano-banana-2', 'nano-banana-2-edit',
    'veo-3.1-t2v', 'veo-3.1-i2v',
  ]));
});

it('maps a Kling image-to-video request to provider field names', () => {
  const request = getAdapter('kling-v3-i2v').buildRequest({ prompt: 'orbit camera', references: ['https://file/image.png'], parameters: { duration: 5 } });
  expect(request.body).toMatchObject({ prompt: 'orbit camera', image: 'https://file/image.png', duration: 5 });
});
```

- [ ] **Step 2: Verify every official model page before encoding the mapping**

For each registry row, record the exact `/api/v1/.../async` endpoint, reference field, enum values, required fields, maximum reference count, and output kind from its Modellix documentation page. If a named model is absent from the API documentation, mark that adapter `available: false` with a human-readable reason instead of inventing a path.

- [ ] **Step 3: Run RED**

Run: `pnpm test server/modellix/adapters.test.ts`

Expected: FAIL because the registry is missing.

- [ ] **Step 4: Implement schema-driven fixed adapters**

Use data entries plus small provider-specific `buildRequest` functions. Enforce unknown-parameter rejection, enum/range validation, reference min/max, prompt limits, and capability/output grouping. The browser-facing form schema contains only labels, types, defaults, enums, and ranges—never endpoint internals.

- [ ] **Step 5: Verify checkpoint**

Run: `pnpm test server/modellix/adapters.test.ts server/toolProtocol.test.ts`

Expected: all adapter and cross-protocol tests PASS.

### Task 4: GPTBots Conversation Client and Routes

**Files:**
- Create: `server/gptbots/client.ts`
- Create: `server/gptbots/client.test.ts`
- Create: `server/conversations.ts`
- Modify: `server/plugin.ts`

**Interfaces:**
- Produces: `GptBotsClient.createConversation(input)`, `GptBotsClient.sendMessage(input)`, `GptBotsClient.verifyKey()`, `ConversationStore`, and local conversation/message routes.
- Consumes: `parseAssistantReply` and settings from Tasks 1–2.

- [ ] **Step 1: Write fake-fetch GPTBots tests**

Assert the regional base URL, Bearer header, `POST /v1/conversation`, blocking `POST /v2/conversation/message`, and image blocks containing complete Base64 plus format/name. Assert `401` maps to `gptbots_auth_invalid` and response bodies never include the key.

- [ ] **Step 2: Run RED**

Run: `pnpm test server/gptbots/client.test.ts`

Expected: FAIL because `GptBotsClient` is missing.

- [ ] **Step 3: Implement client and local conversation persistence**

Use injected `fetch` for tests. Associate the GPTBots conversation ID with a generated local project conversation ID. Persist only IDs, message text, timestamps, reference IDs, and parsed proposals; never persist Base64 files. Implement `POST /api/conversations` and `POST /api/conversations/:id/messages`.

- [ ] **Step 4: Verify checkpoint**

Run: `pnpm test server/gptbots/client.test.ts server/toolProtocol.test.ts`

Expected: conversation tests PASS.

### Task 5: Modellix Client, Persistent Job Engine, and Output Streaming

**Files:**
- Create: `server/modellix/client.ts`
- Create: `server/modellix/client.test.ts`
- Create: `server/jobs/store.ts`
- Create: `server/jobs/engine.ts`
- Create: `server/jobs/engine.test.ts`
- Modify: `server/plugin.ts`

**Interfaces:**
- Produces: `ModellixClient.verifyKey()`, `uploadMedia(file)`, `submit(adapter,input)`, `getTask(taskId)`, `GenerationJobStore`, `GenerationJobEngine.confirmProposal(input)`, `refreshJob(id)`, and `getOutput(id)`.
- Produces generation job list/detail/create/output routes.

- [ ] **Step 1: Write fake-fetch client tests**

Assert File API multipart field `file`, adapter endpoint/body, task polling, resource parsing, `X-RateLimit-Reset`, and normalized `400/401/402/404/429/500/503` errors.

- [ ] **Step 2: Write job-state and idempotency RED tests**

```ts
it('does not submit the same confirmed proposal twice', async () => {
  const first = await engine.confirmProposal({ proposalId: 'p1', idempotencyKey: 'p1-confirm', references });
  const second = await engine.confirmProposal({ proposalId: 'p1', idempotencyKey: 'p1-confirm', references });
  expect(second.id).toBe(first.id);
  expect(fakeClient.submitCalls).toBe(1);
});
```

Cover `proposal → submitting → pending → processing → downloading → awaiting_directory_permission → completed`, terminal failure, and reload recovery.

- [ ] **Step 3: Run RED**

Run: `pnpm test server/modellix/client.test.ts server/jobs/engine.test.ts`

Expected: FAIL because the client and engine are missing.

- [ ] **Step 4: Implement provider client and engine**

Use injected clock/fetch. Retry transient calls after 1/2/4 seconds; never retry validation, auth, balance, or not-found errors. Persist after every transition via atomic owner-only JSON storage. Store result URL and expiry warning metadata, not the downloaded binary. `GET /api/generation-jobs/:id/output` proxies only the already-recorded Modellix result URL and validates content type/size.

- [ ] **Step 5: Mount settings tests and job routes**

Add `/api/settings/test/gptbots`, `/api/settings/test/modellix`, `/api/adapters`, `/api/generation-jobs`, `/api/generation-jobs/:id`, `/api/generation-jobs/:id/output`, and an acknowledgement route that transitions `awaiting_directory_permission` to `completed` only after the browser reports a successful local write.

- [ ] **Step 6: Verify checkpoint**

Run: `pnpm test server && pnpm run build`

Expected: all server tests and build PASS.

### Task 6: Typed Browser API and Settings Sheet

**Files:**
- Create: `src/ai/api.ts`
- Create: `src/ai/api.test.ts`
- Create: `src/components/SettingsSheet.tsx`
- Create: `src/components/SettingsSheet.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `companionApi` methods matching Task 1/4/5 routes and a controlled `SettingsSheet`.
- Settings callbacks return masked settings and independent connection-test results.

- [ ] **Step 1: Write API and settings RED tests**

Test that omitted key inputs do not clear saved secrets, complete keys never render after save, connection tests report per-provider status, Escape/cancel restores focus, and reduced motion disables sheet transition movement.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/ai/api.test.ts src/components/SettingsSheet.test.tsx`

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement typed fetch wrapper and Apple-style settings sheet**

Use a restrained modal sheet with a dimmed material backdrop, clear provider sections, masked status, explicit save/test buttons, keyboard focus trap, focus restoration, and inline errors. Do not refactor unrelated panels.

- [ ] **Step 4: Verify checkpoint**

Run: `pnpm test src/ai/api.test.ts src/components/SettingsSheet.test.tsx src/App.test.tsx`

Expected: settings and app tests PASS.

### Task 7: Referenced Conversation and Confirmation UI

**Files:**
- Create: `src/ai/useAssistantConversation.ts`
- Create: `src/ai/useAssistantConversation.test.tsx`
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/components/AIAssistant.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: conversation hook state/actions: `send`, `addReference`, `removeReference`, `confirmProposal`, `retryJob`, `acknowledgeSavedOutput`.
- Consumes current `MediaItem[]`, selected directory handle workflow, adapter schemas, and companion API.

- [ ] **Step 1: Write conversation/reference RED tests**

Test removable image-reference chips, disabled attachment of video/audio, normal assistant replies, hidden tool JSON, proposal confirmation gating, one active submission per proposal, progress restoration, and provider-specific repair actions.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/ai/useAssistantConversation.test.tsx src/components/AIAssistant.test.tsx`

Expected: FAIL because the hook and new UI are missing.

- [ ] **Step 3: Implement conversation hook and focused assistant changes**

Replace the hardcoded sample messages with real hook state. Add an asset-reference picker filtered to online images, removable chips, assistant message rendering, a non-editable proposal summary, billable confirmation button, job progress, result preview, and retry/settings actions. Keep GPTBots as the conversation selector label and compatible enabled Modellix adapters as the generation selector.

- [ ] **Step 4: Verify checkpoint**

Run: `pnpm test src/ai/useAssistantConversation.test.tsx src/components/AIAssistant.test.tsx src/App.test.tsx`

Expected: assistant integration tests PASS.

### Task 8: Persist Generated Output into the Existing Media Directory

**Files:**
- Modify: `src/media/useMediaLibrary.ts`
- Modify: `src/media/useMediaLibrary.test.tsx`
- Modify: `src/ai/useAssistantConversation.ts`
- Modify: `src/components/AIAssistant.test.tsx`

**Interfaces:**
- Produces: `mediaLibrary.saveGeneratedFile({ suggestedName, blob }): Promise<MediaItem>`.
- Completion acknowledgement is sent only after `createWritable().close()` and a successful rescan.

- [ ] **Step 1: Write directory persistence RED tests**

Test collision-safe names (`generated.png`, `generated-2.png`), permission-needed behavior, write failure, successful rescan, and no completion acknowledgement before the writable stream closes.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/media/useMediaLibrary.test.tsx src/components/AIAssistant.test.tsx`

Expected: FAIL because `saveGeneratedFile` is missing.

- [ ] **Step 3: Implement local write and acknowledgement flow**

Use the retained directory handle, `getFileHandle(name,{create:true})`, `createWritable`, `write(blob)`, and `close()`. On permission loss return a typed error that produces **Reauthorize directory** and **Download file** actions. Refresh the flat media grid after success and keep automatic timeline insertion disabled.

- [ ] **Step 4: Verify full acceptance checkpoint**

Run: `pnpm test && pnpm run build`

Expected: every existing and new test passes; the production bundle builds without exposing a provider key.

- [ ] **Step 5: Manual non-billable smoke test**

Start `pnpm run dev`, open settings, save masked credentials, run both connection tests, send a normal GPTBots message with an image reference, and verify no Modellix task is created unless a valid tool block is returned and the user confirms it. Do not perform a billable generation without explicit authorization and usable user-provided keys.
