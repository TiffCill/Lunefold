import type { TimelineClip, TimelineProject, TimelineViewport } from './types';

type TimeRange = Pick<TimelineClip, 'start' | 'duration'>;

export interface SnapCandidate {
  start: number;
  guideTime: number;
}

export function timeToX(time: number, viewport: TimelineViewport): number {
  return (time - viewport.scrollTime) * viewport.pixelsPerSecond;
}

export function xToTime(x: number, viewport: TimelineViewport): number {
  return viewport.scrollTime + x / viewport.pixelsPerSecond;
}

export function zoomAroundPlayhead(
  viewport: TimelineViewport,
  pixelsPerSecond: number,
  playheadTime: number,
): TimelineViewport {
  const anchorX = timeToX(playheadTime, viewport);
  return {
    pixelsPerSecond,
    scrollTime: Math.max(0, playheadTime - anchorX / pixelsPerSecond),
  };
}

export function getProjectDuration(project: TimelineProject): number {
  return Object.values(project.clips).reduce(
    (duration, clip) => Math.max(duration, clip.start + clip.duration),
    0,
  );
}

export function clipsOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.start + b.duration && b.start < a.start + a.duration;
}

export function canPlaceClip(
  project: TimelineProject,
  candidate: TimelineClip,
  ignoreClipId: string = candidate.id,
): boolean {
  return !Object.values(project.clips).some(
    (clip) =>
      clip.id !== ignoreClipId &&
      clip.trackId === candidate.trackId &&
      clipsOverlap(clip, candidate),
  );
}

export function findNearestGap(
  clips: readonly TimeRange[],
  requestedStart: number,
  duration: number,
): number {
  let candidate = Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0;
  const requiredDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const ranges = clips
    .filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.duration) && clip.duration > 0)
    .map((clip) => ({ start: clip.start, end: clip.start + clip.duration }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  for (const range of ranges) {
    if (range.end <= candidate) continue;
    if (range.start >= candidate + requiredDuration) return candidate;
    candidate = Math.max(candidate, range.end);
  }

  return candidate;
}

export function snapTime(
  time: number,
  targets: number[],
  pixelsPerSecond: number,
  thresholdPx = 8,
): number {
  const threshold = thresholdPx / pixelsPerSecond;
  let closest = time;
  let distance = threshold + Number.EPSILON;

  for (const target of targets) {
    const candidateDistance = Math.abs(target - time);
    if (candidateDistance <= threshold && candidateDistance < distance) {
      closest = target;
      distance = candidateDistance;
    }
  }

  return closest;
}

export function snapClipMove(
  start: number,
  duration: number,
  targets: number[],
  pixelsPerSecond: number,
  thresholdPx = 8,
  preferredTargets?: ReadonlySet<number>,
): SnapCandidate | null {
  const candidates: Array<SnapCandidate & { pixelDistance: number; preferred: boolean }> = [];

  for (const guideTime of targets) {
    for (const edgeTime of [start, start + duration]) {
      const offset = guideTime - edgeTime;
      const candidateStart = start + offset;
      const zeroTolerance = Number.EPSILON * Math.max(1, Math.abs(start), Math.abs(duration), Math.abs(guideTime)) * 8;
      const normalizedStart = Math.abs(candidateStart) <= zeroTolerance ? 0 : candidateStart;
      const pixelDistance = Math.abs(offset * pixelsPerSecond);

      if (pixelDistance <= thresholdPx && normalizedStart >= 0) {
        candidates.push({
          start: normalizedStart,
          guideTime,
          pixelDistance,
          preferred: preferredTargets?.has(guideTime) ?? false,
        });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      a.pixelDistance - b.pixelDistance ||
      Number(b.preferred) - Number(a.preferred) ||
      a.guideTime - b.guideTime ||
      a.start - b.start,
  );

  const candidate = candidates[0];
  return candidate
    ? { start: candidate.start, guideTime: candidate.guideTime }
    : null;
}

export function getRulerStep(pixelsPerSecond: number): number {
  const candidates = [1 / 24, 1, 5, 10, 30, 60, 300];
  return candidates.find((step) => step * pixelsPerSecond >= 56) ?? candidates.at(-1)!;
}

export function getTimelineContentWidth(
  projectDuration: number,
  pixelsPerSecond: number,
  viewportWidth: number,
  labelWidth = 52,
  endPadding = 120,
  minimumScrollRunway = 320,
): number {
  return Math.max(viewportWidth + minimumScrollRunway, labelWidth + projectDuration * pixelsPerSecond + endPadding);
}

export function clampTimelineScrollTime(
  scrollTime: number,
  pixelsPerSecond: number,
  contentWidth: number,
  viewportWidth: number,
): number {
  const maxScrollTime = Math.max(0, (contentWidth - viewportWidth) / pixelsPerSecond);
  return Math.min(Math.max(0, scrollTime), maxScrollTime);
}

export function getVisibleRulerMarks(
  scrollTime: number,
  viewportWidth: number,
  pixelsPerSecond: number,
): number[] {
  const step = getRulerStep(pixelsPerSecond);
  const start = Math.max(0, Math.floor(scrollTime / step) - 1);
  const end = Math.ceil((scrollTime + viewportWidth / pixelsPerSecond) / step) + 1;
  const marks: number[] = [];

  for (let mark = start; mark <= end; mark += 1) {
    marks.push(mark * step);
  }

  return marks;
}
