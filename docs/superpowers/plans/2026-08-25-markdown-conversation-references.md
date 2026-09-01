# Markdown Conversation and Media References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant Markdown safely and let users maintain multiple explicit media references across conversational turns.

**Architecture:** A unified message model separates user text, assistant Markdown, and status messages. App owns reference IDs; the assistant receives display metadata and emits immutable reference snapshots with each submission. Transport encoding is isolated from UI state.

**Tech Stack:** React 19, TypeScript, `react-markdown`, `remark-gfm`, Vitest, Testing Library, GPTBots companion API.

**Spec:** `docs/superpowers/specs/2026-08-25-markdown-asset-actions-timeline-interactions-design.md`

## Global Constraints

- Assistant content supports GFM but never executes raw HTML.
- User messages remain plain text.
- Duplicate references are rejected by ID while preserving insertion order.
- References remain after sending until the user removes them.
- Unsupported media transport produces a visible error before sending.

---

### Task 1: Safe Markdown Message Component

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/components/MarkdownMessage.tsx`
- Create: `src/components/MarkdownMessage.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `<MarkdownMessage content: string />`.

- [ ] **Step 1: Install renderer dependencies**

Run: `pnpm add react-markdown remark-gfm`

- [ ] **Step 2: Write failing renderer tests**

```tsx
test('renders GFM without executing raw HTML', () => {
  render(<MarkdownMessage content={'## Title\n- [x] ready\n<script>alert(1)</script>'} />);
  expect(screen.getByRole('heading', { name: 'Title' })).toBeVisible();
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText(/<script>/)).toBeVisible();
});
```

Add tests for a GFM table, fenced code, safe external link attributes, and rejection of `javascript:` links.

- [ ] **Step 3: Run RED**

Run: `pnpm test src/components/MarkdownMessage.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 4: Implement minimal renderer**

Use `ReactMarkdown` with `remarkGfm`, no raw HTML plugin, and custom link/code renderers. Permit only `http:`, `https:`, and `mailto:` URLs. Wrap rendering in an error boundary whose fallback is a plain-text `<p>`.

- [ ] **Step 5: Run GREEN**

Run: `pnpm test src/components/MarkdownMessage.test.tsx`

Expected: all pass.

### Task 2: Unified Conversation Messages

**Files:**
- Create: `src/conversation/types.ts`
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/components/AIAssistant.test.tsx`

**Interfaces:**
- Produces: `ConversationMessage = { id: string; role: 'user' | 'assistant' | 'status'; content: string }`.
- Assistant messages render through `MarkdownMessage`; user/status messages use text nodes.

- [ ] **Step 1: Write failing message rendering tests**

Submit a prompt whose mocked response contains a heading, list, and table. Assert the user input stays literal while the assistant response creates semantic Markdown elements. Assert failure text becomes a status message rather than assistant Markdown.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/components/AIAssistant.test.tsx`

Expected: FAIL because replies are plain strings.

- [ ] **Step 3: Implement unified messages**

Replace separate `messages` and `replies` arrays with one ordered array. Generate IDs locally with a monotonic counter or `crypto.randomUUID`; do not use message text as a key.

- [ ] **Step 4: Run GREEN**

Run: `pnpm test src/components/AIAssistant.test.tsx`

Expected: all pass.

### Task 3: Multiple Reference State and Chips

**Files:**
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/components/AIAssistant.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Changes `AssistantSubmission` to include `referenceAssetIds: string[]`.
- Adds props `references: Array<{ id: string; name: string; kind: MediaKind }>` and `onRemoveReference(id)`.

- [ ] **Step 1: Write failing reference tests**

Assert two context-menu additions create two chips, duplicate addition remains one chip, remove deletes only one ID, submission contains an immutable ordered ID array, and references remain visible after submission.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/components/AIAssistant.test.tsx src/App.test.tsx`

Expected: FAIL because only one `referenceLabel` exists.

- [ ] **Step 3: Implement App-owned reference IDs and chips**

Store `conversationReferenceIds` in App. Resolve them against current assets; automatically remove IDs for assets no longer present. Render each chip with kind, truncated name, and an accessible remove button.

- [ ] **Step 4: Run GREEN**

Run: `pnpm test src/components/AIAssistant.test.tsx src/App.test.tsx`

Expected: all pass.

### Task 4: Reference Transport Encoding

**Files:**
- Create: `src/conversation/encodeReferences.ts`
- Create: `src/conversation/encodeReferences.test.ts`
- Modify: `src/api/companion.ts`
- Modify: `src/App.tsx`
- Modify: `server/gptbots.ts`
- Modify: `server/gptbots.test.ts`

**Interfaces:**
- Produces: `encodeConversationReferences(items): Promise<GptBotsContentPart[]>`.
- Message API accepts typed `contentParts` rather than an image-only shortcut.

- [ ] **Step 1: Write failing transport tests**

Test image encoding, audio encoding when supported, stable ordering, and a typed `unsupported_reference_kind` result for video when no valid GPTBots/Seedance transport is configured. Confirm no unrelated asset is encoded.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/conversation/encodeReferences.test.ts server/gptbots.test.ts`

Expected: FAIL for missing encoder and typed content parts.

- [ ] **Step 3: Implement encoder and GPTBots payload**

Fetch media bytes only for referenced IDs, encode images/audio in the official GPTBots V2 content shapes, and fail before creating/sending a conversation if any reference cannot be represented. Keep video reference handoff explicit; do not relabel video as an image.

- [ ] **Step 4: Run GREEN**

Run: `pnpm test src/conversation/encodeReferences.test.ts server/gptbots.test.ts src/App.test.tsx`

Expected: all pass.

### Task 5: Full Acceptance

**Files:**
- Modify only files required by failures discovered in this task.

- [ ] **Step 1: Run all automated checks**

Run: `pnpm test && pnpm run build`

Expected: all test files pass and production build exits zero.

- [ ] **Step 2: Browser acceptance**

Verify headings, lists, tables, code, and links in assistant replies; add two assets through the context menu; remove one; send a message; confirm the submitted reference list matches the visible chips and remaining references persist.

- [ ] **Step 3: Combined regression**

Repeat timeline zoom and snapping acceptance after the conversation dependencies are installed, ensuring no layout regression in the assistant or timeline panels.
