import { createElement, StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProgramClock } from './useProgramClock';

describe('useProgramClock', () => {
  it('seeks and steps within the program duration', () => {
    const { result } = renderHook(() => useProgramClock(20));
    act(() => result.current.seek(30));
    expect(result.current.state.currentTime).toBe(20);
    act(() => result.current.stepFrame(-1));
    expect(result.current.state.currentTime).toBeCloseTo(20 - 1 / 24);
  });

  it('associates scrubbing directly with the timeline time', () => {
    const { result } = renderHook(() => useProgramClock(20));
    act(() => {
      result.current.scrub(2);
      result.current.scrub(7);
      result.current.scrub(11);
    });
    expect(result.current.state.currentTime).toBe(11);
  });

  it('keeps exactly one animation-frame chain in Strict Mode', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const wrapper = ({ children }: PropsWithChildren) => createElement(StrictMode, null, children);
    const { result, unmount } = renderHook(() => useProgramClock(20), { wrapper });
    act(() => result.current.toggle());
    expect(callbacks).toHaveLength(1);
    const first = callbacks.shift()!;
    act(() => first(16));
    expect(callbacks).toHaveLength(1);
    unmount();
    vi.unstubAllGlobals();
  });
});
