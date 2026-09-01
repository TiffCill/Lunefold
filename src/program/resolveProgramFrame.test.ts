import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../timeline/fixtures';
import { resolveProgramState } from './resolveProgramFrame';

describe('resolveProgramState', () => {
  it('resolves visual hierarchy, lower-track reveal, gaps, and duration', () => {
    const project = createDemoProject();
    expect(resolveProgramState(project, 5).visual?.clipId).toBe('clip-portrait');
    expect(resolveProgramState(project, 12.5).visual).toBeNull();
    expect(resolveProgramState(project, 15).visual?.clipId).toBe('clip-garden-copy');
    expect(resolveProgramState(project, 19).visual?.clipId).toBe('clip-waves');
    expect(resolveProgramState(project, 30).duration).toBe(28);
  });

  it('collects unmuted active audio independently', () => {
    const project = createDemoProject();
    expect(resolveProgramState(project, 2).audio.map((item) => item.clipId)).toEqual(['clip-music']);
    project.tracks['audio-1'] = { ...project.tracks['audio-1'], muted: true };
    expect(resolveProgramState(project, 2).audio).toEqual([]);
  });

  it('uses zero render time for images and preserves offline assets', () => {
    const project = createDemoProject();
    project.assets.portrait = { ...project.assets.portrait, availability: 'offline' };
    const visual = resolveProgramState(project, 5).visual!;
    expect(visual.sourceTime).toBe(1);
    expect(visual.renderTime).toBe(0);
    expect(visual.asset.availability).toBe('offline');
  });

  it('holds an extended video on its final decodable frame', () => {
    const project = createDemoProject();
    project.assets.garden = { ...project.assets.garden, sourceDuration: 4 };
    const visual = resolveProgramState(project, 11).visual!;
    expect(visual.sourceTime).toBe(11);
    expect(visual.renderTime).toBeCloseTo(3 + 23 / 24);
    expect(visual.isHeldFrame).toBe(true);
  });
});
