# Interactive Media Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current browser prototype into an adjustable media workspace with local video/image/audio discovery, synchronized demo playback, and editable video/audio tracks.

**Architecture:** Keep editor history, layout preferences, local-directory access, and playback state as separate units. React composes these units: CSS custom properties drive layout, a shared playback controller connects Preview and Timeline, and editor commands own track mutations.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest, Testing Library, browser File System Access API, IndexedDB, HTMLMediaElement.

**Spec:** `docs/superpowers/specs/2026-08-18-interactive-media-workspace-design.md`

## Global Constraints

- Browser-only application; no Electron wrapper or local backend.
- Local files are never uploaded by this phase.
- Asset panel width: 180–420 px; assistant width: 280–560 px; preview width: at least 360 px.
- Timeline height: 200 px to 55% of the available workspace height.
- Empty tracks delete immediately; tracks containing clips require confirmation.
- Existing frozen asset-version behavior, model selection, and undo/redo must remain intact.
- Git metadata cannot be created in this workspace; replace commit steps with test-backed checkpoints.

---

### Task 1: Workspace Layout State and Accessible Splitters

**Files:**
- Create: `src/layout/workspaceLayout.ts`
- Create: `src/layout/workspaceLayout.test.ts`
- Create: `src/components/PanelSplitter.tsx`
- Create: `src/components/PanelSplitter.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `WorkspaceLayoutState`, `loadWorkspaceLayout()`, `saveWorkspaceLayout(state)`, `clampWorkspaceLayout(state, viewport)`.
- Produces: `PanelSplitter` accepting orientation, value, min, max, invert, and `onChange`/`onCommit` callbacks.

- [ ] **Step 1: Write failing layout constraint tests**

```ts
expect(clampWorkspaceLayout(
  { assetWidth: 90, assistantWidth: 900, timelineHeight: 900 },
  { width: 1440, height: 900 },
)).toEqual({ assetWidth: 180, assistantWidth: 560, timelineHeight: 468 });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test src/layout/workspaceLayout.test.ts`
Expected: FAIL because `workspaceLayout` does not exist.

- [ ] **Step 3: Implement layout constraints and persistence**

```ts
export interface WorkspaceLayoutState {
  assetWidth: number;
  assistantWidth: number;
  timelineHeight: number;
}

export function clampWorkspaceLayout(state: WorkspaceLayoutState, viewport: { width: number; height: number }) {
  const maxTimeline = Math.floor((viewport.height - 48) * 0.55);
  const assetWidth = Math.min(420, Math.max(180, state.assetWidth));
  const assistantWidth = Math.min(560, Math.max(280, state.assistantWidth));
  const available = viewport.width - 360;
  return {
    assetWidth: Math.min(assetWidth, available - assistantWidth),
    assistantWidth: Math.min(assistantWidth, available - assetWidth),
    timelineHeight: Math.min(maxTimeline, Math.max(200, state.timelineHeight)),
  };
}
```

- [ ] **Step 4: Write and verify failing splitter pointer/keyboard tests**

Test that pointer movement reports 1:1 values, Arrow keys adjust by 8 px, Shift+Arrow adjusts by 32 px, and pointer release calls `onCommit` once.

Run: `pnpm test src/components/PanelSplitter.test.tsx`
Expected: FAIL because `PanelSplitter` does not exist.

- [ ] **Step 5: Implement `PanelSplitter` and replace the current AI-only resizer**

Use Pointer Events with capture, `role="separator"`, `aria-orientation`, `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`. Add left-library, right-assistant, and horizontal-timeline splitters. Apply values through `--asset-width`, `--ai-width`, and `--timeline-height`.

- [ ] **Step 6: Run regression tests and build**

Run: `pnpm test && pnpm build`
Expected: all tests pass and Vite produces `dist/`.

### Task 2: First-Class Video and Audio Tracks

**Files:**
- Modify: `src/domain/editor.ts`
- Modify: `src/domain/editor.test.ts`
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `TrackKind`, `TimelineTrack`, `EditorState.tracks`.
- Extends `EditorCommand` with `add-track` and `delete-track`.

- [ ] **Step 1: Write failing track-domain tests**

```ts
const withVideo = applyCommand(createDemoState(), { type: 'add-track', kind: 'video' });
expect(Object.values(withVideo.tracks).some((track) => track.name === 'V3')).toBe(true);

const emptyId = Object.values(withVideo.tracks).find((track) => track.name === 'V3')!.id;
const removed = applyCommand(withVideo, { type: 'delete-track', trackId: emptyId });
expect(removed.tracks[emptyId]).toBeUndefined();
expect(undo(removed).tracks[emptyId]).toBeDefined();
```

Also assert deletion returns `{ requiresConfirmation: true, clipCount }` before executing a populated-track deletion.

- [ ] **Step 2: Run domain tests and verify RED**

Run: `pnpm test src/domain/editor.test.ts`
Expected: FAIL because tracks and commands are missing.

- [ ] **Step 3: Implement track state and commands**

```ts
export type TrackKind = 'video' | 'audio';
export interface TimelineTrack {
  id: string;
  name: string;
  kind: TrackKind;
  order: number;
  muted: boolean;
  locked: boolean;
}
```

Seed `video-2`, `video-1`, and `audio-1`; migrate demo clips to those IDs. Generate monotonically increasing display names and include tracks in snapshots.

- [ ] **Step 4: Write failing Timeline component tests**

Test “添加视频轨道”, “添加音频轨道”, immediate empty-track deletion, populated-track confirmation copy, cancel, and confirm.

- [ ] **Step 5: Implement track controls and confirmation dialog**

Render tracks from state, grouped video then audio. Use a native accessible dialog surface controlled by React. Confirm calls the deletion command with `confirmed: true`; cancel performs no command.

- [ ] **Step 6: Run regression tests and build**

Run: `pnpm test && pnpm build`
Expected: all tests pass without changing frozen clip versions.

### Task 3: Media Classification and Local Directory Catalog

**Files:**
- Create: `src/media/mediaTypes.ts`
- Create: `src/media/mediaTypes.test.ts`
- Create: `src/media/directoryStore.ts`
- Create: `src/media/useMediaLibrary.ts`
- Create: `src/components/DirectoryPicker.tsx`
- Create: `src/components/DirectoryPicker.test.tsx`
- Modify: `src/components/AssetLibrary.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `MediaKind`, `MediaItem`, `classifyMedia(file)`, `createMediaId(relativePath, file)`.
- Produces: `useMediaLibrary()` with `{ items, status, ignoredCount, chooseDirectory, restoreDirectory }`.

- [ ] **Step 1: Write failing media classification tests**

```ts
expect(classifyMedia(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).toBe('video');
expect(classifyMedia(new File(['x'], 'cover.png', { type: 'image/png' }))).toBe('image');
expect(classifyMedia(new File(['x'], 'score.flac', { type: 'audio/flac' }))).toBe('audio');
expect(classifyMedia(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBeNull();
```

- [ ] **Step 2: Run classification tests and verify RED**

Run: `pnpm test src/media/mediaTypes.test.ts`
Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement classification and stable IDs**

Prefer MIME type, fall back to the extension allowlist from the spec, and derive the ID from relative path, size, and `lastModified`.

- [ ] **Step 4: Write failing directory-state component tests**

Test unsupported, unselected, permission-needed, scanning, ready, empty, denied, and partial-error UI states through injected directory-service functions.

- [ ] **Step 5: Implement IndexedDB directory-handle storage and scanning hook**

Store a single handle under `media-directory`. Recursively iterate entries, isolate per-file failures, build object URLs, and revoke old URLs on directory changes/unmount.

- [ ] **Step 6: Integrate directory controls and three media kinds into AssetLibrary**

Keep demo asset stacks visible until a directory is ready. Once ready, render file-backed cards with explicit Video/Image/Audio badges and a summary of accepted and ignored files.

- [ ] **Step 7: Run regression tests and build**

Run: `pnpm test && pnpm build`
Expected: all tests pass; browsers without File System Access API retain demo assets.

### Task 4: Unified Preview Playback

**Files:**
- Create: `src/playback/playback.ts`
- Create: `src/playback/playback.test.ts`
- Create: `src/playback/usePlaybackController.ts`
- Modify: `src/components/Preview.tsx`
- Create: `src/components/Preview.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Add: `public/demo/demo-video.mp4`

**Interfaces:**
- Produces: `PlaybackStatus`, `PlaybackState`, `formatTime(seconds)`, `seekFrame(time, direction, fps)`.
- Produces: controller with `mediaRef`, `state`, `play`, `pause`, `toggle`, `seek`, and `stepFrame`.

- [ ] **Step 1: Write failing playback utility tests**

```ts
expect(formatTime(74.25)).toBe('00:01:14:06');
expect(seekFrame(1, 1, 24)).toBeCloseTo(1 + 1 / 24);
```

- [ ] **Step 2: Run utility tests and verify RED**

Run: `pnpm test src/playback/playback.test.ts`
Expected: FAIL because playback utilities do not exist.

- [ ] **Step 3: Implement playback utilities and controller**

Bind `loadedmetadata`, `timeupdate`, `play`, `pause`, `ended`, and `error`. While playing, sample `mediaRef.current.currentTime` with `requestAnimationFrame`; cancel on pause, end, unmount, or hidden document.

- [ ] **Step 4: Write failing Preview mode tests**

Test video renders a video element and enabled play button; image renders an image and disabled play button; audio renders an audio element plus waveform placeholder; errors render recoverable text.

- [ ] **Step 5: Implement media-type Preview renderers and controls**

Use a bundled, redistributable demo MP4. Keep the current generated scene as poster/fallback. All controls operate through the shared controller rather than local button state.

- [ ] **Step 6: Run regression tests and build**

Run: `pnpm test && pnpm build`
Expected: all tests pass and the demo file is copied into `dist/demo/`.

### Task 5: Timeline Playback Synchronization

**Files:**
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `PlaybackState`, `seek(seconds)` from Task 4.
- Produces: Timeline props `currentTime`, `duration`, and `onSeek`.

- [ ] **Step 1: Write failing synchronization tests**

Render Timeline at `currentTime=5`, `duration=20` and assert the playhead exposes 25% through `aria-valuenow`/style. Click the 50% ruler position and assert `onSeek(10)`.

- [ ] **Step 2: Run Timeline tests and verify RED**

Run: `pnpm test src/components/Timeline.test.tsx`
Expected: FAIL because playback props are absent.

- [ ] **Step 3: Implement controlled timeline playhead and seeking**

Compute `progress = duration > 0 ? currentTime / duration : 0`; position the playhead from progress. Convert ruler pointer coordinates to seconds and call `onSeek`.

- [ ] **Step 4: Connect App playback controller to Preview and Timeline**

Pass the same state and commands to both components. Verify play/pause updates the visible timecode and playhead without an independent timer.

- [ ] **Step 5: Run all automated verification**

Run: `pnpm test && pnpm build`
Expected: all tests pass; type checking and production build succeed.

### Task 6: Browser Integration and Accessibility Verification

**Files:**
- Modify: `README.md`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes all prior task interfaces.
- Produces the final documented browser workflow.

- [ ] **Step 1: Add an App-level regression test**

Assert the complete app renders directory action, two vertical separators, one horizontal separator, video/audio add controls, player control, and the existing two AI model selectors.

- [ ] **Step 2: Run the test and fix only integration gaps**

Run: `pnpm test src/App.test.tsx`
Expected: PASS after wiring all earlier components.

- [ ] **Step 3: Document browser requirements and privacy behavior**

Document Chromium File System Access support, first-use authorization, permission restoration, the demo fallback, accepted media formats, and `pnpm dev` startup.

- [ ] **Step 4: Verify accessibility presentation modes**

Ensure splitters and dialogs retain visible focus. Extend reduced-motion, reduced-transparency, and high-contrast CSS to new controls without removing functional playback feedback.

- [ ] **Step 5: Run final verification**

Run: `pnpm test && pnpm build`
Expected: zero failing tests, successful TypeScript check, successful Vite production build.

- [ ] **Step 6: Perform manual Chromium acceptance**

Start with `pnpm dev --host 127.0.0.1`. Authorize a fixture folder containing one MP4, one PNG, one MP3, and one TXT. Confirm three media items, one ignored file, all preview modes, persistent layout, synchronized playback, and track add/delete behavior.
