import { FPS, type TimelineProject } from './types';

export function createDemoProject(): TimelineProject {
  return {
    fps: FPS,
    assets: {
      garden: { id: 'garden', name: '花园漫步', kind: 'video', src: '/demo/demo-video.mp4', sourceDuration: 12, availability: 'online' },
      portrait: { id: 'portrait', name: '人物剪影', kind: 'image', src: '/demo/portrait.svg', sourceDuration: null, availability: 'online' },
      waves: { id: 'waves', name: '液态光影', kind: 'image', src: '/demo/waves.svg', sourceDuration: null, availability: 'online' },
      music: { id: 'music', name: 'Midnight Drive', kind: 'audio', src: '', sourceDuration: 28, availability: 'online' },
    },
    clips: {
      'clip-garden': { id: 'clip-garden', assetId: 'garden', trackId: 'video-1', start: 0, duration: 12, sourceIn: 0 },
      'clip-garden-copy': { id: 'clip-garden-copy', assetId: 'garden', trackId: 'video-1', start: 14, duration: 8, sourceIn: 0 },
      'clip-portrait': { id: 'clip-portrait', assetId: 'portrait', trackId: 'video-2', start: 4, duration: 7, sourceIn: 0 },
      'clip-waves': { id: 'clip-waves', assetId: 'waves', trackId: 'video-2', start: 18, duration: 10, sourceIn: 0 },
      'clip-music': { id: 'clip-music', assetId: 'music', trackId: 'audio-1', start: 0, duration: 28, sourceIn: 0 },
    },
    tracks: {
      'video-2': { id: 'video-2', name: 'V2', kind: 'visual', order: 2, muted: false, locked: false },
      'video-1': { id: 'video-1', name: 'V1', kind: 'visual', order: 1, muted: false, locked: false },
      'audio-1': { id: 'audio-1', name: 'A1', kind: 'audio', order: 1, muted: false, locked: false },
    },
    selectedAssetId: 'garden',
    selectedClipId: 'clip-garden',
  };
}
