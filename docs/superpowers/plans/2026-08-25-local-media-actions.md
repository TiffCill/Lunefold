# Local Media Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select a local media directory through the companion, invoke an accessible asset context menu, insert assets at the playhead, and reveal real source files in Finder.

**Architecture:** A server-side media catalogue owns absolute paths and exposes only opaque IDs and controlled content endpoints. The browser renders catalogue metadata and dispatches semantic actions. Timeline insertion uses a pure nearest-gap function and existing domain commands.

**Tech Stack:** Node.js companion, macOS `osascript` and `open`, React 19, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-markdown-asset-actions-timeline-interactions-design.md`

## Global Constraints

- Browser code never receives or submits an absolute filesystem path.
- Reveal accepts only a catalogue media ID under the authorized root.
- Supported media extensions remain those in `src/media/mediaTypes.ts`.
- Demo assets cannot be revealed in Finder.
- Context menu supports pointer and keyboard dismissal.

---

### Task 1: Secure Companion Media Catalogue

**Files:**
- Create: `server/media/catalogue.ts`
- Create: `server/media/catalogue.test.ts`
- Modify: `server/settings.ts`
- Modify: `server/settings.test.ts`

**Interfaces:**
- Produces: `MediaCatalogue.selectDirectory(): Promise<void>`
- Produces: `MediaCatalogue.list(): Promise<ServerMediaItem[]>`
- Produces: `MediaCatalogue.resolve(mediaId): Promise<ResolvedMedia>`
- Produces: `ProviderSettings.mediaDirectory: string`

- [ ] **Step 1: Write failing catalogue security tests**

Test recursive supported-file discovery, stable opaque IDs, exclusion of unsupported files, missing files, and rejection when a symlink resolves outside the configured root. Assert that public metadata has no absolute path property.

- [ ] **Step 2: Run RED**

Run: `pnpm test server/media/catalogue.test.ts server/settings.test.ts`

Expected: FAIL because the catalogue and `mediaDirectory` setting do not exist.

- [ ] **Step 3: Implement catalogue and setting**

Use `realpath`, `relative`, and `stat`; accept a selected root only after resolving it. Derive IDs from a SHA-256 digest of relative path, size, and modification time. Keep the in-memory ID-to-path map private. Return `name`, `relativePath`, `kind`, `size`, `modifiedAt`, and media ID.

- [ ] **Step 4: Run GREEN**

Run: `pnpm test server/media/catalogue.test.ts server/settings.test.ts`

Expected: all tests pass.

### Task 2: Directory, Content, and Finder APIs

**Files:**
- Create: `server/media/native.ts`
- Create: `server/media/native.test.ts`
- Modify: `server/http.ts`
- Modify: `server/http.test.ts`
- Modify: `server/plugin.ts`

**Interfaces:**
- Produces endpoints: `POST /api/media-library/select-directory`, `GET /api/media-library`, `GET /api/media/:id/content`, `POST /api/media/:id/reveal`.

- [ ] **Step 1: Write failing API tests**

Inject fake directory selection, catalogue, file streaming, and reveal dependencies. Assert cancellation preserves the previous directory, unknown IDs return `404 media_not_found`, and reveal receives a resolved catalogue item rather than a request path.

- [ ] **Step 2: Run RED**

Run: `pnpm test server/http.test.ts server/media/native.test.ts`

Expected: FAIL for missing routes and native adapter.

- [ ] **Step 3: Implement native adapters without shell interpolation**

Use `execFile` with argument arrays. Directory selection uses `osascript` and returns the selected POSIX path. Reveal uses `open` with `['-R', absolutePath]`. Map user cancellation to a typed cancellation result.

- [ ] **Step 4: Implement routes and MIME/range responses**

Content responses set the classified MIME type and support byte ranges so video/audio elements can seek. Route errors use stable public error codes without absolute paths.

- [ ] **Step 5: Run GREEN and build**

Run: `pnpm test server/http.test.ts server/media/native.test.ts && pnpm run build`

Expected: all pass.

### Task 3: Companion-Backed Media Hook

**Files:**
- Modify: `src/api/companion.ts`
- Create: `src/media/useCompanionMediaLibrary.ts`
- Create: `src/media/useCompanionMediaLibrary.test.tsx`
- Modify: `src/media/mediaTypes.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `useCompanionMediaLibrary()` with `items`, `status`, `chooseDirectory`, `refresh`, and `reveal(mediaId)`.
- Changes `MediaItem` to browser-safe metadata with `contentUrl` and no required `File`.

- [ ] **Step 1: Write failing hook tests**

Test initial list restoration, selecting then refreshing, cancellation, reveal error propagation, and stable content URLs.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/media/useCompanionMediaLibrary.test.tsx`

Expected: FAIL because the hook is missing.

- [ ] **Step 3: Implement API and hook**

Map server metadata to `contentUrl = /api/media/${encodeURIComponent(id)}/content`. Replace `useMediaLibrary` in App only after tests cover equivalent ready, empty, scanning, and error states. Keep the old hook until migration tests pass, then remove its App usage without deleting unrelated tests.

- [ ] **Step 4: Run GREEN**

Run: `pnpm test src/media/useCompanionMediaLibrary.test.tsx src/App.test.tsx`

Expected: all pass.

### Task 4: Nearest-Gap Timeline Insertion

**Files:**
- Modify: `src/timeline/geometry.ts`
- Modify: `src/timeline/geometry.test.ts`
- Modify: `src/domain/editor.ts`
- Modify: `src/domain/editor.test.ts`

**Interfaces:**
- Produces: `findNearestGap(clips, requestedStart, duration): number`
- Produces editor command: `{ type: 'insert-asset-at-playhead'; assetId: string; playheadTime: number }`.

- [ ] **Step 1: Write failing gap and command tests**

Assert insertion at an empty playhead, movement to the first following gap, compatible-track preference, automatic track creation, image five-second duration, and source-duration usage for video/audio.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/timeline/geometry.test.ts src/domain/editor.test.ts`

Expected: FAIL for missing function and command.

- [ ] **Step 3: Implement pure gap search and editor command**

Sort same-track ranges by start, advance the candidate to an overlapping clip's end, and stop at the first gap large enough. The editor command chooses the selected compatible track, then the first compatible track, then creates one through existing track numbering logic.

- [ ] **Step 4: Run GREEN**

Run: `pnpm test src/timeline/geometry.test.ts src/domain/editor.test.ts`

Expected: all pass.

### Task 5: Accessible Asset Context Menu

**Files:**
- Create: `src/components/AssetContextMenu.tsx`
- Create: `src/components/AssetContextMenu.test.tsx`
- Modify: `src/components/AssetLibrary.tsx`
- Modify: `src/components/AssetLibrary.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes callbacks: `onAddToConversation(mediaId)`, `onAddToTimeline(mediaId)`, `onReveal(mediaId)`.

- [ ] **Step 1: Write failing menu tests**

Assert right-click selects the asset, positions a `menu`, executes all three callbacks, disables reveal for demo assets, supports ArrowDown/Enter/Escape, and closes on outside pointer down.

- [ ] **Step 2: Run RED**

Run: `pnpm test src/components/AssetContextMenu.test.tsx src/components/AssetLibrary.test.tsx`

Expected: FAIL because no context menu exists.

- [ ] **Step 3: Implement menu and App wiring**

Render through a portal, clamp its measured rectangle inside an eight-pixel viewport inset, focus the first enabled item, and restore focus to the originating tile on close. Dispatch insertion at `playback.state.currentTime`.

- [ ] **Step 4: Add Apple-style restrained styling**

Use one heavy translucent surface, clear hover/focus feedback, a 0.98-to-1 materialization from the pointer origin, and opacity-only reduced motion.

- [ ] **Step 5: Verify**

Run: `pnpm test src/components/AssetContextMenu.test.tsx src/components/AssetLibrary.test.tsx src/App.test.tsx && pnpm run build`

Then verify in the browser that a real file reveals in Finder and demo reveal is disabled.

