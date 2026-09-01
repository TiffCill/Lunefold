export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  selectedMediaId: string | null;
  seekRevision?: number;
}

export function clampSeekTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(0, duration), Math.max(0, time));
}

export function seekFrame(time: number, direction: -1 | 1, fps = 24): number {
  return Math.max(0, time + direction / fps);
}

export function formatTime(time: number, fps = 24): string {
  const safe = Math.max(0, Number.isFinite(time) ? time : 0);
  const wholeSeconds = Math.floor(safe);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  const frames = Math.min(fps - 1, Math.floor((safe - wholeSeconds) * fps));
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, '0')).join(':');
}
