# Local Conversation History Design

## Goal

Give the AI assistant durable, locally stored conversations that users can create, resume, and switch between, with clear subjects and recent-activity timestamps. Increase conversation text size without making execution detail visually dominant.

Success means:

- Reloading restores the last selected conversation and all saved messages.
- Users can create a new blank conversation and switch among existing conversations.
- Conversation entries show a subject, latest message summary, and recent communication time.
- Conversation lists are ordered by communication time, not by selection time.
- The first user message generates a useful local subject without an extra model call.
- Streaming replies remain incremental and are persisted after completion or failure.
- API keys, image Base64 data, and local media bytes never enter conversation storage.
- Conversation body text is comfortably larger while execution metadata remains subordinate.

## Scope

This change adds a local conversation repository, HTTP endpoints for conversation metadata and messages, client-side conversation selection and creation, and a conversation picker in the assistant header.

It does not synchronize conversations across devices, fetch cloud conversation history, delete conversations, persist binary attachments, generate subjects with AI, or add a rename interface. The stored remote GPTBots conversation ID remains an implementation detail.

## Persistence Architecture

The companion service owns `.lumina-data/conversations.json`. Keeping persistence behind the local HTTP boundary avoids browser storage quotas, provides atomic writes, and makes the data portable with the project.

The store uses a versioned document:

```ts
interface ConversationDocumentV1 {
  version: 1;
  lastSelectedId: string | null;
  conversations: LocalConversation[];
}

interface LocalConversation {
  id: string;
  remoteConversationId: string | null;
  subject: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredConversationMessage[];
}
```

`id` is a locally generated opaque identifier. `remoteConversationId` is created lazily on the first send and reused for later messages in that conversation. Timestamps are epoch milliseconds.

Writes use the existing safe pattern: create the parent directory, write a mode-0600 temporary file, rename it over the target, and preserve restrictive permissions. Store operations serialize writes so two quick updates cannot overwrite one another.

Missing files produce an empty version-1 document. Invalid JSON, unsupported versions, or invalid records do not crash the app; the store returns an empty document and keeps the bad file untouched for diagnosis. Public errors never expose local paths or stored content.

## Stored Message Model

Messages preserve the current discriminated roles:

- User and status messages store `id`, `role`, `content`, and `createdAt`.
- Assistant messages store final/partial content, lifecycle state, execution entries, expansion state, and `createdAt`.

Only display-safe content is stored. Reference asset IDs may be stored as an optional list if needed for visible context, but image URLs, Base64 payloads, file handles, and media bytes are excluded.

An in-progress assistant message is not written for every stream delta. The user message and an initial streaming assistant shell are kept in React state; after `done`, `error`, cancellation, or thrown failure, the complete turn is saved once. If the app exits mid-stream, the previously committed history remains valid and the incomplete turn is not fabricated on reload.

## Subject and Summary Rules

The subject is generated from the first user message:

1. Collapse whitespace and line breaks to single spaces.
2. Trim both ends.
3. Take the first 20 Unicode code points.
4. Append `…` only when text was truncated.

Before the first user message, the subject is `新对话`.

The list summary uses the latest user or assistant text message, applies the same whitespace normalization, and truncates to 36 Unicode code points. Execution entries and status-only messages are not used as summaries.

## Recent Activity Semantics

`updatedAt` means the most recent communication time. It changes when a user sends a message and again when the assistant turn reaches a terminal state. Merely selecting, opening, or renaming a conversation does not change it.

The picker sorts by `updatedAt` descending, then `createdAt` descending, then stable local ID. Relative display labels use the user's local timezone:

- under one minute: `刚刚`;
- under one hour: `N 分钟前`;
- same calendar day: `HH:mm`;
- previous calendar day: `昨天 HH:mm`;
- otherwise: `M月D日` within the current year, or `YYYY年M月D日` across years.

The server returns absolute timestamps; formatting remains a client responsibility.

## HTTP API

The companion exposes:

- `GET /api/conversations` — list metadata ordered by recent activity and return `lastSelectedId`.
- `POST /api/conversations` — create a blank local conversation and make it selected; no GPTBots call.
- `GET /api/conversations/:id` — return one full local conversation.
- `PUT /api/conversations/:id` — replace validated local metadata/messages after a turn transition.
- `POST /api/conversations/:id/select` — update `lastSelectedId` without changing `updatedAt`.
- Existing GPTBots creation moves behind message sending: if the selected conversation lacks `remoteConversationId`, the service creates one, persists it, then streams the message.

Unknown IDs return a stable `conversation_not_found` response. Invalid message shapes, timestamps, roles, process entries, and oversized documents return stable validation errors.

The existing `POST /api/messages` request will switch from a caller-provided remote conversation ID to a local conversation ID. The server resolves and owns the remote mapping so it never leaks into UI state.

## Client Data Flow

At startup:

1. Fetch conversation metadata.
2. If `lastSelectedId` exists, load that conversation.
3. Otherwise create and load one blank conversation.
4. Render the loaded messages instead of hard-coded demo messages.

Creating a conversation calls the local create endpoint, adds the metadata to the list, selects it, and resets the visible message history. Switching calls the select endpoint and loads the chosen history. The assistant composer is disabled while a selection request is unresolved.

The conversation ID and message state move from `App` and private assistant defaults into an explicit conversation controller. The assistant receives the active conversation and emits state transitions upward so persistence is coordinated in one place.

If a conversation is switched while a reply is streaming, the current browser reader is cancelled before loading the next conversation. The partial assistant turn is marked as an error locally and persisted once, so the user can see that generation was interrupted rather than silently losing text.

## Conversation Picker UI

The assistant header contains:

- A subject button showing the active conversation subject and a disclosure indicator.
- A `新对话` icon button with an explicit accessible label.
- The existing connection-state subtitle.

The subject button opens an anchored translucent popover. Each row displays subject, one-line summary, and recent-time label. The active row has a clear selected state. Rows use buttons and support keyboard navigation, Escape dismissal, outside-pointer dismissal, and focus restoration to the trigger.

The popover animates from the subject button using opacity, a small vertical translation, and slight materialization over roughly 180–220 ms. Motion is interruptible through state reversal. Under `prefers-reduced-motion: reduce`, it uses a near-instant opacity change without translation.

## Typography

Conversation body text increases from approximately 10 px to 12 px, with a line height around 1.65. User and assistant bubbles share the same readable body size. Markdown headings, lists, tables, and inline code scale relative to this base.

Execution disclosure labels remain approximately 9–10 px with adequate contrast. Conversation-picker subjects use 11–12 px semibold text; summaries and timestamps use 9–10 px. Composer control sizes remain unchanged unless required to prevent visual imbalance.

## Error Handling

- Initial history load failure shows a retryable assistant-panel error without destroying editor functionality.
- A failed create leaves the current conversation selected.
- A failed switch restores the previous selection and messages.
- A failed save keeps the current in-memory conversation and shows a non-Markdown status notice.
- Missing or corrupt persistence data falls back to a new blank conversation.
- Remote GPTBots conversation creation failures leave the local conversation intact and retryable.
- Rapid create/switch actions use request identity checks so stale responses cannot replace the newest selection.

## Testing Strategy

Implementation follows test-driven development.

Store tests cover missing/corrupt files, schema validation, atomic writes, serialized updates, topic generation, summary generation, ordering, remote ID mapping, and selection without timestamp mutation.

HTTP tests cover all conversation routes, safe errors, local-to-remote message resolution, first-send remote creation, and repeat-send reuse.

Client controller tests cover initial restore, blank fallback, create, switch, stale response protection, save-after-terminal-stream, cancellation persistence, and failure recovery.

Component tests cover picker semantics, sorting, recent-time labels, keyboard/outside dismissal, selected state, new conversation action, larger readable typography, and reduced-motion behavior.

The full unit suite and production build must pass. Browser QA will verify refresh restoration, two-conversation switching, newest ordering, process-panel coexistence, typography, and pointer/keyboard interactions.

## Migration

The current hard-coded demo conversation is not migrated into persistent history. On first launch after this feature, users receive one blank `新对话`. Existing provider settings and media-directory configuration remain unchanged.
