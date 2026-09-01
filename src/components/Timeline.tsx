import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { getTrackDeletionInfo, type EditorCommand, type EditorState, type TimelineClip, type TrackKind } from '../domain/editor';
import type { TimelineCommand } from '../timeline/commands';
import {
  clampTimelineScrollTime,
  getTimelineContentWidth,
  getVisibleRulerMarks,
  snapClipMove,
  snapTime,
  zoomAroundPlayhead,
} from '../timeline/geometry';

interface TimelineProps {
  state: EditorState;
  onSelectClip: (clipId: string) => void;
  onAddTrack: (kind: TrackKind) => void;
  onDeleteTrack: (trackId: string, confirmed: boolean) => void;
  onEdit?: (command: TimelineCommand) => void;
  onInsertAsset: (command: Extract<EditorCommand, { type: 'insert-asset-at-playhead' }>) => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onActivate?: () => void;
}

type Gesture = { mode: 'move' | 'start' | 'end'; x: number; original: TimelineClip };
type MovePreview = { start: number; trackId: string; compatible: boolean };
type DragTarget = { trackId: string; compatible: boolean } | null;

export const TRACK_LABEL_WIDTH = 52;

export function pointerXToTimelineTime(clientX: number, geometry: {
  scrollerLeft: number;
  scrollLeft: number;
  trackLabelWidth: number;
  pixelsPerSecond: number;
  duration: number;
}): number {
  const contentX = clientX - geometry.scrollerLeft + geometry.scrollLeft;
  return Math.max(0, Math.min(geometry.duration, (contentX - geometry.trackLabelWidth) / geometry.pixelsPerSecond));
}

function ClipView({ clip, state, pixelsPerSecond, selected, onSelect, onEdit, onSnapGuideChange, onDragTargetChange }: {
  clip: TimelineClip; state: EditorState; pixelsPerSecond: number; selected: boolean;
  onSelect: () => void; onEdit?: (command: TimelineCommand) => void;
  onSnapGuideChange: (guideTime: number | null) => void;
  onDragTargetChange: (target: DragTarget) => void;
}) {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [deltaX, setDeltaX] = useState(0);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const asset = state.assets[clip.assetId];
  const snapTargets = useMemo(() => Object.values(state.clips).filter((item) => item.id !== clip.id).flatMap((item) => [item.start, item.start + item.duration]), [clip.id, state.clips]);
  const begin = (mode: Gesture['mode']) => (event: ReactPointerEvent) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setGesture({ mode, x: event.clientX, original: clip });
    setDeltaX(0);
    setMovePreview(null);
    onSnapGuideChange(null);
    onDragTargetChange(null);
    onSelect();
  };
  const getMovePreview = (clientX: number, clientY: number): { preview: MovePreview; guideTime: number | null } => {
    const delta = (clientX - gesture!.x) / pixelsPerSecond;
    const lane = document.elementFromPoint?.(clientX, clientY)?.closest<HTMLElement>('[data-track-id]');
    const targetTrackId = lane?.dataset.trackId ?? clip.trackId;
    const targetTrack = state.tracks[targetTrackId];
    const compatible = Boolean(targetTrack) && ((targetTrack.kind === 'audio') === (asset.kind === 'audio'));
    const rawStart = Math.max(0, gesture!.original.start + delta);
    const preferredTargets = new Set(Object.values(state.clips)
      .filter((item) => item.id !== clip.id && item.trackId === targetTrackId)
      .flatMap((item) => [item.start, item.start + item.duration]));
    const snapped = snapClipMove(
      rawStart,
      gesture!.original.duration,
      snapTargets,
      pixelsPerSecond,
      8,
      preferredTargets,
    );
    return {
      preview: { start: snapped?.start ?? rawStart, trackId: targetTrackId, compatible },
      guideTime: compatible ? snapped?.guideTime ?? null : null,
    };
  };
  const move = (event: ReactPointerEvent) => {
    if (!gesture) return;
    if (gesture.mode === 'move') {
      const next = getMovePreview(event.clientX, event.clientY);
      setMovePreview(next.preview);
      onDragTargetChange({ trackId: next.preview.trackId, compatible: next.preview.compatible });
      onSnapGuideChange(next.guideTime);
      return;
    }
    setDeltaX(event.clientX - gesture.x);
  };
  const finish = (event: ReactPointerEvent) => {
    if (!gesture) return;
    const delta = (event.clientX - gesture.x) / pixelsPerSecond;
    if (gesture.mode === 'move') {
      const preview = movePreview ?? getMovePreview(event.clientX, event.clientY).preview;
      if (preview.compatible) onEdit?.({ type: 'moveClip', clipId: clip.id, trackId: preview.trackId, start: preview.start });
    }
    if (gesture.mode === 'start') onEdit?.({ type: 'resizeClipStart', clipId: clip.id, start: snapTime(Math.max(0, gesture.original.start + delta), snapTargets, pixelsPerSecond) });
    if (gesture.mode === 'end') onEdit?.({ type: 'resizeClipEnd', clipId: clip.id, end: snapTime(gesture.original.start + gesture.original.duration + delta, snapTargets, pixelsPerSecond) });
    setGesture(null); setDeltaX(0); setMovePreview(null); onSnapGuideChange(null); onDragTargetChange(null);
  };
  const cancel = () => {
    setGesture(null);
    setDeltaX(0);
    setMovePreview(null);
    onSnapGuideChange(null);
    onDragTargetChange(null);
  };
  const startDelta = gesture?.mode === 'start' ? deltaX : 0;
  const widthDelta = gesture?.mode === 'start' ? -deltaX : gesture?.mode === 'end' ? deltaX : 0;
  const previewLeft = gesture?.mode === 'move' && movePreview
    ? movePreview.start * pixelsPerSecond
    : clip.start * pixelsPerSecond + startDelta;
  return (
    <div role="button" tabIndex={0} aria-label={`${asset.name}，${clip.duration.toFixed(1)} 秒`} className={`timeline-clip clip-${asset.kind} ${selected ? 'is-selected' : ''} ${gesture ? 'is-dragging' : ''} ${movePreview && !movePreview.compatible ? 'is-invalid-drop' : ''}`} style={{ left: previewLeft, width: Math.max(4, clip.duration * pixelsPerSecond + widthDelta) }} onPointerDown={begin('move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onClick={onSelect}>
      <i className="clip-handle handle-start" aria-hidden="true" onPointerDown={begin('start')} />
      <span>{asset.name}</span><b>{clip.duration.toFixed(1)}s</b>
      <i className="clip-handle handle-end" aria-hidden="true" onPointerDown={begin('end')} />
    </div>
  );
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.round(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function Timeline({ state, onSelectClip, onAddTrack, onDeleteTrack, onEdit, onInsertAsset, currentTime, duration, onSeek, onActivate }: TimelineProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [view, setView] = useState({ pixelsPerSecond: 40, scrollTime: 0, viewportWidth: 0 });
  const scroller = useRef<HTMLDivElement | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const seekPointer = useRef<number | null>(null);
  const tracks = Object.values(state.tracks).sort((a, b) => a.kind !== b.kind ? (a.kind === 'visual' ? -1 : 1) : (a.kind === 'visual' ? b.order - a.order : a.order - b.order));
  const contentWidth = getTimelineContentWidth(duration, view.pixelsPerSecond, view.viewportWidth);
  const rulerMarks = getVisibleRulerMarks(view.scrollTime, view.viewportWidth, view.pixelsPerSecond);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const updateViewportWidth = (width: number) => {
      if (!Number.isFinite(width) || width <= 0) return;
      setView((current) => current.viewportWidth === width ? current : { ...current, viewportWidth: width });
    };
    const measure = () => updateViewportWidth(element.clientWidth || element.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => updateViewportWidth(entries[0]?.contentRect.width ?? 0));
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const scrollTime = clampTimelineScrollTime(
      view.scrollTime,
      view.pixelsPerSecond,
      contentWidth,
      view.viewportWidth,
    );
    if (scrollTime !== view.scrollTime) {
      setView((current) => ({ ...current, scrollTime }));
      return;
    }
    element.scrollLeft = scrollTime * view.pixelsPerSecond;
  }, [contentWidth, view.pixelsPerSecond, view.scrollTime, view.viewportWidth]);

  useEffect(() => {
    if (!pendingDelete || !dialog.current || dialog.current.open) return;
    if (typeof dialog.current.showModal === 'function') dialog.current.showModal();
    else dialog.current.setAttribute('open', '');
  }, [pendingDelete]);
  useEffect(() => {
    const deleteSelectedClip = (event: KeyboardEvent) => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || !state.selectedClipId || !onEdit) return;
      const target = event.target;
      const active = document.activeElement;
      const isEditable = (element: EventTarget | null) => element instanceof HTMLElement
        && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
      if (isEditable(target) || isEditable(active)) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      onEdit({ type: 'deleteClip', clipId: state.selectedClipId });
    };
    window.addEventListener('keydown', deleteSelectedClip);
    return () => window.removeEventListener('keydown', deleteSelectedClip);
  }, [onEdit, state.selectedClipId]);
  const changeZoom = (pixelsPerSecond: number) => {
    const playheadX = TRACK_LABEL_WIDTH + (currentTime - view.scrollTime) * view.pixelsPerSecond;
    const playheadIsVisible = playheadX >= TRACK_LABEL_WIDTH && playheadX <= view.viewportWidth;
    const anchorTime = playheadIsVisible
      ? currentTime
      : view.scrollTime + (view.viewportWidth / 2 - TRACK_LABEL_WIDTH) / view.pixelsPerSecond;
    const zoomed = zoomAroundPlayhead(view, pixelsPerSecond, anchorTime);
    const nextContentWidth = getTimelineContentWidth(duration, pixelsPerSecond, view.viewportWidth);
    const scrollTime = clampTimelineScrollTime(
      zoomed.scrollTime,
      pixelsPerSecond,
      nextContentWidth,
      view.viewportWidth,
    );
    setView({ ...zoomed, scrollTime, viewportWidth: view.viewportWidth });
  };
  const seekAt = (clientX: number) => {
    const rect = scroller.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek(pointerXToTimelineTime(clientX, {
      scrollerLeft: rect.left,
      scrollLeft: scroller.current!.scrollLeft,
      trackLabelWidth: TRACK_LABEL_WIDTH,
      pixelsPerSecond: view.pixelsPerSecond,
      duration,
    }));
  };
  const beginSeek = (event: ReactPointerEvent<HTMLDivElement>) => {
    seekPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekAt(event.clientX);
  };
  const moveSeek = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (seekPointer.current !== event.pointerId) return;
    seekAt(event.clientX);
  };
  const endSeek = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (seekPointer.current !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    seekPointer.current = null;
  };
  const dropAsset = (event: DragEvent, trackId: string) => {
    event.preventDefault();
    const assetId = event.dataTransfer.getData('application/x-timeline-asset');
    const asset = state.assets[assetId];
    const lane = event.currentTarget.getBoundingClientRect();
    if (!asset) return;
    const playheadTime = Math.max(0, (event.clientX - lane.left) / view.pixelsPerSecond);
    onInsertAsset({ type: 'insert-asset-at-playhead', assetId, playheadTime, preferredTrackId: trackId });
  };
  return (
    <section className="timeline" aria-label="时间线" onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
      <div className="timeline-toolbar"><div><button type="button" aria-label="添加视频轨道" onClick={() => onAddTrack('visual')}>＋V</button><button type="button" aria-label="添加音频轨道" onClick={() => onAddTrack('audio')}>＋A</button></div><span>{currentTime.toFixed(1)} / {duration.toFixed(1)}</span><label>缩放<input aria-label="时间线缩放" type="range" min="12" max="160" value={view.pixelsPerSecond} onChange={(event) => changeZoom(Number(event.target.value))} /></label><input className="timeline-seek-accessibility" type="range" aria-label="时间线定位" min="0" max={duration} step={1 / 24} value={Math.min(currentTime, duration)} onChange={(event) => onSeek(Number(event.target.value))} /></div>
      <div ref={scroller} className="timeline-scroll" onScroll={(event) => {
        const scrollLeft = event.currentTarget.scrollLeft;
        setView((current) => ({ ...current, scrollTime: scrollLeft / current.pixelsPerSecond }));
      }}>
        <div className="timeline-content" data-testid="timeline-content" style={{ width: contentWidth }}>
          <div className="timeline-ruler" onPointerDown={beginSeek} onPointerMove={moveSeek} onPointerUp={endSeek} onPointerCancel={endSeek}>{rulerMarks.map((mark) => <span key={mark} style={{ left: TRACK_LABEL_WIDTH + mark * view.pixelsPerSecond }}>{formatTime(mark)}</span>)}</div>
          <div className="track-grid">
            <div className="playhead" role="slider" tabIndex={0} aria-label="时间线播放头" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} style={{ left: TRACK_LABEL_WIDTH + currentTime * view.pixelsPerSecond }} onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const step = event.shiftKey ? 1 : 1 / 24;
              onSeek(Math.max(0, Math.min(duration, currentTime + (event.key === 'ArrowRight' ? step : -step))));
            }}><i /></div>
            {snapGuideTime !== null && <div className="timeline-snap-guide" data-testid="timeline-snap-guide" style={{ left: TRACK_LABEL_WIDTH + snapGuideTime * view.pixelsPerSecond }} />}
            {tracks.map((track) => <div className={`track-row track-${track.kind}`} key={track.id}><div className="track-label"><strong>{track.name}</strong><button type="button" aria-label={`删除 ${track.name}`} onClick={() => { const info = getTrackDeletionInfo(state, track.id); if (info.requiresConfirmation) setPendingDelete(track.id); else onDeleteTrack(track.id, false); }}>×</button></div><div className={`track-lane ${dragTarget?.trackId === track.id ? (dragTarget.compatible ? 'is-compatible-drop' : 'is-incompatible-drop') : ''}`} data-track-id={track.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropAsset(event, track.id)}>{Object.values(state.clips).filter((clip) => clip.trackId === track.id).map((clip) => <ClipView key={clip.id} clip={clip} state={state} pixelsPerSecond={view.pixelsPerSecond} selected={clip.id === state.selectedClipId} onSelect={() => onSelectClip(clip.id)} onEdit={onEdit} onSnapGuideChange={setSnapGuideTime} onDragTargetChange={setDragTarget} />)}</div></div>)}
          </div>
        </div>
      </div>
      {pendingDelete && <dialog open ref={dialog} className="track-delete-dialog" aria-label="删除轨道"><strong>删除轨道？</strong><p>该轨道包含 {getTrackDeletionInfo(state, pendingDelete).clipCount} 个片段，删除后可通过撤销恢复。</p><div><button type="button" onClick={() => { if (typeof dialog.current?.close === 'function') dialog.current.close(); setPendingDelete(null); }}>取消</button><button type="button" aria-label="确认删除轨道" onClick={() => { onDeleteTrack(pendingDelete, true); if (typeof dialog.current?.close === 'function') dialog.current.close(); setPendingDelete(null); }}>删除</button></div></dialog>}
    </section>
  );
}
