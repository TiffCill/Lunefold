import { createDemoProject } from '../timeline/fixtures';
import { applyTimelineCommand, type TimelineCommand } from '../timeline/commands';
import { findNearestGap } from '../timeline/geometry';
import { FPS, MIN_CLIP_DURATION, type MediaAsset, type TimelineClip, type TimelineProject, type TimelineTrack, type TrackKind } from '../timeline/types';

export type { MediaAsset, MediaKind, TimelineClip, TimelineProject, TimelineTrack, TrackKind } from '../timeline/types';

export interface ModelRef {
  id: string;
  name: string;
  provider: string;
  type: 'conversation' | 'generation';
}

interface EditorSnapshot extends TimelineProject {
  nextTrackNumbers: Record<TrackKind, number>;
  conversationModelId: string;
  generationModelId: string;
}

export interface EditorState extends EditorSnapshot {
  past: EditorSnapshot[];
  future: EditorSnapshot[];
}

export interface TrackDeletionInfo { requiresConfirmation: boolean; clipCount: number }

export type EditorCommand =
  | { type: 'select-asset'; assetId: string }
  | { type: 'select-clip'; clipId: string }
  | { type: 'set-conversation-model'; modelId: string }
  | { type: 'set-generation-model'; modelId: string }
  | { type: 'add-track'; kind: TrackKind }
  | { type: 'delete-track'; trackId: string; confirmed?: boolean }
  | { type: 'move-clip'; clipId: string; start: number; trackId?: string }
  | { type: 'insert-asset-at-playhead'; assetId: string; playheadTime: number; preferredTrackId?: string }
  | { type: 'timeline'; command: TimelineCommand };

function snapshot(state: EditorState): EditorSnapshot {
  const { past: _past, future: _future, ...value } = state;
  return value;
}

export function getTrackDeletionInfo(state: EditorState, trackId: string): TrackDeletionInfo {
  if (!state.tracks[trackId]) throw new Error(`Unknown track ${trackId}`);
  const clipCount = Object.values(state.clips).filter((clip) => clip.trackId === trackId).length;
  return { requiresConfirmation: clipCount > 0, clipCount };
}

function isCompatibleTrack(track: TimelineTrack | undefined, asset: MediaAsset): track is TimelineTrack {
  return Boolean(track && !track.locked && (track.kind === 'audio') === (asset.kind === 'audio'));
}

function getInsertionDuration(asset: MediaAsset): number {
  if (asset.kind === 'image') return 5;
  return typeof asset.sourceDuration === 'number'
    && Number.isFinite(asset.sourceDuration)
    && asset.sourceDuration >= MIN_CLIP_DURATION
    ? asset.sourceDuration
    : 5;
}

function nextClipId(state: EditorState, assetId: string): string {
  let number = 1;
  let id = `clip-${assetId}-${number}`;
  while (state.clips[id]) {
    number += 1;
    id = `clip-${assetId}-${number}`;
  }
  return id;
}

export function applyCommand(state: EditorState, command: EditorCommand): EditorState {
  let next: EditorSnapshot;
  switch (command.type) {
    case 'select-asset':
      if (!state.assets[command.assetId]) throw new Error(`Unknown asset ${command.assetId}`);
      next = { ...snapshot(state), selectedAssetId: command.assetId };
      break;
    case 'select-clip':
      if (!state.clips[command.clipId]) throw new Error(`Unknown clip ${command.clipId}`);
      next = { ...snapshot(state), selectedClipId: command.clipId };
      break;
    case 'set-conversation-model':
      next = { ...snapshot(state), conversationModelId: command.modelId };
      break;
    case 'set-generation-model':
      next = { ...snapshot(state), generationModelId: command.modelId };
      break;
    case 'add-track': {
      const number = state.nextTrackNumbers[command.kind];
      const id = `${command.kind}-${number}`;
      const track: TimelineTrack = { id, name: `${command.kind === 'visual' ? 'V' : 'A'}${number}`, kind: command.kind, order: number, muted: false, locked: false };
      next = { ...snapshot(state), tracks: { ...state.tracks, [id]: track }, nextTrackNumbers: { ...state.nextTrackNumbers, [command.kind]: number + 1 } };
      break;
    }
    case 'delete-track': {
      const info = getTrackDeletionInfo(state, command.trackId);
      if (info.requiresConfirmation && !command.confirmed) return state;
      const tracks = { ...state.tracks };
      delete tracks[command.trackId];
      const clips = Object.fromEntries(Object.entries(state.clips).filter(([, clip]) => clip.trackId !== command.trackId)) as Record<string, TimelineClip>;
      const selectedClipId = state.selectedClipId && clips[state.selectedClipId] ? state.selectedClipId : Object.keys(clips)[0] ?? null;
      next = { ...snapshot(state), tracks, clips, selectedClipId };
      break;
    }
    case 'move-clip': {
      const clip = state.clips[command.clipId];
      if (!clip) throw new Error(`Unknown clip ${command.clipId}`);
      const result = applyTimelineCommand(state, {
        type: 'moveClip',
        clipId: clip.id,
        start: command.start,
        trackId: command.trackId ?? clip.trackId,
      });
      if (!result.ok) return state;
      next = { ...snapshot(state), ...result.project };
      break;
    }
    case 'insert-asset-at-playhead': {
      const asset = state.assets[command.assetId];
      if (!asset) throw new Error(`Unknown asset ${command.assetId}`);

      const selectedTrack = state.selectedClipId
        ? state.tracks[state.clips[state.selectedClipId]?.trackId]
        : undefined;
      const preferredTrack = command.preferredTrackId
        ? state.tracks[command.preferredTrackId]
        : undefined;
      const firstCompatibleTrack = Object.values(state.tracks)
        .filter((track) => isCompatibleTrack(track, asset))
        .sort((a, b) => (asset.kind === 'audio' ? a.order - b.order : b.order - a.order) || a.id.localeCompare(b.id))[0];
      let track = isCompatibleTrack(preferredTrack, asset)
        ? preferredTrack
        : isCompatibleTrack(selectedTrack, asset)
          ? selectedTrack
          : firstCompatibleTrack;
      let tracks = state.tracks;
      let nextTrackNumbers = state.nextTrackNumbers;

      if (!track) {
        const kind: TrackKind = asset.kind === 'audio' ? 'audio' : 'visual';
        const number = state.nextTrackNumbers[kind];
        track = {
          id: `${kind}-${number}`,
          name: `${kind === 'visual' ? 'V' : 'A'}${number}`,
          kind,
          order: number,
          muted: false,
          locked: false,
        };
        tracks = { ...state.tracks, [track.id]: track };
        nextTrackNumbers = { ...state.nextTrackNumbers, [kind]: number + 1 };
      }

      const duration = getInsertionDuration(asset);
      const start = findNearestGap(
        Object.values(state.clips).filter((clip) => clip.trackId === track.id),
        command.playheadTime,
        duration,
      );
      const clip: TimelineClip = {
        id: nextClipId(state, asset.id),
        assetId: asset.id,
        trackId: track.id,
        start,
        duration,
        sourceIn: 0,
      };
      const result = applyTimelineCommand({ ...state, tracks }, { type: 'insertClip', clip });
      if (!result.ok) return state;
      next = {
        ...snapshot(state),
        ...result.project,
        nextTrackNumbers,
        selectedClipId: clip.id,
      };
      break;
    }
    case 'timeline': {
      const result = applyTimelineCommand(state, command.command);
      if (!result.ok) return state;
      next = { ...snapshot(state), ...result.project };
      break;
    }
  }
  return { ...next, past: [...state.past, snapshot(state)], future: [] };
}

export function undo(state: EditorState): EditorState {
  const previous = state.past.at(-1);
  return previous ? { ...previous, past: state.past.slice(0, -1), future: [snapshot(state), ...state.future] } : state;
}

export function redo(state: EditorState): EditorState {
  const next = state.future[0];
  return next ? { ...next, past: [...state.past, snapshot(state)], future: state.future.slice(1) } : state;
}

export const conversationModels: ModelRef[] = [
  { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'OpenAI', type: 'conversation' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', type: 'conversation' },
];

export const generationModels: ModelRef[] = [
  { id: 'sora-2-pro', name: 'Sora 2 Pro', provider: 'OpenAI', type: 'generation' },
  { id: 'gpt-image-2', name: 'GPT Image 2', provider: 'OpenAI', type: 'generation' },
  { id: 'sora-2', name: 'Sora 2', provider: 'OpenAI', type: 'generation' },
];

export function createEmptyState(): EditorState {
  return {
    fps: FPS,
    assets: {},
    clips: {},
    tracks: {
      'visual-1': { id: 'visual-1', name: 'V1', kind: 'visual', order: 1, muted: false, locked: false },
      'audio-1': { id: 'audio-1', name: 'A1', kind: 'audio', order: 1, muted: false, locked: false },
    },
    selectedAssetId: null,
    selectedClipId: null,
    nextTrackNumbers: { visual: 2, audio: 2 },
    conversationModelId: 'gpt-5.5',
    generationModelId: 'sora-2-pro',
    past: [],
    future: [],
  };
}

export function createDemoState(): EditorState {
  return {
    ...createDemoProject(),
    nextTrackNumbers: { visual: 3, audio: 2 },
    conversationModelId: 'gpt-5.5',
    generationModelId: 'sora-2-pro',
    past: [],
    future: [],
  };
}
