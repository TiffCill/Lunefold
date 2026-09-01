import { describe, expect, test } from 'vitest';
import { nearestSnap, projectMomentum, rubberband } from './physics';

describe('direct manipulation physics', () => {
  test('projects the landing point from release velocity', () => {
    expect(projectMomentum(1000, 0.99)).toBeCloseTo(99, 5);
  });

  test('applies progressively stronger resistance beyond a boundary', () => {
    expect(rubberband(100, 500)).toBeCloseTo(49.5495, 4);
    expect(rubberband(300, 500)).toBeLessThan(150);
  });

  test('snaps to the nearest timeline interval', () => {
    expect(nearestSnap(53, 18)).toBe(54);
    expect(nearestSnap(61, 18)).toBe(54);
  });
});
