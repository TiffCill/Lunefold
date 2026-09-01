import { canPlaceClip } from './geometry';
import { MIN_CLIP_DURATION } from './types';
import type { TimelineClip, TimelineProject } from './types';

export type TimelineCommand =
  | { type: 'insertClip'; clip: TimelineClip }
  | { type: 'moveClip'; clipId: string; trackId: string; start: number }
  | { type: 'resizeClipStart'; clipId: string; start: number }
  | { type: 'resizeClipEnd'; clipId: string; end: number }
  | { type: 'deleteClip'; clipId: string };

export type TimelineCommandFailure =
  | 'overlap'
  | 'wrong-track-type'
  | 'source-before-zero'
  | 'too-short'
  | 'locked-track';

export type TimelineCommandResult =
  | { ok: true; project: TimelineProject }
  | { ok: false; reason: TimelineCommandFailure };

function failure(reason: TimelineCommandFailure): TimelineCommandResult {
  return { ok: false, reason };
}

function replaceClip(project: TimelineProject, clip: TimelineClip): TimelineCommandResult {
  const track = project.tracks[clip.trackId];
  const asset = project.assets[clip.assetId];
  if (!track || !asset) return failure('wrong-track-type');
  if (track.locked) return failure('locked-track');
  if ((track.kind === 'audio') !== (asset.kind === 'audio')) return failure('wrong-track-type');
  if (clip.start < 0 || clip.sourceIn < 0) return failure('source-before-zero');
  if (clip.duration < MIN_CLIP_DURATION) return failure('too-short');
  if (!canPlaceClip(project, clip)) return failure('overlap');
  return { ok: true, project: { ...project, clips: { ...project.clips, [clip.id]: clip } } };
}

export function applyTimelineCommand(
  project: TimelineProject,
  command: TimelineCommand,
): TimelineCommandResult {
  if (command.type === 'insertClip') return replaceClip(project, command.clip);

  const clip = project.clips[command.clipId];
  if (!clip) return failure('wrong-track-type');
  const currentTrack = project.tracks[clip.trackId];
  if (currentTrack?.locked) return failure('locked-track');

  switch (command.type) {
    case 'moveClip':
      return replaceClip(project, { ...clip, trackId: command.trackId, start: command.start });
    case 'resizeClipStart': {
      const delta = command.start - clip.start;
      return replaceClip(project, {
        ...clip,
        start: command.start,
        duration: clip.duration - delta,
        sourceIn: clip.sourceIn + delta,
      });
    }
    case 'resizeClipEnd':
      return replaceClip(project, { ...clip, duration: command.end - clip.start });
    case 'deleteClip': {
      const clips = { ...project.clips };
      delete clips[clip.id];
      return {
        ok: true,
        project: {
          ...project,
          clips,
          selectedClipId: project.selectedClipId === clip.id ? Object.keys(clips)[0] ?? null : project.selectedClipId,
        },
      };
    }
  }
}
