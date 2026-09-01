import { useCallback, useEffect, useRef, useState } from 'react';
import { clampSeekTime, seekFrame, type PlaybackState } from './playback';

export function usePlaybackController(selectedMediaId: string | null) {
  const element = useRef<HTMLMediaElement | null>(null);
  const frame = useRef<number | null>(null);
  const [state, setState] = useState<PlaybackState>({ status: 'idle', currentTime: 0, duration: 0, selectedMediaId });

  const stopSampling = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const sample = useCallback(() => {
    const media = element.current;
    if (!media || media.paused) { stopSampling(); return; }
    setState((current) => ({ ...current, currentTime: media.currentTime }));
    frame.current = requestAnimationFrame(sample);
  }, [stopSampling]);

  useEffect(() => {
    stopSampling();
    setState({ status: selectedMediaId ? 'loading' : 'idle', currentTime: 0, duration: 0, selectedMediaId });
  }, [selectedMediaId, stopSampling]);

  useEffect(() => stopSampling, [stopSampling]);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) stopSampling();
      else if (element.current && !element.current.paused) frame.current = requestAnimationFrame(sample);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [sample, stopSampling]);

  const mediaRef = useCallback((media: HTMLMediaElement | null) => { element.current = media; }, []);
  const seek = useCallback((time: number) => {
    const media = element.current;
    const duration = Number.isFinite(media?.duration) ? media!.duration : state.duration;
    const next = clampSeekTime(time, duration);
    if (media) media.currentTime = next;
    setState((current) => ({ ...current, currentTime: next }));
  }, [state.duration]);
  const step = useCallback((direction: -1 | 1) => seek(seekFrame(element.current?.currentTime ?? state.currentTime, direction)), [seek, state.currentTime]);
  const toggle = useCallback(async () => {
    const media = element.current;
    if (!media) return;
    if (media.paused) {
      try {
        await media.play();
      } catch {
        stopSampling();
        setState((current) => ({ ...current, status: 'error' }));
      }
    } else media.pause();
  }, [stopSampling]);

  const mediaEvents = {
    onLoadedMetadata: () => {
      const media = element.current;
      if (!media) return;
      setState((current) => ({ ...current, status: 'ready', duration: Number.isFinite(media.duration) ? media.duration : 0, currentTime: media.currentTime }));
    },
    onTimeUpdate: () => {
      const media = element.current;
      if (media) setState((current) => ({ ...current, currentTime: media.currentTime }));
    },
    onPlay: () => { setState((current) => ({ ...current, status: 'playing' })); stopSampling(); frame.current = requestAnimationFrame(sample); },
    onPause: () => { stopSampling(); setState((current) => ({ ...current, status: 'paused' })); },
    onEnded: () => { stopSampling(); setState((current) => ({ ...current, status: 'ended', currentTime: current.duration })); },
    onError: () => { stopSampling(); setState((current) => ({ ...current, status: 'error' })); },
  };

  return { state, mediaRef, mediaEvents, toggle, seek, stepFrame: step };
}
