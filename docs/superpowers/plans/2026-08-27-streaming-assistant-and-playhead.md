# Streaming Assistant and Direct-Manipulation Playhead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream only the assistant's core answer, expose truthful execution activity in an auto-collapsing panel, and make timeline seeking follow the pointer one-to-one.

**Architecture:** The local companion converts GPTBots streaming records into a typed NDJSON protocol. The React client consumes that protocol into one stateful assistant turn, while the timeline uses a single shared pointer-to-time conversion instead of a transparent native range overlay.

**Tech Stack:** TypeScript 7, React 19, Vite 8, Web Streams API, Vitest, Testing Library, CSS

**Spec:** `docs/superpowers/specs/2026-08-27-streaming-assistant-and-playhead-design.md`

## Global Constraints

- Never render a serialized GPTBots response envelope.
- Show only real status, component, and tool activity; never fabricate or expose hidden chain-of-thought.
- Preserve the current `/api/messages` request body and multimodal image shape.
- Use `application/x-ndjson` for successful streamed message responses.
- Keep direct playhead manipulation one-to-one; do not animate behind the pointer.
- Respect `prefers-reduced-motion: reduce`.
- Add no new runtime dependency.
- This checkout has no usable Git metadata; replace commit steps with named local checkpoints unless Git becomes available before execution.

---

## File Structure

- Create `server/assistantStream.ts`: vendor-neutral event types, GPTBots record parsing, and NDJSON encoding.
- Create `server/assistantStream.test.ts`: arbitrary chunk-boundary and event-mapping tests.
- Modify `server/gptbots.ts`: request streaming mode and return the upstream body.
- Modify `server/gptbots.test.ts`: verify request mode, upstream failure sanitization, and body handling.
- Modify `server/http.ts`: return the normalized NDJSON stream from `/api/messages`.
- Modify `server/http.test.ts`: verify streaming media type, events, and input failures.
- Create `src/conversation/stream.ts`: browser NDJSON decoder and protocol validation.
- Create `src/conversation/stream.test.ts`: split-chunk, terminal, malformed, and cancellation tests.
- Modify `src/conversation/types.ts`: stateful assistant turn and process entry types.
- Modify `src/api/companion.ts`: expose a streaming message API instead of JSON decoding.
- Modify `src/components/AIAssistant.tsx`: incrementally update one assistant turn and render the execution disclosure.
- Modify `src/components/AIAssistant.test.tsx`: cover incremental rendering, collapse, reopen, and failures.
- Modify `src/styles.css`: process disclosure motion, streaming affordances, and reduced-motion behavior.
- Modify `src/App.tsx`: forward the streaming result from the companion API rather than stringifying it.
- Modify `src/components/Timeline.tsx`: shared gutter constant, pointer capture, coordinate conversion, and keyboard seeking.
- Modify `src/components/Timeline.test.tsx`: one-to-one seeking under scrolling, zoom, capture, bounds, cancellation, and keyboard tests.

---

### Task 1: Normalize GPTBots Streaming Records

**Files:**
- Create: `server/assistantStream.ts`
- Create: `server/assistantStream.test.ts`

**Interfaces:**
- Consumes: `ReadableStream<Uint8Array>` from the GPTBots response body.
- Produces: `AssistantStreamEvent`, `parseGptBotsStream(source)`, and `encodeAssistantEvents(events)` for Task 2.

- [ ] **Step 1: Write failing parser tests**

Cover JSON records split in the middle of UTF-8 text and across arbitrary network chunks:

```ts
const source = byteStream([
  '{"code":3,"message":"Text","data":"你',
  '好"}\n{"code":10,"message":"FlowOutput","data":[{"content":"找到 2 个片段","from_component_name":"检索时间线"}]}\n',
  '{"code":0,"message":"End","data":null}\n',
]);

await expect(collect(parseGptBotsStream(source))).resolves.toEqual([
  { type: 'delta', text: '你好' },
  { type: 'tool', label: '检索时间线', status: 'complete', result: '找到 2 个片段' },
  { type: 'done' },
]);
```

Also assert that `MessageInfo` and unknown additive events do not become visible output, malformed records yield one sanitized `error`, process results are length-limited, and an EOF without `End` yields `{ type: 'error', message: 'AI 响应意外中断' }`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test server/assistantStream.test.ts`

Expected: FAIL because `server/assistantStream.ts` and its exports do not exist.

- [ ] **Step 3: Implement the typed parser**

Use these exact public types:

```ts
export type AssistantStreamEvent =
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; label: string; status: 'running' | 'complete' | 'error'; result?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export function parseGptBotsStream(
  source: ReadableStream<Uint8Array>,
): ReadableStream<AssistantStreamEvent>;

export function encodeAssistantEvents(
  source: ReadableStream<AssistantStreamEvent>,
): ReadableStream<Uint8Array>;
```

Use `TextDecoder.decode(value, { stream: true })`, retain an incomplete line buffer, accept both plain newline-delimited JSON and SSE `data:` prefixes, and close only after a terminal event. Convert `code === 3` to `delta`, meaningful `code === 10` entries to `tool`, and `code === 0` to `done`. Sanitize labels/results to plain strings and cap visible results at 500 characters.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm test server/assistantStream.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 5: Record local checkpoint**

Checkpoint name: `assistant-stream-parser-green`

Record the passing command and changed files in the task notes; do not attempt a Git commit unless repository metadata is restored.

---

### Task 2: Stream the Companion Message Endpoint

**Files:**
- Modify: `server/gptbots.ts`
- Modify: `server/gptbots.test.ts`
- Modify: `server/http.ts`
- Modify: `server/http.test.ts`

**Interfaces:**
- Consumes: `parseGptBotsStream` and `encodeAssistantEvents` from Task 1.
- Produces: `GptBotsClient.streamMessage(input): Promise<ReadableStream<Uint8Array>>` and a streamed `POST /api/messages` response.

- [ ] **Step 1: Write failing GPTBots client tests**

Assert the exact outbound request contains streaming mode and preserves multimodal content:

```ts
expect(JSON.parse(String(init.body))).toEqual({
  conversation_id: 'c1',
  response_mode: 'streaming',
  messages: [{ role: 'user', content: [
    { type: 'text', text: '调整节奏' },
    { type: 'image', image: [{ url: 'https://example.test/a.png', format: 'png', name: 'a.png' }] },
  ] }],
});
```

Return a response body from the fake fetcher and assert `streamMessage` returns that readable body. Assert missing API keys, non-2xx responses, and responses without a body throw sanitized errors without upstream response text.

- [ ] **Step 2: Run the GPTBots tests and verify RED**

Run: `pnpm test server/gptbots.test.ts`

Expected: FAIL because `streamMessage` is missing and the current request uses `blocking`.

- [ ] **Step 3: Implement `GptBotsClient.streamMessage`**

Add:

```ts
async streamMessage(input: {
  conversationId: string;
  text: string;
  images?: GptBotsImage[];
}): Promise<ReadableStream<Uint8Array>>;
```

Share content construction with the existing method, set `response_mode: 'streaming'`, return `response.body`, and keep the current sanitized status-only error message. Remove the now-unused blocking `sendMessage` only after all callers migrate.

- [ ] **Step 4: Run the GPTBots tests and verify GREEN**

Run: `pnpm test server/gptbots.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing companion endpoint tests**

Inject a fake fetcher that returns split GPTBots events. Assert:

```ts
expect(response.headers.get('content-type')).toContain('application/x-ndjson');
expect(response.headers.get('cache-control')).toBe('no-store');
expect(await response.text()).toBe([
  JSON.stringify({ type: 'status', label: '正在连接 AI' }),
  JSON.stringify({ type: 'delta', text: '核心回答' }),
  JSON.stringify({ type: 'done' }),
  '',
].join('\n'));
```

Keep the existing assertions that invalid input and pre-stream failures return sanitized JSON errors. Add cancellation coverage proving cancellation reaches the upstream reader.

- [ ] **Step 6: Run the endpoint tests and verify RED**

Run: `pnpm test server/http.test.ts`

Expected: FAIL because `/api/messages` still serializes a blocking response.

- [ ] **Step 7: Implement the streamed endpoint**

For valid messages, create the upstream stream, prepend `{ type: 'status', label: '正在连接 AI' }`, pipe parsed events through `encodeAssistantEvents`, and return:

```ts
return new Response(body, {
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/x-ndjson; charset=utf-8',
    'x-content-type-options': 'nosniff',
  },
});
```

Preserve all existing pre-stream validation responses. Ensure stream cancellation calls the upstream reader's `cancel` method.

- [ ] **Step 8: Run server regression tests**

Run: `pnpm test server/assistantStream.test.ts server/gptbots.test.ts server/http.test.ts`

Expected: PASS.

- [ ] **Step 9: Record local checkpoint**

Checkpoint name: `companion-message-stream-green`

---

### Task 3: Decode the Application Stream in the Browser

**Files:**
- Create: `src/conversation/stream.ts`
- Create: `src/conversation/stream.test.ts`
- Modify: `src/api/companion.ts`

**Interfaces:**
- Consumes: NDJSON `Response` from Task 2.
- Produces: `streamAssistantResponse(response): AsyncGenerator<AssistantStreamEvent>` and `companionApi.sendMessage(body): Promise<Response>`.

- [ ] **Step 1: Write failing browser decoder tests**

Test records split across chunks, multiple records in one chunk, multibyte characters, malformed JSON, a server `error` event, missing `done`, non-2xx JSON errors, and reader cancellation.

```ts
const events = await collect(streamAssistantResponse(new Response(byteStream([
  '{"type":"delta","text":"你',
  '好"}\n{"type":"done"}\n',
]))));
expect(events).toEqual([{ type: 'delta', text: '你好' }, { type: 'done' }]);
```

- [ ] **Step 2: Run decoder tests and verify RED**

Run: `pnpm test src/conversation/stream.test.ts`

Expected: FAIL because the decoder module does not exist.

- [ ] **Step 3: Implement browser stream validation**

Export the same `AssistantStreamEvent` union from `src/conversation/stream.ts`. Validate every decoded object by event type before yielding it. Throw `CompanionApiError('invalid_stream', 'AI 返回了无法识别的数据')` for malformed or invalid records, and `CompanionApiError('interrupted_stream', 'AI 响应意外中断')` when EOF occurs before a terminal event.

Change only `sendMessage` so it obtains and returns the raw `Response`. Keep ordinary `api<T>` behavior for all other endpoints, and decode the existing JSON error envelope before throwing on non-2xx message responses.

- [ ] **Step 4: Run decoder tests and verify GREEN**

Run: `pnpm test src/conversation/stream.test.ts`

Expected: PASS.

- [ ] **Step 5: Record local checkpoint**

Checkpoint name: `browser-stream-decoder-green`

---

### Task 4: Render One Streaming Assistant Turn and Execution Disclosure

**Files:**
- Modify: `src/conversation/types.ts`
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/components/AIAssistant.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `AsyncIterable<AssistantStreamEvent>` from Task 3 through `onSubmit`.
- Produces: incrementally rendered assistant content and an accessible execution disclosure.

- [ ] **Step 1: Write failing assistant interaction tests**

Change the `onSubmit` test double to return an async iterable and assert progressive behavior with a controlled generator:

```ts
yieldEvent({ type: 'status', label: '正在分析时间线' });
expect(await screen.findByText('正在分析时间线')).toBeVisible();

yieldEvent({ type: 'delta', text: '已调整' });
expect(await screen.findByText('已调整')).toBeVisible();

yieldEvent({ type: 'tool', label: '修改片段', status: 'complete', result: '3 项' });
yieldEvent({ type: 'delta', text: '剪辑节奏。' });
yieldEvent({ type: 'done' });
expect(await screen.findByText('已调整剪辑节奏。')).toBeVisible();
expect(screen.getByRole('button', { name: /已完成 · 2 个步骤/ })).toHaveAttribute('aria-expanded', 'false');
```

Assert that a raw-looking payload such as `{"code":3,"message":"Text"}` never appears, the completed panel can be reopened, errors keep it expanded, partial content survives an error, and a second submit is rejected while streaming.

- [ ] **Step 2: Run assistant tests and verify RED**

Run: `pnpm test src/components/AIAssistant.test.tsx`

Expected: FAIL because `onSubmit` currently resolves to one string and no process disclosure exists.

- [ ] **Step 3: Add stateful conversation types**

Replace the flat assistant shape with:

```ts
export interface ProcessEntry {
  id: string;
  label: string;
  status: 'running' | 'complete' | 'error';
  result?: string;
}

export type ConversationMessage =
  | { id: string; role: 'user' | 'status'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      state: 'streaming' | 'complete' | 'error';
      process: ProcessEntry[];
      processExpanded: boolean;
    };
```

- [ ] **Step 4: Implement incremental turn updates**

Change `AssistantSubmission` handling so `onSubmit` returns `AsyncIterable<AssistantStreamEvent>`. Append an empty assistant turn immediately, then update it by ID for every event:

- `delta`: append `text` to `content`.
- `status`: replace the current running status or append a new truthful phase.
- `tool`: append/update the named process entry.
- `done`: set `state: 'complete'` and `processExpanded: false` in the same state update.
- `error`: set `state: 'error'`, keep `processExpanded: true`, and add an error process entry.

If completion contains no text, use `已完成，但没有返回可显示的内容。` as the answer. Preserve the mounted guard and pending-request lock.

- [ ] **Step 5: Implement the accessible disclosure and motion**

Render one `<button>` with `aria-expanded` and `aria-controls` for each assistant process. The controlled body uses `data-state="open|closed"`, clips overflow while transitioning, and remains in the DOM so completion animation and manual reopening share the same path.

Add CSS with a 240ms non-bouncy transition on grid-template-rows and opacity, short 160ms entry transitions for process rows, compositor-friendly transforms, and:

```css
@media (prefers-reduced-motion: reduce) {
  .assistant-process-body,
  .assistant-process-entry { transition-duration: 1ms !important; transform: none !important; }
}
```

Do not animate streamed characters or add a delay before applying deltas.

- [ ] **Step 6: Wire App submission to the decoder**

In `src/App.tsx`, return `streamAssistantResponse(await companionApi.sendMessage(body))` from the assistant submit callback. Delete any `JSON.stringify(reply)` or equivalent whole-response rendering path. Preserve conversation creation and reference serialization.

- [ ] **Step 7: Run assistant and app tests**

Run: `pnpm test src/conversation/stream.test.ts src/components/AIAssistant.test.tsx src/App.test.tsx`

Expected: PASS.

- [ ] **Step 8: Record local checkpoint**

Checkpoint name: `streaming-assistant-ui-green`

---

### Task 5: Make Timeline Seeking Follow the Pointer One-to-One

**Files:**
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`

**Interfaces:**
- Consumes: pointer `clientX`, scroller bounds, `scrollLeft`, and `pixelsPerSecond`.
- Produces: `pointerXToTimelineTime(clientX, geometry)` and direct pointer/keyboard seeking.

- [ ] **Step 1: Write failing geometry and gesture tests**

Export and test this pure conversion contract:

```ts
expect(pointerXToTimelineTime(352, {
  scrollerLeft: 100,
  scrollLeft: 200,
  trackLabelWidth: 52,
  pixelsPerSecond: 40,
  duration: 28,
})).toBe(10);
```

Render the timeline with explicit scroller bounds. Fire pointer down at a known x, then pointer moves at +40 and +80 pixels and assert `onSeek` advances by exactly 1 and 2 seconds at 40 px/s. Repeat after setting horizontal scroll and after zooming to 80 px/s. Assert values clamp to 0 and duration.

Spy on `setPointerCapture` and `releasePointerCapture`; verify capture occurs on down, seeking continues on move, release occurs on up, and cancel releases without another seek. Add ArrowLeft/ArrowRight assertions using a 1/24-second step, with Shift using a one-second step.

- [ ] **Step 2: Run timeline tests and verify RED**

Run: `pnpm test src/components/Timeline.test.tsx`

Expected: FAIL because the transparent native range owns dragging and the pure conversion/capture behavior does not exist.

- [ ] **Step 3: Implement one coordinate system**

Define and reuse:

```ts
export const TRACK_LABEL_WIDTH = 52;

export function pointerXToTimelineTime(clientX: number, geometry: {
  scrollerLeft: number;
  scrollLeft: number;
  trackLabelWidth: number;
  pixelsPerSecond: number;
  duration: number;
}): number {
  const contentX = clientX - geometry.scrollerLeft + geometry.scrollLeft;
  return Math.max(0, Math.min(
    geometry.duration,
    (contentX - geometry.trackLabelWidth) / geometry.pixelsPerSecond,
  ));
}
```

Use `TRACK_LABEL_WIDTH` for playhead, snap guide, ruler ticks, zoom anchoring, and pointer conversion. Remove the transparent ruler `<input type="range">` and its CSS rule.

- [ ] **Step 4: Implement captured pointer seeking and keyboard access**

Track the active pointer ID in a ref. On ruler `pointerdown`, capture and seek immediately. On `pointermove`, update only for the active pointer. On `pointerup` and `pointercancel`, release capture and clear the ref. Apply time directly without CSS position easing.

Make the playhead slider focusable and handle ArrowLeft/ArrowRight. Use `1 / 24` seconds normally and `1` second with Shift, clamped to bounds. Keep `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` synchronized.

- [ ] **Step 5: Run timeline tests and verify GREEN**

Run: `pnpm test src/components/Timeline.test.tsx src/timeline/geometry.test.ts`

Expected: PASS.

- [ ] **Step 6: Record local checkpoint**

Checkpoint name: `direct-playhead-seeking-green`

---

### Task 6: Full Verification and Interactive QA

**Files:**
- Modify only files required to correct failures revealed by the checks below; every correction starts with a focused failing regression test.

**Interfaces:**
- Consumes: all deliverables from Tasks 1–5.
- Produces: a tested production build and verified running interaction.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: all tests pass with no unhandled rejections or React act warnings.

- [ ] **Step 2: Run the production build**

Run: `pnpm build`

Expected: TypeScript and Vite complete successfully.

- [ ] **Step 3: Start or reuse the development server**

Run: `pnpm dev --host 127.0.0.1`

Expected: Vite reports a local URL and `/` responds successfully.

- [ ] **Step 4: Verify the AI interaction in a Chromium browser**

Send a real prompt and confirm the final bubble contains readable Markdown only; text grows before completion; real execution rows appear while active; completion collapses the disclosure; reopening reveals the same entries; no response envelope, API key, or raw upstream object appears.

- [ ] **Step 5: Verify playhead direct manipulation**

At minimum, test 40 px/s and 80 px/s, both at scroll start and after horizontal scrolling. Press and drag across the ruler, leave its bounds while holding, reverse direction, and release. Confirm the playhead remains under the pointer without lag or accumulating offset.

- [ ] **Step 6: Verify accessibility preferences**

Emulate `prefers-reduced-motion: reduce`. Confirm process content still appears and collapses without spatial motion, disclosure keyboard toggling works, and the playhead supports keyboard seeking with visible focus.

- [ ] **Step 7: Final local checkpoint**

Checkpoint name: `streaming-assistant-playhead-verified`

Record the full test result, build result, browser URL, and any upstream limitation observed during live GPTBots testing.
