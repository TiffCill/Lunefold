import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../playback/playback';
import { ZoomableImage } from './ZoomableImage';

export interface PreviewAsset {
  id: string;
  name: string;
  kind: 'image' | 'video';
  src: string;
  duration?: number;
}

interface AssetPreviewProps {
  asset: PreviewAsset;
}

export function AssetPreview({ asset }: AssetPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoState, setVideoState] = useState({ currentTime: 0, duration: asset.duration ?? 0, playing: false });
  useEffect(() => () => videoRef.current?.pause(), [asset.id]);
  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    if (videoState.playing) {
      video.pause();
      setVideoState((current) => ({ ...current, playing: false }));
    } else {
      void video.play().then(() => setVideoState((current) => ({ ...current, playing: true }))).catch(() => undefined);
    }
  };
  if (asset.kind === 'image') return <ZoomableImage key={asset.id} className="asset-preview-image" src={asset.src} alt={`${asset.name}素材预览`} controlsLabel="素材预览控制" toolbarLabel={asset.name} />;
  return <>
    <div className="preview-canvas asset-preview-canvas"><video ref={videoRef} src={asset.src} aria-label={`${asset.name}素材视频`} className="preview-media" playsInline preload="metadata" onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; setVideoState((current) => ({ ...current, duration })); }} onTimeUpdate={(event) => { const currentTime = event.currentTarget.currentTime; setVideoState((current) => ({ ...current, currentTime })); }} onEnded={() => setVideoState((current) => ({ ...current, playing: false }))} /></div>
    <input className="playback-progress" aria-label="素材播放进度" type="range" min="0" max={videoState.duration} step="0.01" value={Math.min(videoState.currentTime, videoState.duration)} disabled={videoState.duration <= 0} onChange={(event) => { const currentTime = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = currentTime; setVideoState((current) => ({ ...current, currentTime })); }} />
    <div className="playback-bar asset-preview-toolbar" role="toolbar" aria-label="素材预览控制">
      <span className="asset-preview-filename" title={asset.name}>{asset.name}</span>
      <div className="playback-transport"><button type="button" aria-label={videoState.playing ? '暂停素材' : '播放素材'} disabled={videoState.duration <= 0} onClick={toggleVideo}>{videoState.playing ? '❚❚' : '▶'}</button></div>
      <span className="asset-preview-time">{formatTime(videoState.currentTime)} / {formatTime(videoState.duration)}</span>
    </div>
  </>;
}
