import { useEffect, useRef } from 'react';
import type { PlaybackState } from '../playback/playback';
import { formatTime } from '../playback/playback';
import type { ProgramState } from '../program/resolveProgramFrame';
import { AssetPreview, type PreviewAsset } from './AssetPreview';

interface PreviewProps {
  program: ProgramState;
  playback: PlaybackState;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onStepFrame: (direction: -1 | 1) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  asset?: PreviewAsset | null;
}

function VideoFrame({ program, playing }: { program: ProgramState; playing: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visual = program.visual!;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - visual.renderTime) > 1 / 24) video.currentTime = visual.renderTime;
    if (playing && !visual.isHeldFrame) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, visual.clipId, visual.isHeldFrame, visual.renderTime]);
  return <video ref={videoRef} src={visual.asset.src} aria-label={`${visual.asset.name}视频画面`} className="preview-media" playsInline muted />;
}

function AudioTrack({ item, playing, seekRevision }: { item: ProgramState['audio'][number]; playing: boolean; seekRevision?: number }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const initializedRef = useRef(false);
  const seekRevisionRef = useRef(seekRevision);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    const shouldSynchronize = !initializedRef.current || !playing || seekRevisionRef.current !== seekRevision;
    initializedRef.current = true;
    seekRevisionRef.current = seekRevision;
    if (shouldSynchronize && Math.abs(audio.currentTime - item.renderTime) > 1 / 24) audio.currentTime = item.renderTime;
  }, [item.clipId, item.renderTime, playing, seekRevision]);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (playing && !item.isHeldFrame) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [item.clipId, item.isHeldFrame, playing]);
  return <audio ref={ref} src={item.asset.src || undefined} aria-label={`${item.asset.name}音频`} />;
}

export function Preview({ program, playback, onTogglePlayback, onSeek, onStepFrame, canUndo = false, canRedo = false, onUndo, onRedo, asset }: PreviewProps) {
  const visual = program.visual;
  const canPlay = program.duration > 0;
  const isPlaying = playback.status === 'playing';
  return (
    <section className="preview" aria-label="预览器">
      {asset ? <AssetPreview key={asset.id} asset={asset} /> : <>
      <div className="preview-canvas">
        {!visual && <div className="program-empty"><span>时间线空白</span></div>}
        {visual?.asset.kind === 'video' && <VideoFrame key={visual.clipId} program={program} playing={isPlaying} />}
        {visual?.asset.kind === 'image' && <img src={visual.asset.src} alt={`${visual.asset.name}预览`} className="preview-media" />}
        {visual?.asset.availability === 'offline' && <div className="preview-error" role="alert">素材“{visual.asset.name}”当前不可用</div>}
        {visual && <div className="scene-caption"><strong>{visual.asset.name}</strong><span>来自时间线</span></div>}
        {program.audio.map((item) => <AudioTrack key={item.clipId} item={item} playing={isPlaying} seekRevision={playback.seekRevision} />)}
      </div>
      <input className="playback-progress" aria-label="播放进度" type="range" min="0" max={program.duration} step={1 / 24} value={Math.min(playback.currentTime, program.duration)} disabled={!canPlay} onChange={(event) => onSeek(Number(event.target.value))} />
      <div className="playback-bar">
        <div className="playback-history"><button type="button" aria-label="撤销" disabled={!canUndo} onClick={onUndo}>↶</button><button type="button" aria-label="重做" disabled={!canRedo} onClick={onRedo}>↷</button><span>{formatTime(playback.currentTime)}</span></div>
        <div className="playback-transport"><button type="button" aria-label="上一帧" disabled={!canPlay} onClick={() => onStepFrame(-1)}>‹│</button><button type="button" aria-label={canPlay ? (isPlaying ? '暂停' : '播放') : '时间线无内容'} disabled={!canPlay} onClick={onTogglePlayback}>{isPlaying ? '❚❚' : '▶'}</button><button type="button" aria-label="下一帧" disabled={!canPlay} onClick={() => onStepFrame(1)}>│›</button></div>
        <div className="playback-output"><span>{formatTime(program.duration)}</span><button type="button" className="preview-export-button">导出</button></div>
      </div>
      </>}
    </section>
  );
}
