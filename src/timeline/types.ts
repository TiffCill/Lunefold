export const FPS = 24 as const;
export const MIN_CLIP_DURATION = 1 / FPS;

export type MediaKind = 'video' | 'image' | 'audio';
export type TrackKind = 'visual' | 'audio';

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  src: string;
  sourceDuration: number | null;
  availability: 'online' | 'offline';
}

export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  start: number;
  duration: number;
  sourceIn: number;
}

export interface TimelineTrack {
  id: string;
  name: string;
  kind: TrackKind;
  order: number;
  muted: boolean;
  locked: boolean;
}

export interface TimelineProject {
  fps: typeof FPS;
  assets: Record<string, MediaAsset>;
  clips: Record<string, TimelineClip>;
  tracks: Record<string, TimelineTrack>;
  selectedAssetId: string | null;
  selectedClipId: string | null;
}

export interface TimelineViewport {
  pixelsPerSecond: number;
  scrollTime: number;
}
