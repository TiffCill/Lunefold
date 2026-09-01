# Local Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist local AI conversations, restore the last selected conversation, support creation and switching with subjects and recent times, and improve conversation typography.

**Architecture:** A versioned atomic JSON repository under `.lumina-data` owns local conversation data and remote GPTBots ID mappings. The companion API exposes local conversation CRUD/selection, while a React controller coordinates loading, switching, streaming, cancellation, and terminal-state persistence.

**Tech Stack:** TypeScript 7, React 19, Vite 8, Web Streams API, Node filesystem APIs, Vitest, Testing Library, CSS

**Spec:** `docs/superpowers/specs/2026-08-27-local-conversation-history-design.md`

## Global Constraints

- No cross-device or GPTBots cloud-history synchronization.
- Never persist API keys, Base64 images, URLs containing local assets, file handles, or media bytes.
- Generate the subject locally from the first user message: normalized whitespace, first 20 Unicode code points, ellipsis only when truncated.
- Do not change `updatedAt` when merely selecting a conversation.
- Persist streaming turns only at terminal success, failure, or cancellation.
- Use mode-0600 temporary files and atomic rename for conversation writes.
- Increase conversation body text to 12 px with approximately 1.65 line height.
- Respect reduced motion and existing assistant streaming behavior.
- Add no runtime dependency.
- Git metadata is unavailable in this checkout; use named local checkpoints instead of commits.

---

### Task 1: Versioned Local Conversation Repository

**Files:**
- Create: `server/conversations/store.ts`
- Create: `server/conversations/store.test.ts`

**Interfaces:**
- Produces `ConversationStore`, `LocalConversation`, `StoredConversationMessage`, `ConversationSummary`, `deriveConversationSubject`, and `deriveConversationPreview`.

- [ ] **Step 1: Write failing pure-function tests**

Assert literal subject and preview results:

```ts
expect(deriveConversationSubject('  让副歌\n  跟随强拍切换  ')).toBe('让副歌 跟随强拍切换');
expect(deriveConversationSubject('一二三四五六七八九十一二三四五六七八九十二三')).toBe('一二三四五六七八九十一二三四五六七八九十…');
expect(deriveConversationPreview(messages)).toBe('最后一条可显示的回答');
```

Use `Array.from` semantics so surrogate pairs count as one Unicode code point.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test server/conversations/store.test.ts`

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement types and pure derivation functions**

Define the version-1 document and message discriminated union from the spec. Export:

```ts
export function deriveConversationSubject(text: string): string;
export function deriveConversationPreview(messages: StoredConversationMessage[]): string;
```

Return `新对话` for empty normalized subject text and an empty preview when no user/assistant content exists.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm test server/conversations/store.test.ts`

Expected: pure-function tests PASS.

- [ ] **Step 5: Write failing repository tests**

Cover missing file, create, get, list ordering, selection, subject update on first user message, terminal message persistence, remote ID assignment, serialized concurrent writes, mode-0600 file permissions, invalid record rejection, and corrupt-file fallback. Assert selection leaves the exact prior `updatedAt` unchanged.

- [ ] **Step 6: Run repository tests and verify RED**

Run: `pnpm test server/conversations/store.test.ts`

Expected: FAIL because `ConversationStore` methods are missing.

- [ ] **Step 7: Implement `ConversationStore`**

Use this public API:

```ts
class ConversationStore {
  constructor(filename: string, options?: { now?: () => number; idFactory?: () => string });
  list(): Promise<{ lastSelectedId: string | null; conversations: ConversationSummary[] }>;
  create(): Promise<LocalConversation>;
  get(id: string): Promise<LocalConversation | null>;
  select(id: string): Promise<void>;
  replace(id: string, input: ConversationReplacement): Promise<LocalConversation>;
  setRemoteConversationId(id: string, remoteConversationId: string): Promise<LocalConversation>;
}
```

Queue every read-modify-write operation on a private promise chain. Validate every public replacement before writing. Use a temporary sibling file, `chmod(0o600)`, and `rename`. Return defensive clones so callers cannot mutate stored state.

- [ ] **Step 8: Run repository tests and verify GREEN**

Run: `pnpm test server/conversations/store.test.ts`

Expected: PASS.

- [ ] **Step 9: Record checkpoint**

Checkpoint: `local-conversation-store-green`

---

### Task 2: Conversation HTTP API and Remote-ID Resolution

**Files:**
- Modify: `server/http.ts`
- Modify: `server/http.test.ts`
- Modify: `server/plugin.ts`
- Modify: `server/gptbots.ts`
- Modify: `server/gptbots.test.ts`

**Interfaces:**
- Consumes `ConversationStore` from Task 1.
- Produces list/create/get/replace/select routes and local-ID-based message streaming.

- [ ] **Step 1: Write failing route tests**

Create a real store in a temporary directory and verify:

```ts
GET  /api/conversations
POST /api/conversations
GET  /api/conversations/:id
PUT  /api/conversations/:id
POST /api/conversations/:id/select
```

Assert sorted summaries, persisted last selection, full history retrieval, stable `conversation_not_found`, and stable validation errors. Confirm no response contains `remoteConversationId` except the internal full server object used directly in tests.

- [ ] **Step 2: Run HTTP tests and verify RED**

Run: `pnpm test server/http.test.ts`

Expected: FAIL with 404 for the new routes.

- [ ] **Step 3: Add store dependency and routes**

Extend `CompanionDependencies` with `conversations?: ConversationStore`. In `plugin.ts`, construct it at `.lumina-data/conversations.json`. Route requests before the generic not-found branch. Public response types omit `remoteConversationId`.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `pnpm test server/http.test.ts`

Expected: conversation route tests PASS.

- [ ] **Step 5: Write failing first-send and repeat-send tests**

For a blank local conversation, assert `/api/messages` calls GPTBots conversation creation once, stores the returned remote ID, then sends the message with it. A second message for the same local ID must reuse the mapping without another creation request. Assert unknown local IDs fail before any GPTBots request.

- [ ] **Step 6: Run message boundary tests and verify RED**

Run: `pnpm test server/http.test.ts server/gptbots.test.ts`

Expected: FAIL because `/api/messages` still treats the incoming ID as a remote ID.

- [ ] **Step 7: Resolve local IDs inside the message endpoint**

Change the request body field to `conversationId` meaning local ID. Resolve it through the store. When the remote ID is null, call `createConversation()`, persist the returned ID, then call `streamMessage`. Do not return the remote ID to the client. Preserve the existing NDJSON stream protocol.

- [ ] **Step 8: Run server regression tests**

Run: `pnpm test server/conversations/store.test.ts server/http.test.ts server/gptbots.test.ts server/assistantStream.test.ts`

Expected: PASS.

- [ ] **Step 9: Record checkpoint**

Checkpoint: `conversation-http-api-green`

---

### Task 3: Client Conversation API and Controller

**Files:**
- Modify: `src/api/companion.ts`
- Modify: `src/api/companion.test.ts`
- Create: `src/conversation/controller.ts`
- Create: `src/conversation/controller.test.ts`
- Modify: `src/conversation/types.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes Task 2 HTTP routes and existing `streamAssistantResponse`.
- Produces `ConversationControllerState` and actions for initialize, create, select, submit, and cancel.

- [ ] **Step 1: Write failing API tests**

Assert exact request methods and paths for `listConversations`, `createLocalConversation`, `getConversation`, `replaceConversation`, and `selectConversation`. Use complete response fixtures with IDs, subjects, summaries, timestamps, and messages.

- [ ] **Step 2: Run API tests and verify RED**

Run: `pnpm test src/api/companion.test.ts`

Expected: FAIL because the client methods do not exist.

- [ ] **Step 3: Implement typed API methods**

Add public client types that exclude remote GPTBots IDs. Keep the existing streamed `sendMessage` behavior unchanged except that its conversation ID is documented as local.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `pnpm test src/api/companion.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing controller tests**

Use a fake typed API boundary, not mocked React components. Cover:

- initialize restores `lastSelectedId`;
- empty list creates and selects a blank conversation;
- create leaves the prior conversation intact on failure;
- select loads history and rejects stale slower responses;
- submit appends the user message immediately;
- terminal stream persists once with final content/process state;
- switching during streaming cancels and persists an interrupted error state;
- save failure preserves in-memory messages and exposes a literal status error.

- [ ] **Step 6: Run controller tests and verify RED**

Run: `pnpm test src/conversation/controller.test.ts`

Expected: FAIL because the controller module does not exist.

- [ ] **Step 7: Implement the controller**

Export a framework-neutral controller with subscription semantics:

```ts
export interface ConversationController {
  getState(): ConversationControllerState;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  createConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  submit(input: AssistantSubmission): Promise<void>;
  cancelActiveStream(reason?: string): Promise<void>;
}
```

Use monotonically increasing request tokens for selection races and `AbortController`/iterator return for active stream cancellation. Persist the complete active conversation only at terminal boundaries.

- [ ] **Step 8: Run controller tests and verify GREEN**

Run: `pnpm test src/conversation/controller.test.ts`

Expected: PASS.

- [ ] **Step 9: Wire the controller into `App`**

Instantiate one controller per app, subscribe through `useSyncExternalStore`, initialize in an effect, and pass active conversation state/actions to the assistant. Remove the old single `conversationId` state and lazy remote creation from `App`.

- [ ] **Step 10: Run app tests**

Run: `pnpm test src/conversation/controller.test.ts src/App.test.tsx`

Expected: PASS after updating fixtures to include conversation bootstrap requests.

- [ ] **Step 11: Record checkpoint**

Checkpoint: `conversation-controller-green`

---

### Task 4: Conversation Picker and Stateful Assistant

**Files:**
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/components/AIAssistant.test.tsx`
- Create: `src/conversation/time.ts`
- Create: `src/conversation/time.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes active conversation, sorted summaries, loading state, create/select callbacks, and submit/cancel actions from Task 3.
- Produces accessible picker behavior and readable conversation typography.

- [ ] **Step 1: Write failing recent-time formatter tests**

Use fixed `now` values and assert `刚刚`, minute counts, same-day `HH:mm`, `昨天 HH:mm`, current-year month/day, and cross-year date labels.

- [ ] **Step 2: Run formatter tests and verify RED**

Run: `pnpm test src/conversation/time.test.ts`

Expected: FAIL because the formatter does not exist.

- [ ] **Step 3: Implement `formatConversationTime(timestamp, now)`**

Use local calendar dates and `Intl.DateTimeFormat('zh-CN')`. Future timestamps within clock skew render as `刚刚`.

- [ ] **Step 4: Run formatter tests and verify GREEN**

Run: `pnpm test src/conversation/time.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing assistant picker tests**

Assert:

- active subject button opens a dialog/menu anchored in the header;
- sorted rows show subject, summary, and formatted time;
- active row exposes selected state;
- clicking a row calls select once and closes the picker;
- `新对话` calls create once;
- Escape and outside pointer close and restore trigger focus;
- composer disables during load/switch;
- supplied active messages render instead of demo messages;
- completed execution disclosure remains functional after switching.

- [ ] **Step 6: Run component tests and verify RED**

Run: `pnpm test src/components/AIAssistant.test.tsx`

Expected: FAIL because the picker and controlled conversation props do not exist.

- [ ] **Step 7: Convert assistant messages to controlled state**

Remove hard-coded initial messages and private conversation ownership. Receive `messages`, `conversationSubject`, `conversations`, `busy`, `onCreateConversation`, `onSelectConversation`, and `onSubmit` props. Keep prompt/model/reference state local. Preserve current Markdown, process disclosure, and pending-submit safeguards.

- [ ] **Step 8: Implement the picker and motion**

Use button rows, `aria-current="true"` for the selected conversation, focus restoration, Escape/outside dismissal, and a translucent anchored surface. Animate opacity and at most 4 px translation over 180–220 ms; make transitions reversible and disable translation under reduced motion.

- [ ] **Step 9: Increase readable typography**

Set `.message` body text to `12px` and line height to `1.65`. Keep process text at `9–10px`, and ensure Markdown descendants inherit or scale relative to the message base.

- [ ] **Step 10: Run component tests and verify GREEN**

Run: `pnpm test src/components/AIAssistant.test.tsx src/conversation/time.test.ts`

Expected: PASS.

- [ ] **Step 11: Record checkpoint**

Checkpoint: `conversation-picker-green`

---

### Task 5: Full Verification and Browser QA

**Files:**
- Modify only files required by newly reproduced failures; every correction begins with a focused failing regression test.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified local persistence and interaction behavior.

- [ ] **Step 1: Run full tests**

Run: `pnpm test`

Expected: all test files pass with no unhandled rejections or React act warnings.

- [ ] **Step 2: Run production build**

Run: `pnpm build`

Expected: TypeScript and Vite finish successfully.

- [ ] **Step 3: Restart the development server with forced re-optimization**

Run: `pnpm dev --host 127.0.0.1 --force`

Expected: Vite serves `http://127.0.0.1:5173/` with the new assistant bundle.

- [ ] **Step 4: Verify two-conversation persistence**

Create conversation A, send or locally persist a distinct message, create conversation B, and switch between them. Reload the page and confirm the last selected conversation and messages return.

- [ ] **Step 5: Verify metadata behavior**

Confirm subjects derive from first messages, the list sorts newest communication first, selecting an older conversation does not reorder it, and timestamps use the expected Chinese relative labels.

- [ ] **Step 6: Verify visual and accessibility behavior**

Confirm 12 px readable body text, subordinate execution text, keyboard-operable picker, Escape/outside dismissal, focus restoration, and reduced-motion behavior. Check browser console errors.

- [ ] **Step 7: Record final checkpoint**

Checkpoint: `local-conversation-history-verified`
