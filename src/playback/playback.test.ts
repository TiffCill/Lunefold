import { describe, expect, it } from 'vitest';
import { clampSeekTime, formatTime, seekFrame } from './playback';

describe('playback utilities', () => {
  it('formats media time as hours, minutes, seconds, and frames', () => {
    expect(formatTime(74.25, 24)).toBe('00:01:14:06');
  });

  it('steps exactly one frame in either direction', () => {
    expect(seekFrame(1, 1, 24)).toBeCloseTo(1 + 1 / 24);
    expect(seekFrame(1, -1, 24)).toBeCloseTo(1 - 1 / 24);
  });

  it('keeps seeking inside media bounds', () => {
    expect(clampSeekTime(-3, 20)).toBe(0);
    expect(clampSeekTime(30, 20)).toBe(20);
    expect(clampSeekTime(8, 20)).toBe(8);
  });
});
