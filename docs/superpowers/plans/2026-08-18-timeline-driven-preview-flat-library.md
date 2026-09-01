# Timeline-Driven Preview and Flat Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace asset version stacks with a flat square media grid and make the preview render only the media resolved from timeline tracks at the current playhead.

**Architecture:** A single `MediaAsset` catalog feeds timeline clips by stable asset ID. A pure program resolver selects the highest active visual clip and all active unmuted audio clips; a program clock drives playhead time while the preview acts only as a renderer.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest, Testing Library, HTMLMediaElement, File System Access API, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-08-18-timeline-driven-preview-flat-library-design.md`

## Global Constraints

- Browser-only application; local media is never uploaded by this phase.
- The preview may only show media referenced by an active timeline clip.
- Highest visible visual track fully covers lower tracks; no compositing in this phase.
- Selecting a library tile must not change program preview.
- Every file and AI generation is an independent flat asset; no version fields or inferred relationships.
- Missing files remain referenced as `offline`; never silently substitute demo media.
- Apple Design applies only to UI added or changed by this plan; do not restyle the title bar, assistant, existing timeline chrome, or unrelated modules.
- Apple Design: direct manipulation touched by this change updates 1:1 on pointer movement, remains interruptible, and uses soft bounds with critically damped settling.
- Apple Design: program visual changes use a restrained cross-fade; reduced motion uses a static switch, reduced transparency uses solid materials, and high contrast uses explicit borders.
- The asset grid adapts to the asset-panel container dimensions, not the viewport.
- Git metadata cannot be created in this workspace; use test-backed checkpoints instead of commits.

---

### Task 1: Replace Versioned Assets with a Flat Media Catalog

**Files:**
- Modify: `src/domain/editor.ts`
- Modify: `src/domain/editor.test.ts`
- Modify: `src/media/mediaTypes.ts`
- Modify: `src/media/useMediaLibrary.ts`

**Interfaces:**
- Produces: `MediaAsset`, `EditorState.assets: Record<string, MediaAsset>`.
- Produces: `TimelineClip` with `assetId`, `trackId`, `start`, `duration`, and `sourceIn` only.
- Removes: `AssetStack`, `AssetVersion`, version IDs, current-version commands, and clip-version replacement.

- [ ] **Step 1: Write failing flat-model tests**

```ts
const state = createDemoState();
expect(state.assets['demo-video']).toMatchObject({
  kind: 'video', source: 'demo', availability: 'online',
});
expect(state.clips['clip-demo']).toEqual(expect.objectContaining({
  assetId: 'demo-video', trackId: 'video-1', sourceIn: 0,
}));
expect('versions' in state).toBe(false);
expect('versionId' in state.clips['clip-demo']).toBe(false);
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `pnpm test src/domain/editor.test.ts`
Expected: FAIL because the current state still exposes version stacks.

- [ ] **Step 3: Implement `MediaAsset` and migrate demo state**

```ts
export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  source: 'demo' | 'local' | 'generated';
  objectUrl: string;
  size: number;
  modifiedAt: number;
  duration?: number;
  width?: number;
  height?: number;
  availability: 'online' | 'offline';
}
```

Create `demo-video` using `/demo/demo-video.mp4`, seed `clip-demo` on V1 at zero, and remove every version command and snapshot field.

- [ ] **Step 4: Adapt local scan results into `MediaAsset` records**

Local files use `source: 'local'` and `availability: 'online'`. Preserve missing previously known IDs as `offline` when reconciling a rescan.

- [ ] **Step 5: Run domain and media tests**

Run: `pnpm test src/domain/editor.test.ts src/media`
Expected: flat model, directory scanning, offline reconciliation, undo, track add/delete all pass.

### Task 2: Build the Pure Timeline Program Resolver

**Files:**
- Create: `src/program/resolveProgramFrame.ts`
- Create: `src/program/resolveProgramFrame.test.ts`

**Interfaces:**
- Consumes: `EditorState`, `MediaAsset`, `TimelineTrack`, `TimelineClip` from Task 1.
- Produces: `ProgramFrame`, `resolveProgramFrame(state, playheadTime)`, `getProgramDuration(state)`.

- [ ] **Step 1: Write failing resolver boundary and layering tests**

```ts
expect(resolveProgramFrame(state, 0).visual?.clipId).toBe('clip-demo');
expect(resolveProgramFrame(state, 8).visual?.clipId).toBe('clip-overlay');
expect(resolveProgramFrame(state, 20).visual).toBeNull();
expect(getProgramDuration(state)).toBe(20);
```

Add literal fixtures proving start-inclusive/end-exclusive activation, higher video-track coverage, hidden visual exclusion, muted audio exclusion, multiple active audio results, image `sourceTime=0`, and offline asset preservation.

- [ ] **Step 2: Run the resolver test and verify RED**

Run: `pnpm test src/program/resolveProgramFrame.test.ts`
Expected: FAIL because the resolver module does not exist.

- [ ] **Step 3: Implement resolver and program duration**

```ts
export interface ProgramFrameItem {
  clipId: string;
  asset: MediaAsset;
  sourceTime: number;
}
export interface ProgramFrame {
  visual: ProgramFrameItem | null;
  audio: ProgramFrameItem[];
}
```

Sort visual tracks by displayed order and select the highest active candidate. Compute source time with `sourceIn + playheadTime - start`, except images use zero.

- [ ] **Step 4: Run focused and domain tests**

Run: `pnpm test src/program/resolveProgramFrame.test.ts src/domain/editor.test.ts`
Expected: all program selection and editor-history behaviors pass.

### Task 3: Replace the Asset Cards with an Apple-Style Square Grid

**Files:**
- Modify: `src/components/AssetLibrary.tsx`
- Create: `src/components/AssetLibrary.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `MediaAsset[]`, directory status, selected asset ID.
- Produces: `onSelectAsset(assetId)` only; no preview or version callbacks.

- [ ] **Step 1: Write failing semantic grid tests**

```ts
expect(screen.getByRole('grid', { name: '素材库文件' })).toBeInTheDocument();
expect(screen.getAllByRole('gridcell')).toHaveLength(assets.length);
expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
expect(screen.queryByRole('region', { name: '素材版本堆栈' })).not.toBeInTheDocument();
```

Click a square tile and assert only `onSelectAsset(id)` runs; the component exposes no preview callback.

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm test src/components/AssetLibrary.test.tsx`
Expected: FAIL because the current component renders cards and version stack controls.

- [ ] **Step 3: Implement the responsive square grid**

Use a named `role="grid"` containing focusable `role="gridcell"` square buttons. Apply `repeat(auto-fill, minmax(96px, 1fr))`, `aspect-ratio: 1 / 1`, an 8px gap, adaptive padding around 10px, and vertical scrolling. Keep the directory toolbar and status above the grid; do not render a header.

- [ ] **Step 4: Apply Apple Design tile behavior**

Use system typography, instant pointer-down highlight, a restrained selected material, visible keyboard focus, solid fallbacks for reduced transparency, and explicit borders for high contrast. Thumbnails fill the square, filenames sit on a bottom gradient, and type/offline badges sit at the top right. Do not restyle unrelated modules or animate grid reflow.

Keep square geometry at every panel size. Panel width controls column count; panel height only controls visible rows. Below 192px keep one column without horizontal scrolling.

- [ ] **Step 5: Write responsive container tests**

Verify grid/tile roles, square geometry class, type badge, filename overlay, and full filename through `title` and accessible name. Verify video, image, and audio use the same tile geometry.

- [ ] **Step 6: Run component tests and build**

Run: `pnpm test src/components/AssetLibrary.test.tsx && pnpm build`
Expected: semantic grid tests and TypeScript production build pass.

### Task 4: Make Preview a Timeline Program Renderer

**Files:**
- Create: `src/program/useProgramClock.ts`
- Create: `src/program/useProgramClock.test.ts`
- Modify: `src/components/Preview.tsx`
- Modify: `src/components/Preview.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ProgramFrame`, program duration, playhead time.
- Produces: program clock `{ currentTime, status, play, pause, toggle, seek, stepFrame }`.
- Preview consumes resolved `ProgramFrame`; it does not accept a selected library asset.

- [ ] **Step 1: Write failing program-clock tests**

Test clamped seeking, frame stepping, playhead progression, ending at program duration, pausing when the document hides, and restart from zero after reaching the end.

Run: `pnpm test src/program/useProgramClock.test.ts`
Expected: FAIL because the program clock does not exist.

- [ ] **Step 2: Implement the program clock**

Use `requestAnimationFrame` and elapsed monotonic time to update program time. Cancel on pause, hidden document, duration end, source change, and unmount. The clock owns playhead time; media elements never update it.

- [ ] **Step 3: Write failing timeline-driven Preview tests**

Assert video frame renders the resolved video, image frame renders the resolved image, `visual=null` renders “时间线空白”, offline visual renders “素材离线”, audio count is displayed, and changing library selection alone leaves the same preview frame.

- [ ] **Step 4: Implement program rendering and media synchronization**

For video, set `currentTime` to resolved `sourceTime` whenever drift exceeds 0.1 seconds. For images, render a static image while the program clock continues. For black/offline states, never substitute demo media.

- [ ] **Step 5: Apply Apple Design transition behavior**

Cross-fade visual source changes over 140ms without spatial movement. Start from the live opacity and allow immediate retargeting. Under `prefers-reduced-motion`, switch statically. Playback controls respond on pointer-down and retain text/icon status feedback.

- [ ] **Step 6: Connect App to resolver and clock**

Compute `const frame = resolveProgramFrame(state, clock.currentTime)`. Pass the same clock time to Preview and Timeline. Library selection remains a separate state used only for tile highlighting.

- [ ] **Step 7: Run preview, clock, App, and build verification**

Run: `pnpm test src/program src/components/Preview.test.tsx src/App.test.tsx && pnpm build`
Expected: program preview follows timeline and production build passes.

### Task 5: Remove Version UI and Complete Timeline Integration

**Files:**
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/App.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Timeline consumes program `currentTime`, `duration`, and `onSeek`.
- Removes `onReplaceVersion` and every version selector.

- [ ] **Step 1: Write failing removal and integration tests**

```ts
expect(screen.queryByText('片段版本')).not.toBeInTheDocument();
expect(screen.queryByText(/版本堆栈|当前版本|时间线仍使用/)).not.toBeInTheDocument();
expect(screen.getByText('时间线空白')).toBeInTheDocument();
```

Move the playhead across demo, overlay, and empty intervals and assert the program preview changes accordingly. Delete the active track and assert preview re-resolves immediately.

- [ ] **Step 2: Run Timeline and App tests and verify RED**

Run: `pnpm test src/components/Timeline.test.tsx src/App.test.tsx`
Expected: FAIL because version controls and independent preview wiring remain.

- [ ] **Step 3: Remove version controls and update timeline clip labels**

Timeline clips show asset name and media type/offline status only. Preserve track add/delete, confirmation focus handling, direct clip movement, and undo/redo.

- [ ] **Step 4: Update AI demo behavior**

Submitting the demonstration AI action adds a new generated `MediaAsset` tile with a new ID; it does not replace an existing asset or alter an existing timeline clip automatically.

- [ ] **Step 5: Update documentation**

Describe the flat square grid, timeline-only program preview, black/offline states, highest-track coverage, and the absence of version inference.

- [ ] **Step 6: Run final verification**

Run: `pnpm test && pnpm build`
Expected: zero failing tests, successful TypeScript check, successful Vite build, and no version-stack terminology in rendered UI.

- [ ] **Step 7: Manual browser acceptance**

Restart Vite to avoid stale module cache. Verify the served `App.tsx` contains `resolveProgramFrame` and no `AssetStack`. In Chromium, move playhead across visual clips and blank space, select unrelated library tiles, delete the active track, scan a local folder, and confirm program preview follows only the timeline.
