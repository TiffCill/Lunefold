# Unified Timeline and Program Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prototype's competing time, position, and media states with one editable timeline model that drives the ruler, playhead, preview, project duration, drag/drop, resizing, and visual layering.

**Architecture:** A canonical `TimelineProject` stores assets, tracks, and clips in seconds. Pure geometry, validation, command, and program-resolution modules own every calculation; React components render their outputs and keep only transient pointer state. The preview uses the project playhead as its only clock and changes media source only when the resolved active clip changes.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest, Testing Library, Pointer Events, HTML Drag and Drop API, HTMLMediaElement, File System Access API.

**Spec:** `docs/superpowers/specs/2026-08-19-unified-timeline-preview-design.md`

## Global Constraints

- Browser-only application; local media remains on the device.
- Project frame rate is 24 fps; minimum clip duration is one frame.
- Project duration is the maximum `start + duration` across visual and audio clips.
- Visual tracks accept video/image; audio tracks accept audio; video import does not auto-split audio.
- Clips on the same track may touch but may not overlap.
- Snap threshold is exactly 8 screen pixels.
- Images may extend indefinitely; video holds its final decodable frame; extended audio is silent.
- Higher visual tracks cover lower tracks; empty higher tracks reveal lower tracks; all-empty visual time is black.
- Timeline project data is the only source of truth for preview, ruler, playhead, positions, widths, and duration.
- Apple Design applies only to changed timeline gestures and preview feedback.
- Git metadata is read-only in this workspace; replace commit steps with test-backed checkpoints and do not attempt `git commit`.

---

### Task 1: Introduce the Canonical Timeline Project Model

**Files:**
- Create: `src/timeline/types.ts`
- Create: `src/timeline/fixtures.ts`
- Create: `src/timeline/types.test.ts`
- Modify: `src/domain/editor.ts`
- Modify: `src/domain/editor.test.ts`

**Interfaces:**
- Produces: `MediaAsset`, `TimelineClip`, `TimelineTrack`, `TimelineProject`, `TrackKind`, `MediaKind`, `FPS`, `MIN_CLIP_DURATION`.
- Produces: `createDemoProject(): TimelineProject` with a 28-second aligned demo.
- Removes from canonical state: `AssetStack`, `AssetVersion`, `versionId`, CSS-derived positions.

- [ ] **Step 1: Write failing canonical-model tests**

```ts
const project = createDemoProject();
expect(project.fps).toBe(24);
expect(project.clips['clip-garden']).toEqual(expect.objectContaining({
  assetId: 'garden', trackId: 'video-1', start: 0, duration: 12, sourceIn: 0,
}));
expect(project.assets.garden).toEqual(expect.objectContaining({
  kind: 'video', sourceDuration: expect.any(Number), availability: 'online',
}));
expect('versionId' in project.clips['clip-garden']).toBe(false);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test src/timeline/types.test.ts src/domain/editor.test.ts`

Expected: FAIL because `TimelineProject` and `createDemoProject` do not exist and the editor still exposes versioned assets.

- [ ] **Step 3: Implement focused types and demo fixture**

```ts
export const FPS = 24;
export const MIN_CLIP_DURATION = 1 / FPS;
export interface MediaAsset {
  id: string; name: string; kind: 'video' | 'image' | 'audio'; src: string;
  sourceDuration: number | null; availability: 'online' | 'offline';
}
export interface TimelineClip {
  id: string; assetId: string; trackId: string;
  start: number; duration: number; sourceIn: number;
}
export interface TimelineTrack {
  id: string; name: string; kind: 'visual' | 'audio'; order: number;
  muted: boolean; locked: boolean;
}
export interface TimelineProject {
  fps: 24; assets: Record<string, MediaAsset>; clips: Record<string, TimelineClip>;
  tracks: Record<string, TimelineTrack>; selectedAssetId: string | null;
  selectedClipId: string | null;
}
```

- [ ] **Step 4: Adapt editor snapshots and history to `TimelineProject`**

Keep model selection and undo/redo fields in `EditorState`, but make its project payload canonical. Delete version-selection and clip-version-replacement commands. Ensure history snapshots copy the project fields without transient viewport state.

- [ ] **Step 5: Run model and editor tests**

Run: `pnpm test src/timeline/types.test.ts src/domain/editor.test.ts`

Expected: PASS; no version field exists in canonical assets or clips.

- [ ] **Step 6: Checkpoint**

Record the passing command and changed files in the task handoff; do not create a Git commit.

### Task 2: Build Shared Time Geometry, Collision, and Snapping

**Files:**
- Create: `src/timeline/geometry.ts`
- Create: `src/timeline/geometry.test.ts`

**Interfaces:**
- Consumes: canonical types from Task 1.
- Produces: `timeToX`, `xToTime`, `zoomAroundPlayhead`, `getProjectDuration`, `clipsOverlap`, `canPlaceClip`, `snapTime`.

- [ ] **Step 1: Write failing geometry and collision tests**

```ts
expect(timeToX(12, { pixelsPerSecond: 20, scrollTime: 2 })).toBe(200);
expect(xToTime(200, { pixelsPerSecond: 20, scrollTime: 2 })).toBe(12);
expect(clipsOverlap({ start: 0, duration: 5 }, { start: 5, duration: 2 })).toBe(false);
expect(clipsOverlap({ start: 0, duration: 5 }, { start: 4.99, duration: 2 })).toBe(true);
expect(snapTime(4.7, [5], 20, 8)).toBe(5);
expect(snapTime(4.5, [5], 20, 8)).toBe(4.5);
```

Add a zoom test proving the playhead screen X is identical before and after `zoomAroundPlayhead`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test src/timeline/geometry.test.ts`

Expected: FAIL because the geometry module does not exist.

- [ ] **Step 3: Implement pure geometry functions**

```ts
export const timeToX = (time: number, view: TimelineViewport) =>
  (time - view.scrollTime) * view.pixelsPerSecond;
export const xToTime = (x: number, view: TimelineViewport) =>
  view.scrollTime + x / view.pixelsPerSecond;
export const clipsOverlap = (a: TimeRange, b: TimeRange) =>
  a.start < b.start + b.duration && b.start < a.start + a.duration;
```

`canPlaceClip` must ignore the clip being moved and reject overlap only on the target track. `snapTime` converts the 8px threshold into seconds with `8 / pixelsPerSecond`.

- [ ] **Step 4: Implement dynamic ruler step selection**

Produce `getRulerStep(pixelsPerSecond, fps)` from `[1/fps, 1, 5, 10, 30, 60, 300]`, choosing the smallest step that renders at least 56px apart.

- [ ] **Step 5: Run geometry tests**

Run: `pnpm test src/timeline/geometry.test.ts`

Expected: PASS for inverse coordinates, anchored zoom, duration, collision, snapping, and ruler steps.

- [ ] **Step 6: Checkpoint**

Record passing geometry tests; do not create a Git commit.

### Task 3: Implement Validated, Undoable Timeline Commands

**Files:**
- Create: `src/timeline/commands.ts`
- Create: `src/timeline/commands.test.ts`
- Modify: `src/domain/editor.ts`
- Modify: `src/domain/editor.test.ts`

**Interfaces:**
- Consumes: Task 1 types and Task 2 validation helpers.
- Produces: `insertClip`, `moveClip`, `resizeClipStart`, `resizeClipEnd`, `deleteClip` command payloads and `applyTimelineCommand(project, command)`.

- [ ] **Step 1: Write failing insertion and movement tests**

```ts
expect(applyTimelineCommand(project, {
  type: 'insertClip', clip: { id: 'new', assetId: 'portrait', trackId: 'video-1', start: 12, duration: 5, sourceIn: 0 },
}).ok).toBe(true);
expect(applyTimelineCommand(project, {
  type: 'moveClip', clipId: 'clip-garden', trackId: 'video-1', start: 4,
}).ok).toBe(false); // collides with the neighboring clip
```

Test wrong media/track type rejection and valid visual-to-visual cross-track movement.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test src/timeline/commands.test.ts`

Expected: FAIL because command application does not exist.

- [ ] **Step 3: Implement discriminated command results**

```ts
type TimelineCommandResult =
  | { ok: true; project: TimelineProject }
  | { ok: false; reason: 'overlap' | 'wrong-track-type' | 'source-before-zero' | 'too-short' | 'locked-track' };
```

Never partially mutate on failure. Enforce `duration >= MIN_CLIP_DURATION`, `start >= 0`, track compatibility, locks, and collision rules.

- [ ] **Step 4: Implement edge-resize semantics**

`resizeClipStart` preserves the old end, applies `sourceIn += newStart - oldStart`, and rejects negative `sourceIn`. `resizeClipEnd` changes duration without clamping video/image to source duration. Extended audio/video behavior is resolved during playback, not by changing the clip.

- [ ] **Step 5: Integrate successful commands with editor history**

One pointer release maps to one `applyCommand` history entry. Failed commands return the original state without appending history. Verify undo/redo restores `start`, `duration`, `sourceIn`, and `trackId` together.

- [ ] **Step 6: Run command and editor tests**

Run: `pnpm test src/timeline/commands.test.ts src/domain/editor.test.ts`

Expected: PASS for insertion, movement, cross-track movement, both resize edges, rejection, undo, and redo.

- [ ] **Step 7: Checkpoint**

Record passing command/history tests; do not create a Git commit.

### Task 4: Replace Preview Playback with a Timeline-Only Program Engine

**Files:**
- Replace: `src/program/resolveProgramFrame.ts`
- Modify: `src/program/resolveProgramFrame.test.ts`
- Replace: `src/program/useProgramClock.ts`
- Modify: `src/program/useProgramClock.test.ts`
- Modify: `src/components/Preview.tsx`
- Modify: `src/components/Preview.test.tsx`

**Interfaces:**
- Consumes: `TimelineProject`, current project time.
- Produces: `resolveProgramState(project, time): ProgramState`, `useProgramClock(duration)`, timeline-only `Preview` props.

- [ ] **Step 1: Write failing program-resolution tests**

```ts
expect(resolveProgramState(project, 5).visual?.clipId).toBe('clip-portrait');
expect(resolveProgramState(project, 13).visual).toBeNull();
expect(resolveProgramState(project, 19).visual?.clipId).toBe('clip-waves');
expect(resolveProgramState(project, 30).duration).toBe(38); // fixture includes audio to 38
```

Add fixtures proving higher-track coverage, lower-track reveal, all-track black, active audio collection, image source time zero, and offline preservation.

- [ ] **Step 2: Write failing hold-last-frame tests**

```ts
const visual = resolveProgramState(videoExtendedProject, 9).visual!;
expect(visual.sourceTime).toBe(4);
expect(visual.renderTime).toBeCloseTo(3 + 23 / 24); // 4-second source, final decodable frame
expect(visual.isHeldFrame).toBe(true);
```

- [ ] **Step 3: Implement pure program resolution**

Return both unbounded `sourceTime` and clamped `renderTime`. Select visual candidates by track order and collect unmuted audio independently. `duration` always comes from `getProjectDuration`.

- [ ] **Step 4: Make the project clock single-chain and media-independent**

Keep animation scheduling outside React state updater functions. Test under `StrictMode` that one `toggle()` creates exactly one RAF chain. The clock owns project time; media `timeupdate` never writes it.

- [ ] **Step 5: Refactor Preview to preserve media elements within a clip**

Preview receives `{ program, clock }`. Key the video element by `clipId`, not by time. Within the same clip write only `video.currentTime = visual.renderTime`; on held frames pause the element at the final frame. During scrubbing pause media immediately and resume only after scrub end if the clock was previously playing.

- [ ] **Step 6: Run program and Preview tests**

Run: `pnpm test src/program src/components/Preview.test.tsx`

Expected: PASS for hierarchy, black gaps, hold frame, images, offline state, audio collection, clock uniqueness, and media-source stability.

- [ ] **Step 7: Checkpoint**

Record passing program/preview tests; do not create a Git commit.

### Task 5: Build the Zoomable, Scrollable Timeline Viewport

**Files:**
- Create: `src/timeline/useTimelineViewport.ts`
- Create: `src/timeline/useTimelineViewport.test.ts`
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 2 geometry, project duration, playhead time.
- Produces: viewport state/actions `{ view, setZoomAtPlayhead, setScrollTime, fitProject }` and a Timeline rendered from canonical seconds.

- [ ] **Step 1: Write failing anchored-zoom and fit tests**

```ts
const beforeX = timeToX(12, result.current.view);
act(() => result.current.setZoomAtPlayhead(40, 12, 800));
expect(timeToX(12, result.current.view)).toBeCloseTo(beforeX);
act(() => result.current.fitProject(28, 700));
expect(result.current.view.pixelsPerSecond).toBeCloseTo(25);
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test src/timeline/useTimelineViewport.test.ts src/components/Timeline.test.tsx`

Expected: FAIL because the viewport hook and dynamic timeline do not exist.

- [ ] **Step 3: Implement viewport state and controls**

Clamp `pixelsPerSecond` to `4..400`. Preserve playhead X during zoom. `fitProject` subtracts the 52px label gutter and horizontal padding before calculating zoom. Scroll time never becomes negative.

- [ ] **Step 4: Render ruler, playhead, clips, and widths with shared geometry**

Remove percentage-based clip positioning and hard-coded ruler labels. Render a scrollable content surface whose pixel width is `max(viewportWidth, projectDuration * pixelsPerSecond)`. Use `timeToX` for clip left and playhead X, and `duration * pixelsPerSecond` for clip width.

- [ ] **Step 5: Add controls and accessibility**

Connect the existing zoom slider, add “适合项目” button, expose current zoom in accessible text, retain keyboard-operable range input, and keep track labels fixed while only the time surface scrolls.

- [ ] **Step 6: Run viewport/component tests and build**

Run: `pnpm test src/timeline/useTimelineViewport.test.ts src/components/Timeline.test.tsx && pnpm build`

Expected: PASS; no percentage positioning or fixed `00:10..00:50` labels remain.

- [ ] **Step 7: Checkpoint**

Record passing viewport tests and build; do not create a Git commit.

### Task 6: Add Asset Drop, Clip Move, Cross-Track Move, and Edge Resize

**Files:**
- Modify: `src/components/AssetLibrary.tsx`
- Modify: `src/components/AssetLibrary.test.tsx`
- Create: `src/components/TimelineClip.tsx`
- Create: `src/components/TimelineClip.test.tsx`
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Tasks 2-3 geometry/commands and Task 5 viewport.
- Produces: drag payload `{ assetId, kind }`, transient `ClipGesture`, and one command callback per completed gesture.

- [ ] **Step 1: Write failing asset-drag and track-drop tests**

```ts
fireEvent.dragStart(screen.getByRole('gridcell', { name: /人物剪影/ }), {
  dataTransfer: makeDataTransfer(),
});
fireEvent.drop(screen.getByTestId('track-video-1'), { clientX: 320, dataTransfer });
expect(onInsertClip).toHaveBeenCalledWith(expect.objectContaining({
  assetId: 'portrait', trackId: 'video-1', start: expect.any(Number), duration: 5,
}));
```

Add wrong-track and same-track-overlap cases that render invalid feedback and do not call a command.

- [ ] **Step 2: Make asset tiles draggable**

Set `draggable`, write MIME `application/x-lumina-media` JSON containing only `assetId` and `kind`, and preserve click selection. Do not include file contents or object URLs in drag data.

- [ ] **Step 3: Write failing clip-gesture tests**

Test body drag, vertical target-track selection, left resize, right resize, 8px snap, invalid overlap, one commit on pointer-up, pointer capture, and `Escape` cancellation.

- [ ] **Step 4: Implement `TimelineClip` transient gesture state**

Use Pointer Events and `setPointerCapture`. Store initial project values and pointer origin. During movement calculate candidate seconds through `xToTime`; render the candidate directly without mutating project state. On pointer-up call exactly one validated command. On `Escape`, clear transient state and call no command.

- [ ] **Step 5: Apply Apple-style feedback only to changed gestures**

Respond on pointer-down, track 1:1, show a restrained translucent ghost, use red border plus resistance for invalid locations, and use critically damped settling only for snap/revert. Under reduced motion, commit or revert without movement animation.

- [ ] **Step 6: Run drag/gesture tests**

Run: `pnpm test src/components/AssetLibrary.test.tsx src/components/TimelineClip.test.tsx src/components/Timeline.test.tsx`

Expected: PASS for insert, move, cross-track move, resize, snap, rejection, cancel, and single history commit.

- [ ] **Step 7: Checkpoint**

Record passing gesture tests; do not create a Git commit.

### Task 7: Integrate the Editor and Remove Competing Legacy State

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/styles.css`
- Modify: `README.md`
- Delete after migration: `src/playback/usePlaybackController.ts`
- Delete after migration: `src/playback/usePlaybackController.test.ts`
- Delete obsolete timeline/program helpers superseded by Tasks 2-5.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: one integrated editor where `EditorState.project` and program playhead are the only project/render state.

- [ ] **Step 1: Write failing end-to-end component tests**

```ts
render(<App />);
seekTimeline(5);
expect(screen.getByRole('img', { name: '人物剪影预览' })).toBeVisible();
seekTimeline(13);
expect(screen.getByText('时间线空白')).toBeVisible();
dragClip('人物剪影', { toTrack: 'V1', start: 20 });
seekTimeline(20);
expect(screen.getByRole('img', { name: '人物剪影预览' })).toBeVisible();
```

Add integration cases for library selection isolation, higher-track coverage, project duration including longer audio, video held frame, undo/redo after move/resize, and ruler/playhead/clip coordinate equality.

- [ ] **Step 2: Connect App to canonical project commands and resolver**

Remove `localPreview`, version callbacks, percentage positions, demo fallbacks independent of clips, and media-owned time. Pass the same project, viewport, clock time, and command dispatcher to Timeline and Preview.

- [ ] **Step 3: Remove obsolete modules and UI**

Delete the old playback controller after imports are zero. Remove version stack selectors, version replacement UI, hard-coded ruler timestamps, hard-coded 620px drag bounds, and CSS clip-width classes.

- [ ] **Step 4: Update README behavior documentation**

Document canonical time, zoom/scroll, drag/drop, no-overlap, cross-track movement, free extension, held video frames, extended-audio silence, visual layering, and black-gap behavior.

- [ ] **Step 5: Run static legacy scans**

Run:

```bash
rg -n "versionId|AssetStack|AssetVersion|usePlaybackController|620|00:50|clip-portrait\{width|clip-waves\{width" src
```

Expected: no production matches for removed legacy state or hard-coded timeline geometry.

- [ ] **Step 6: Run complete automated verification**

Run: `pnpm test && pnpm build`

Expected: zero failing tests and successful TypeScript/Vite production build.

- [ ] **Step 7: Perform browser acceptance**

Restart Vite. Verify at desktop width: fit project, zoom around playhead, horizontal scroll, drag video/image/audio into legal tracks, reject wrong tracks and overlap, move horizontally, move across compatible tracks, resize both edges, cancel with Escape, undo/redo each edit, scrub through coverage/gaps/held frames, and confirm preview/ruler/clip positions agree.

- [ ] **Step 8: Checkpoint**

Record automated results and browser acceptance observations; do not create a Git commit.
