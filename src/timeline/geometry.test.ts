import { describe, expect, it } from 'vitest';

import { createDemoProject } from './fixtures';
import {
  canPlaceClip,
  clampTimelineScrollTime,
  clipsOverlap,
  findNearestGap,
  getProjectDuration,
  getRulerStep,
  getTimelineContentWidth,
  getVisibleRulerMarks,
  snapClipMove,
  snapTime,
  timeToX,
  xToTime,
  zoomAroundPlayhead,
} from './geometry';

describe('timeline geometry', () => {
  it('converts time and pixels through the same viewport', () => {
    const viewport = { pixelsPerSecond: 40, scrollTime: 5 };

    expect(timeToX(8, viewport)).toBe(120);
    expect(xToTime(120, viewport)).toBe(8);
  });

  it('keeps the playhead at the same screen position while zooming', () => {
    const viewport = { pixelsPerSecond: 40, scrollTime: 5 };
    const anchorBefore = timeToX(8, viewport);
    const zoomed = zoomAroundPlayhead(viewport, 80, 8);

    expect(timeToX(8, zoomed)).toBe(anchorBefore);
    expect(zoomed.scrollTime).toBe(6.5);
  });

  it('uses the latest clip end on every track as project duration', () => {
    expect(getProjectDuration(createDemoProject())).toBe(28);
  });

  it('treats touching clips as valid and overlapping clips as invalid', () => {
    expect(clipsOverlap({ start: 0, duration: 4 }, { start: 4, duration: 2 })).toBe(false);
    expect(clipsOverlap({ start: 0, duration: 4 }, { start: 3.99, duration: 2 })).toBe(true);
  });

  it('finds the requested empty gap without moving forward', () => {
    expect(findNearestGap([{ start: 0, duration: 4 }], 6, 2)).toBe(6);
  });

  it('advances through unsorted overlapping and touching obstructions to the first fitting gap', () => {
    expect(findNearestGap([
      { start: 10, duration: 4 },
      { start: 4, duration: 6 },
      { start: 0, duration: 5 },
    ], 3, 3)).toBe(14);
  });

  it('only rejects overlap on the candidate track', () => {
    const project = createDemoProject();
    const clip = project.clips['clip-garden'];

    expect(canPlaceClip(project, { ...clip, start: 12, duration: 2 })).toBe(true);
    expect(canPlaceClip(project, { ...clip, start: 13, duration: 2 })).toBe(false);
    expect(canPlaceClip(project, { ...clip, trackId: 'video-2', start: 0, duration: 2 })).toBe(true);
  });

  it('snaps only when a target is within the pixel threshold', () => {
    expect(snapTime(4.9, [5, 10], 40)).toBe(5);
    expect(snapTime(4.7, [5, 10], 40)).toBe(4.7);
  });

  it('snaps the moving end edge to a neighboring start edge', () => {
    expect(snapClipMove(4.85, 5, [10], 40)).toEqual({ start: 5, guideTime: 10 });
  });

  it('does not snap outside eight screen pixels', () => {
    expect(snapClipMove(4.7, 5, [10], 40)).toBeNull();
  });

  it('uses the nearest deterministic candidate', () => {
    expect(snapClipMove(5.1, 2, [5, 7.15], 40)).toEqual({ start: 5.15, guideTime: 7.15 });
  });

  it('prefers a current-track target when candidates have the same pixel distance', () => {
    expect(snapClipMove(5, 2, [4.9, 5.1], 40, 8, new Set([5.1]))).toEqual({
      start: 5.1,
      guideTime: 5.1,
    });
  });

  it('rejects a snap candidate that would move before the timeline start', () => {
    expect(snapClipMove(0.1, 5, [4.9], 40)).toBeNull();
  });

  it('falls back to the next valid snap candidate near the timeline start', () => {
    expect(snapClipMove(0.1, 5, [4.95, 0.3], 40)).toEqual({ start: 0.3, guideTime: 0.3 });
  });

  it('normalizes floating-point noise for an end snap at the timeline start', () => {
    expect(snapClipMove(0.1, 0.3, [0.3], 40)).toEqual({ start: 0, guideTime: 0.3 });
  });

  it('chooses readable ruler intervals for the current zoom', () => {
    expect(getRulerStep(120)).toBe(1);
    expect(getRulerStep(12)).toBe(5);
  });

  it('keeps horizontal browsing space even when the project is shorter than the viewport', () => {
    expect(getTimelineContentWidth(5, 12, 1200)).toBe(1520);
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
});
