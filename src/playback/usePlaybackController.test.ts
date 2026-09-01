import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlaybackController } from './usePlaybackController';

function fakeMedia() {
  return {
    currentTime: 0,
    duration: 20,
    paused: true,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  } as unknown as HTMLMediaElement;
}

describe('usePlaybackController', () => {
  it('loads duration and seeks the attached media element', () => {
    const { result } = renderHook(() => usePlaybackController('demo'));
    const media = fakeMedia();
    act(() => result.current.mediaRef(media));
    act(() => result.current.mediaEvents.onLoadedMetadata());
    expect(result.current.state.duration).toBe(20);
    act(() => result.current.seek(8));
    expect(media.currentTime).toBe(8);
    expect(result.current.state.currentTime).toBe(8);
  });

  it('delegates play and pause to the media element', async () => {
    const { result } = renderHook(() => usePlaybackController('demo'));
    const media = fakeMedia();
    act(() => result.current.mediaRef(media));
    await act(() => result.current.toggle());
    expect(media.play).toHaveBeenCalledOnce();
    Object.defineProperty(media, 'paused', { value: false, configurable: true });
    act(() => result.current.toggle());
    expect(media.pause).toHaveBeenCalledOnce();
  });
});
