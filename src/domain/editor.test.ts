import { describe, expect, test } from 'vitest';
import { applyCommand, createDemoState, createEmptyState, getTrackDeletionInfo, redo, undo } from './editor';

describe('editor domain', () => {
  test('creates a blank project with empty starter tracks and no demo media', () => {
    const state = createEmptyState();
    expect(state.assets).toEqual({});
    expect(state.clips).toEqual({});
    expect(Object.values(state.tracks).map((track) => [track.name, track.kind])).toEqual([['V1', 'visual'], ['A1', 'audio']]);
    expect(state.selectedAssetId).toBeNull();
    expect(state.selectedClipId).toBeNull();
  });

  test('uses canonical assets and clips without version fields', () => {
    const state = createDemoState();
    expect(state.assets.garden.kind).toBe('video');
    expect(state.clips['clip-garden']).toMatchObject({ assetId: 'garden', sourceIn: 0 });
    expect('versionId' in state.clips['clip-garden']).toBe(false);
  });

  test('moves a clip with undo and redo', () => {
    const moved = applyCommand(createDemoState(), { type: 'move-clip', clipId: 'clip-portrait', start: 7 });
    expect(moved.clips['clip-portrait'].start).toBe(7);
    expect(undo(moved).clips['clip-portrait'].start).toBe(4);
    expect(redo(undo(moved)).clips['clip-portrait'].start).toBe(7);
  });

  test('stores one validated resize as one undoable history entry', () => {
    const resized = applyCommand(createDemoState(), {
      type: 'timeline',
      command: { type: 'resizeClipStart', clipId: 'clip-garden', start: 2 },
    });
    expect(resized.clips['clip-garden']).toMatchObject({ start: 2, duration: 10, sourceIn: 2 });
    expect(resized.past).toHaveLength(1);
    expect(undo(resized).clips['clip-garden']).toMatchObject({ start: 0, duration: 12, sourceIn: 0 });
  });

  test('does not add history for an invalid edit', () => {
    const state = createDemoState();
    const rejected = applyCommand(state, {
      type: 'timeline',
      command: { type: 'moveClip', clipId: 'clip-garden', trackId: 'video-1', start: 15 },
    });
    expect(rejected).toBe(state);
  });

  test('adds monotonically named visual and audio tracks', () => {
    const visual = applyCommand(createDemoState(), { type: 'add-track', kind: 'visual' });
    const audio = applyCommand(visual, { type: 'add-track', kind: 'audio' });
    expect(audio.tracks['visual-3'].name).toBe('V3');
    expect(audio.tracks['audio-2'].name).toBe('A2');
  });

  test('requires confirmation before deleting a populated track', () => {
    const state = createDemoState();
    expect(getTrackDeletionInfo(state, 'video-1')).toEqual({ requiresConfirmation: true, clipCount: 2 });
    expect(applyCommand(state, { type: 'delete-track', trackId: 'video-1' })).toBe(state);
    const deleted = applyCommand(state, { type: 'delete-track', trackId: 'video-1', confirmed: true });
    expect(deleted.tracks['video-1']).toBeUndefined();
    expect(deleted.clips['clip-garden']).toBeUndefined();
  });

  test('inserts an image at an empty playhead gap and makes it the selected clip', () => {
    const state = applyCommand(createDemoState(), { type: 'select-clip', clipId: 'clip-portrait' });
    const inserted = applyCommand(state, {
      type: 'insert-asset-at-playhead', assetId: 'portrait', playheadTime: 12,
    });
    const clip = inserted.clips[inserted.selectedClipId!];

    expect(clip).toMatchObject({ assetId: 'portrait', trackId: 'video-2', start: 12, duration: 5, sourceIn: 0 });
    expect(inserted.past).toHaveLength(2);
  });

  test('places a video into the first following gap on the selected compatible track', () => {
    const state = applyCommand(createDemoState(), { type: 'select-clip', clipId: 'clip-garden' });
    const inserted = applyCommand(state, {
      type: 'insert-asset-at-playhead', assetId: 'garden', playheadTime: 3,
    });
    const clip = inserted.clips[inserted.selectedClipId!];

    expect(clip).toMatchObject({ assetId: 'garden', trackId: 'video-1', start: 22, duration: 12 });
    expect(undo(inserted).selectedClipId).toBe('clip-garden');
  });

  test('uses the first compatible track by display order when selected track is incompatible', () => {
    const inserted = applyCommand(createDemoState(), {
      type: 'insert-asset-at-playhead', assetId: 'music', playheadTime: 30,
    });
    const clip = inserted.clips[inserted.selectedClipId!];

    expect(clip).toMatchObject({ assetId: 'music', trackId: 'audio-1', start: 30, duration: 28 });
  });

  test('uses the topmost compatible visual track when the selected clip is audio', () => {
    const state = applyCommand(createDemoState(), { type: 'select-clip', clipId: 'clip-music' });
    const inserted = applyCommand(state, {
      type: 'insert-asset-at-playhead', assetId: 'portrait', playheadTime: 12,
    });

    expect(inserted.clips[inserted.selectedClipId!]).toMatchObject({
      assetId: 'portrait', trackId: 'video-2', start: 12, duration: 5,
    });
  });

  test('creates a compatible track when the project has none', () => {
    const state = createDemoState();
    state.tracks = {};
    state.clips = {};
    state.selectedClipId = null;
    const inserted = applyCommand(state, {
      type: 'insert-asset-at-playhead', assetId: 'music', playheadTime: 2,
    });
    const clip = inserted.clips[inserted.selectedClipId!];

    expect(inserted.tracks['audio-2']).toMatchObject({ name: 'A2', kind: 'audio', order: 2 });
    expect(clip).toMatchObject({ trackId: 'audio-2', start: 2, duration: 28 });
    expect(inserted.nextTrackNumbers.audio).toBe(3);
  });

  test('uses a safe five-second fallback when a non-image source duration is invalid', () => {
    const state = createDemoState();
    state.assets.garden = { ...state.assets.garden, sourceDuration: 0 };
    const inserted = applyCommand(state, {
      type: 'insert-asset-at-playhead', assetId: 'garden', playheadTime: 22,
    });

    expect(inserted.clips[inserted.selectedClipId!].duration).toBe(5);
  });

  test('rejects an unknown asset without creating history', () => {
    const state = createDemoState();

    expect(() => applyCommand(state, {
      type: 'insert-asset-at-playhead', assetId: 'missing', playheadTime: 0,
    })).toThrow('Unknown asset missing');
    expect(state.past).toHaveLength(0);
  });

  test('inserts a dropped asset into the preferred compatible track at its first following gap', () => {
    const state = applyCommand(createDemoState(), { type: 'select-clip', clipId: 'clip-portrait' });
    const inserted = applyCommand(state, {
      type: 'insert-asset-at-playhead',
      assetId: 'portrait',
      playheadTime: 3,
      preferredTrackId: 'video-1',
    });

    expect(inserted.clips[inserted.selectedClipId!]).toMatchObject({
      assetId: 'portrait', trackId: 'video-1', start: 22, duration: 5,
    });
    expect(inserted.past).toHaveLength(2);
  });

  test.each([
    ['missing track', 'missing-track'],
    ['incompatible track', 'audio-1'],
    ['locked track', 'video-2'],
  ])('safely falls back when the preferred %s cannot accept the asset', (_label, preferredTrackId) => {
    const state = createDemoState();
    if (preferredTrackId === 'video-2') {
      state.tracks['video-2'] = { ...state.tracks['video-2'], locked: true };
    }
    const inserted = applyCommand(state, {
      type: 'insert-asset-at-playhead',
      assetId: 'portrait',
      playheadTime: 22,
      preferredTrackId,
    });

    expect(inserted.clips[inserted.selectedClipId!]).toMatchObject({ trackId: 'video-1', start: 22 });
  });
});
