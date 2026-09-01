import { describe, expect, it } from 'vitest';

import { createDemoProject } from './fixtures';
import { applyTimelineCommand } from './commands';

describe('timeline commands', () => {
  it('inserts a compatible non-overlapping clip', () => {
    const result = applyTimelineCommand(createDemoProject(), {
      type: 'insertClip',
      clip: { id: 'new', assetId: 'portrait', trackId: 'video-1', start: 22, duration: 5, sourceIn: 0 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.clips.new.start).toBe(22);
  });

  it('rejects collisions and wrong track types without mutation', () => {
    const project = createDemoProject();
    expect(applyTimelineCommand(project, {
      type: 'moveClip', clipId: 'clip-garden', trackId: 'video-1', start: 15,
    })).toEqual({ ok: false, reason: 'overlap' });
    expect(applyTimelineCommand(project, {
      type: 'moveClip', clipId: 'clip-music', trackId: 'video-2', start: 12,
    })).toEqual({ ok: false, reason: 'wrong-track-type' });
  });

  it('moves visual clips between visual tracks', () => {
    const result = applyTimelineCommand(createDemoProject(), {
      type: 'moveClip', clipId: 'clip-garden', trackId: 'video-2', start: 28,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.clips['clip-garden']).toMatchObject({ trackId: 'video-2', start: 28 });
  });

  it('resizes the start while preserving the end and source mapping', () => {
    const result = applyTimelineCommand(createDemoProject(), {
      type: 'resizeClipStart', clipId: 'clip-garden', start: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.clips['clip-garden']).toMatchObject({ start: 2, duration: 10, sourceIn: 2 });
  });

  it('allows extending the end beyond source duration and rejects invalid starts', () => {
    const extended = applyTimelineCommand(createDemoProject(), {
      type: 'resizeClipEnd', clipId: 'clip-garden', end: 13,
    });
    expect(extended.ok).toBe(true);
    if (extended.ok) expect(extended.project.clips['clip-garden'].duration).toBe(13);

    expect(applyTimelineCommand(createDemoProject(), {
      type: 'resizeClipStart', clipId: 'clip-garden-copy', start: 13,
    })).toEqual({ ok: false, reason: 'source-before-zero' });
  });

  it('rejects edits on locked tracks and deletes clips', () => {
    const project = createDemoProject();
    project.tracks['video-1'] = { ...project.tracks['video-1'], locked: true };
    expect(applyTimelineCommand(project, {
      type: 'moveClip', clipId: 'clip-garden', trackId: 'video-1', start: 1,
    })).toEqual({ ok: false, reason: 'locked-track' });

    const deleted = applyTimelineCommand(createDemoProject(), { type: 'deleteClip', clipId: 'clip-garden' });
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.project.clips['clip-garden']).toBeUndefined();
  });
});
