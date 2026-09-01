import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackState } from '../playback/playback';

export function useProgramClock(duration: number) {
  const frame = useRef<number | null>(null);
  const lastTime = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(duration);
  const statusRef = useRef<PlaybackState['status']>('paused');
  const [state, setState] = useState<PlaybackState>({ status: 'paused', currentTime: 0, duration, selectedMediaId: 'timeline-program', seekRevision: 0 });

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastTime.current = null;
  }, []);

  const tick = useCallback((now: number) => {
    const delta = lastTime.current === null ? 0 : (now - lastTime.current) / 1000;
    lastTime.current = now;
    const currentTime = Math.min(durationRef.current, currentTimeRef.current + delta);
    currentTimeRef.current = currentTime;
    if (currentTime >= durationRef.current) {
      statusRef.current = 'ended';
      stop();
      setState((current) => ({ ...current, currentTime, status: 'ended' }));
      return;
    }
    setState((current) => ({ ...current, currentTime }));
    frame.current = requestAnimationFrame(tick);
  }, [stop]);

  useEffect(() => {
    durationRef.current = duration;
    currentTimeRef.current = Math.min(currentTimeRef.current, duration);
    setState((current) => ({ ...current, duration, currentTime: currentTimeRef.current }));
  }, [duration]);
  useEffect(() => stop, [stop]);

  const seek = useCallback((time: number) => {
    currentTimeRef.current = Math.min(durationRef.current, Math.max(0, time));
    if (statusRef.current === 'ended') statusRef.current = 'paused';
    setState((current) => ({ ...current, currentTime: currentTimeRef.current, status: statusRef.current, seekRevision: (current.seekRevision ?? 0) + 1 }));
  }, []);
  const stepFrame = useCallback((direction: -1 | 1) => seek(currentTimeRef.current + direction / 24), [seek]);
  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') {
      stop();
      statusRef.current = 'paused';
      setState((current) => ({ ...current, status: 'paused' }));
      return;
    }
    if (durationRef.current <= 0) return;
    if (statusRef.current === 'ended') currentTimeRef.current = 0;
    statusRef.current = 'playing';
    lastTime.current = null;
    frame.current = requestAnimationFrame(tick);
    setState((current) => ({ ...current, currentTime: currentTimeRef.current, status: 'playing' }));
  }, [stop, tick]);

  return { state, seek, scrub: seek, stepFrame, toggle };
}
