# Timeline Viewport and Snapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the timeline fill its panel, zoom without self-expanding or crashing, and snap moving clip edges to neighboring clip edges with visible feedback.

**Architecture:** Keep timeline geometry in pure functions and let `Timeline` own only measurement and pointer state. Content width derives from viewport width and project duration, never scroll position. Drag previews consume the same snap result later committed through timeline commands.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Pointer Events, ResizeObserver.

**Spec:** `docs/superpowers/specs/2026-08-25-markdown-asset-actions-timeline-interactions-design.md`

## Global Constraints

- Zoom remains within 12–160 pixels per second.
- Snap threshold is 8 screen pixels at every zoom level.
- End padding changes workspace width but never project or preview duration.
- Existing timeline command overlap and track-type validation remains authoritative.
- Reduced-motion mode must not animate the snap guide.

---

### Task 1: Bounded Timeline Viewport Geometry

**Files:**
- Modify: `src/timeline/geometry.ts`
- Modify: `src/timeline/geometry.test.ts`

**Interfaces:**
- Produces: `getTimelineContentWidth(projectDuration, pixelsPerSecond, viewportWidth, labelWidth?, endPadding?): number`
- Produces: `clampTimelineScrollTime(scrollTime, pixelsPerSecond, contentWidth, viewportWidth): number`
- Produces: `getVisibleRulerMarks(scrollTime, viewportWidth, pixelsPerSecond): number[]`

- [ ] **Step 1: Write failing viewport geometry tests**

```ts
it('fills the viewport and never derives width from scroll position', () => {
  expect(getTimelineContentWidth(5, 12, 1200)).toBe(1200);
  expect(getTimelineContentWidth(30, 100, 1200)).toBe(3172);
});

it('clamps scroll time after zoom', () => {
  expect(clampTimelineScrollTime(100, 100, 3172, 1200)).toBeCloseTo(19.72);
});

it('returns only visible ruler marks', () => {
  const marks = getVisibleRulerMarks(60, 900, 40);
  expect(marks.length).toBeLessThan(30);
  expect(Math.min(...marks)).toBeLessThanOrEqual(60);
  expect(Math.max(...marks)).toBeGreaterThanOrEqual(82.5);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test src/timeline/geometry.test.ts`

Expected: FAIL because the three functions are not exported.

- [ ] **Step 3: Implement minimal pure geometry**

Use defaults `labelWidth = 52`, `endPadding = 120`. Calculate marks from `getRulerStep`, beginning one step before the visible start and ending one step after the visible end. Never accept `scrollTime` in `getTimelineContentWidth`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm test src/timeline/geometry.test.ts`

Expected: all geometry tests pass.

- [ ] **Step 5: Commit if Git is available**

```bash
git add src/timeline/geometry.ts src/timeline/geometry.test.ts
git commit -m "fix: bound timeline viewport geometry"
```

If the workspace is not a Git repository, record the checkpoint without committing.

### Task 2: Dual-Edge Clip Snapping

**Files:**
- Modify: `src/timeline/geometry.ts`
- Modify: `src/timeline/geometry.test.ts`

**Interfaces:**
- Produces: `SnapCandidate = { start: number; guideTime: number }`
- Produces: `snapClipMove(start, duration, targets, pixelsPerSecond, thresholdPx?, preferredTargets?): SnapCandidate | null`

- [ ] **Step 1: Write failing dual-edge tests**

```ts
it('snaps the moving end edge to a neighboring start edge', () => {
  expect(snapClipMove(4.85, 5, [10], 40)).toEqual({ start: 5, guideTime: 10 });
});

it('does not snap outside eight screen pixels', () => {
  expect(snapClipMove(4.7, 5, [10], 40)).toBeNull();
});

it('uses the nearest deterministic candidate', () => {
  expect(snapClipMove(5.1, 2, [5, 7.15], 40)).toEqual({ start: 5.15, guideTime: 7.15 });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test src/timeline/geometry.test.ts`

Expected: FAIL because `snapClipMove` does not exist.

- [ ] **Step 3: Implement candidate comparison**

Compare both moving edges against all target edges. Convert each required time delta to pixels, reject values above the threshold, then sort by pixel distance, preferred-target membership, guide time, and resulting start. Clamp the returned start to zero.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm test src/timeline/geometry.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit if available**

```bash
git add src/timeline/geometry.ts src/timeline/geometry.test.ts
git commit -m "feat: add dual-edge timeline snapping"
```

### Task 3: Resize-Aware Timeline and Snap Guide

**Files:**
- Modify: `src/components/Timeline.tsx`
- Modify: `src/components/Timeline.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/test/setup.ts`

**Interfaces:**
- Consumes: geometry functions from Tasks 1–2.
- Produces: timeline DOM with bounded `.timeline-content` width and optional `.timeline-snap-guide`.

- [ ] **Step 1: Add a deterministic ResizeObserver test shim**

Define a test `ResizeObserver` whose `observe()` invokes the callback with `contentRect.width = 1000`. Keep it in test setup so component tests do not depend on jsdom layout.

- [ ] **Step 2: Write failing component tests**

```ts
test('content fills viewport and zoom expands width', async () => {
  renderTimeline();
  expect(screen.getByTestId('timeline-content')).toHaveStyle({ width: '1000px' });
  await userEvent.selectOptions(screen.getByLabelText('时间线缩放'), '160');
  expect(Number.parseFloat(screen.getByTestId('timeline-content').style.width)).toBeGreaterThan(1000);
});

test('drag preview shows a guide when an edge snaps', async () => {
  renderTimelineWithAdjacentClips();
  fireEvent.pointerDown(screen.getByRole('button', { name: /人物剪影/ }), { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(screen.getByRole('button', { name: /人物剪影/ }), { clientX: 106, pointerId: 1 });
  expect(screen.getByTestId('timeline-snap-guide')).toBeVisible();
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm test src/components/Timeline.test.tsx`

Expected: FAIL because viewport measurement, test IDs, and snap guide are absent.

- [ ] **Step 4: Implement viewport measurement and visible marks**

Add `viewportWidth` to view state. Observe `.timeline-scroll`, calculate width with `getTimelineContentWidth`, replace the current `contentDuration = max(duration, scrollTime + 10)`, and render marks from `getVisibleRulerMarks`.

When zoom changes, calculate the anchor, update pixels per second, wait for layout, then clamp and assign `scrollLeft`. The `onScroll` handler only updates `scrollTime`.

- [ ] **Step 5: Implement snapped drag preview**

Move gesture preview from raw `deltaX` to a calculated preview start. Store `guideTime` in the parent timeline so the guide spans all tracks. Clear it on pointer up, cancel, and new gesture. Commit the preview start through `moveClip`.

- [ ] **Step 6: Add restrained guide styling**

Use a one-pixel high-contrast line, no pointer events, and no transition under reduced motion. Do not animate its horizontal position.

- [ ] **Step 7: Run focused and full tests**

Run: `pnpm test src/timeline/geometry.test.ts src/components/Timeline.test.tsx`

Expected: all focused tests pass.

Run: `pnpm test && pnpm run build`

Expected: all tests and TypeScript/Vite build pass.

- [ ] **Step 8: Browser acceptance**

At `http://127.0.0.1:5173/`, verify the timeline fills its panel at minimum zoom, grows horizontally at maximum zoom, retains a bounded scrollbar after repeated zoom cycles, and shows a guide while snapping both clip edges.

