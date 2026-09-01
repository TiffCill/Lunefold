import { afterEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  clampWorkspaceLayout,
  loadWorkspaceLayout,
  saveWorkspaceLayout,
} from './workspaceLayout';

const originalViewport = { width: window.innerWidth, height: window.innerHeight };

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

afterEach(() => {
  localStorage.clear();
  setViewport(originalViewport.width, originalViewport.height);
});

describe('workspace layout', () => {
  test('keeps each panel and the timeline inside its supported range', () => {
    expect(clampWorkspaceLayout(
      { assetWidth: 90, assistantWidth: 900, timelineHeight: 900 },
      { width: 1440, height: 900 },
    )).toEqual({ assetWidth: 180, assistantWidth: 560, timelineHeight: 468 });
  });

  test('reserves at least 360 pixels for the preview when side panels compete', () => {
    expect(clampWorkspaceLayout(
      { assetWidth: 420, assistantWidth: 560, timelineHeight: 320 },
      { width: 1_000, height: 900 },
    )).toEqual({ assetWidth: 360, assistantWidth: 280, timelineHeight: 320 });
  });

  test('restores a saved layout only after clamping it to the current viewport', () => {
    setViewport(1_000, 900);
    localStorage.setItem('lumina.workspace-layout', JSON.stringify({
      assetWidth: 420,
      assistantWidth: 560,
      timelineHeight: 900,
    }));

    expect(loadWorkspaceLayout()).toEqual({ assetWidth: 360, assistantWidth: 280, timelineHeight: 468 });
  });

  test('falls back to the default layout when saved data is malformed', () => {
    localStorage.setItem('lumina.workspace-layout', '{not valid JSON');

    expect(loadWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });

  test('persists the layout unchanged for restoration after a drag commits', () => {
    const layout = { assetWidth: 240, assistantWidth: 420, timelineHeight: 300 };

    saveWorkspaceLayout(layout);

    expect(JSON.parse(localStorage.getItem('lumina.workspace-layout') ?? '')).toEqual(layout);
  });
});
