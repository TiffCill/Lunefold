import { describe, expect, it } from 'vitest';
import { FPS, MIN_CLIP_DURATION } from './types';
import { createDemoProject } from './fixtures';

describe('canonical timeline model', () => {
  it('stores source metadata separately from timeline placement', () => {
    const project = createDemoProject();
    expect(project.fps).toBe(24);
    expect(MIN_CLIP_DURATION).toBe(1 / FPS);
    expect(project.clips['clip-garden']).toEqual(expect.objectContaining({
      assetId: 'garden', trackId: 'video-1', start: 0, duration: 12, sourceIn: 0,
    }));
    expect(project.assets.garden).toEqual(expect.objectContaining({
      kind: 'video', sourceDuration: expect.any(Number), availability: 'online',
    }));
    expect('versionId' in project.clips['clip-garden']).toBe(false);
  });
});
