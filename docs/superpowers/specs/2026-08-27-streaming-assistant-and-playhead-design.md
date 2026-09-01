# Streaming Assistant and Direct-Manipulation Playhead Design

## Goal

Make AI conversations feel immediate and legible while keeping operational detail available on demand, and make timeline seeking track the pointer at a true one-to-one ratio.

Success means:

- The assistant displays only the human-facing answer, never a serialized upstream response envelope.
- Answer text appears incrementally as it arrives.
- Real execution activity is visible during the request and automatically collapses after completion.
- Users can reopen completed execution details.
- Timeline seeking stays under the pointer at every zoom and horizontal scroll position.
- Motion remains responsive, interruptible, and accessible.

## Scope

This change covers the GPTBots message transport, the local companion message endpoint, the client conversation state and rendering, and timeline ruler/playhead seeking.

It does not add fabricated chain-of-thought, expose hidden model reasoning, redesign the whole assistant panel, add chat persistence, or alter clip move/resize behavior.

## Architecture

### Normalized assistant event stream

The browser will not consume GPTBots response objects directly. The local companion service will request GPTBots with `response_mode: "streaming"`, parse the upstream streaming response, and emit a vendor-neutral event stream to the browser.

The application protocol contains these event shapes:

- `status`: a concise, user-facing phase such as preparing context or waiting for the agent.
- `delta`: the next piece of final assistant text.
- `tool`: a real component or tool activity derived from upstream metadata, including a label, status, and optional concise result.
- `done`: successful terminal event.
- `error`: sanitized terminal failure event.

The transport will use newline-delimited JSON over a streamed HTTP response. NDJSON is easier to parse and test than forwarding vendor-specific SSE, while still preserving chunk-by-chunk delivery. Every line is one complete typed event. The response uses `application/x-ndjson`, disables caching, and includes no secret configuration or raw upstream envelope.

### GPTBots adapter

`GptBotsClient` will expose a streaming message method. It will:

1. Send the existing multimodal content using `response_mode: "streaming"`.
2. Read arbitrary byte chunks without assuming event or JSON boundaries align with network chunks.
3. Decode complete upstream records and retain an incomplete tail until more bytes arrive.
4. Map GPTBots `Text` records to `delta` events.
5. Map meaningful `FlowOutput` component metadata to concise `tool` events without dumping the complete object.
6. Treat `End` as completion.
7. Convert malformed streams, upstream failures, and premature termination into sanitized errors.

Unknown upstream event types are ignored unless they represent an error. This makes the adapter tolerant of additive GPTBots changes.

### Companion endpoint

`POST /api/messages` keeps its request contract but changes its success response from JSON to a streaming response. Input validation errors remain ordinary JSON errors before streaming starts. Once streaming has started, failures are emitted as an `error` event because the HTTP status can no longer be changed reliably.

Cancellation propagates from the browser reader through the local stream to the upstream request where supported.

## Conversation State and Rendering

Each assistant turn is a single stateful message with:

- accumulated final `content`;
- ordered process entries;
- lifecycle state: `streaming`, `complete`, or `error`;
- process expansion state.

Submission immediately appends the user message and an empty streaming assistant turn. Incoming events update that same turn rather than appending one message per chunk.

The final answer area renders only accumulated `delta` content through the existing Markdown renderer. Status and tool events render in a separate execution disclosure above the answer. Raw event JSON is never rendered.

While running, the execution disclosure is open and displays live status. On `done`, it automatically collapses after the final state is committed. The header retains a compact completion summary such as “已完成 · 3 个步骤,” and users can expand it again. On error, the process stays open so the failure is visible, while any already-received answer text remains available.

The UI will autoscroll only when the user is already near the bottom. It will not pull the viewport away from a user who has scrolled upward to inspect earlier content.

## Motion and Interaction

Conversation updates use restrained, critically damped-feeling motion:

- New process rows materialize with a short opacity and small vertical transition.
- The disclosure body opens and closes using measured height plus opacity so the transition is spatially continuous.
- The completion collapse begins only after the final content and completion label are visible.
- Buttons respond immediately on pointer down and remain usable during transitions.
- `prefers-reduced-motion: reduce` replaces spatial movement with a short cross-fade or immediate state change.

Streaming text itself will not animate each character independently; chunks append directly to avoid visual lag and layout thrash.

## Timeline Playhead Seeking

The current ruler combines a transparent native range input with a playhead positioned in a different coordinate system. The ruler input spans the full content width, while the playhead and time mapping include a 52-pixel track-label gutter. Native range thumb geometry adds another browser-controlled inset. These mismatched coordinate systems cause the pointer and playhead to diverge.

The replacement uses one explicit pointer gesture and one coordinate conversion:

```text
contentX = clientX - scroller.left + scroller.scrollLeft
time = clamp((contentX - trackLabelWidth) / pixelsPerSecond, 0, duration)
```

The ruler captures the pointer on `pointerdown`, seeks immediately, and continues updating on `pointermove` until `pointerup` or `pointercancel`, even outside the ruler bounds. The fixed gutter value will be shared by playhead placement, ruler marks, and pointer conversion rather than repeated as unrelated literals.

The playhead will not use easing while directly manipulated. Direct manipulation must remain one-to-one; decorative animation would recreate the perceived lag. Keyboard accessibility remains available through the playhead slider semantics and explicit arrow-key seeking.

## Error Handling

- Pre-stream request errors use the existing sanitized `CompanionApiError` path.
- Mid-stream errors produce a typed `error` event with a safe message.
- Invalid NDJSON or an ended stream without `done` is treated as a request failure.
- Duplicate terminal events are ignored.
- Empty successful answers display a concise fallback instead of a blank bubble.
- Process results are length-limited and never include credentials or complete upstream payloads.

## Testing Strategy

Implementation follows test-driven development.

Server tests will cover:

- requesting GPTBots streaming mode;
- parsing records split across arbitrary byte chunks;
- extracting only text deltas from the upstream response;
- mapping flow/component activity without exposing raw JSON;
- upstream HTTP errors and premature stream termination;
- companion endpoint streaming headers and cancellation/error behavior.

Client tests will cover:

- incremental updates to one assistant message;
- absence of serialized response envelopes in rendered output;
- live expanded process activity;
- automatic collapse after completion and manual reopening;
- error state behavior and retained partial text;
- reduced-motion-safe class/state behavior where practical.

Timeline tests will set explicit scroller geometry and scroll offsets, then verify that pointer positions map to the same expected time on pointer down and every pointer move. Tests will also cover zoom, horizontal scrolling, bounds clamping, pointer capture, cancellation, and keyboard seeking.

Finally, the full unit suite and production build must pass. The running app will be manually checked for actual streaming, disclosure motion, reduced-motion behavior, and one-to-one playhead tracking.

## Compatibility and Migration

The change is internal to the local application. Existing settings, conversation creation, references, media actions, and editor commands keep their current request shapes. The client and companion endpoint must be deployed together because `/api/messages` changes its success media type and response semantics.
