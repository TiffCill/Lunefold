import { getProjectDuration } from '../timeline/geometry';
import type { MediaAsset, TimelineClip, TimelineProject } from '../timeline/types';

export interface ProgramItem {
  clipId: string;
  asset: MediaAsset;
  sourceTime: number;
  renderTime: number;
  isHeldFrame: boolean;
}

export interface ProgramState {
  time: number;
  duration: number;
  visual: ProgramItem | null;
  audio: ProgramItem[];
}

function activeAt(clip: TimelineClip, time: number): boolean {
  return clip.start <= time && time < clip.start + clip.duration;
}

function resolveItem(project: TimelineProject, clip: TimelineClip, time: number): ProgramItem {
  const asset = project.assets[clip.assetId];
  const sourceTime = clip.sourceIn + time - clip.start;
  if (asset.kind === 'image') {
    return { clipId: clip.id, asset, sourceTime, renderTime: 0, isHeldFrame: false };
  }
  const finalFrame = asset.sourceDuration === null
    ? sourceTime
    : Math.max(0, asset.sourceDuration - 1 / project.fps);
  return {
    clipId: clip.id,
    asset,
    sourceTime,
    renderTime: Math.min(sourceTime, finalFrame),
    isHeldFrame: asset.sourceDuration !== null && sourceTime >= asset.sourceDuration,
  };
}

export function resolveProgramState(project: TimelineProject, time: number): ProgramState {
  const active = Object.values(project.clips).filter((clip) => activeAt(clip, time));
  const visualClip = active
    .filter((clip) => project.tracks[clip.trackId]?.kind === 'visual' && project.assets[clip.assetId]?.kind !== 'audio')
    .sort((a, b) => project.tracks[b.trackId].order - project.tracks[a.trackId].order)[0];
  const audio = active
    .filter((clip) => project.tracks[clip.trackId]?.kind === 'audio' && !project.tracks[clip.trackId].muted && project.assets[clip.assetId]?.kind === 'audio')
    .map((clip) => resolveItem(project, clip, time));
  return {
    time,
    duration: getProjectDuration(project),
    visual: visualClip ? resolveItem(project, visualClip, time) : null,
    audio,
  };
}

export const resolveProgramFrame = resolveProgramState;
export const getProgramDuration = getProjectDuration;
