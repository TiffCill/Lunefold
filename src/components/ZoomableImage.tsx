import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
  controlsLabel?: string;
  toolbarLabel?: string;
}

interface ImageView {
  scale: number;
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
}

const FIT_VIEW: ImageView = { scale: 1, x: 0, y: 0 };

export function ZoomableImage({ src, alt, className = '', controlsLabel = '图片缩放控制', toolbarLabel }: ZoomableImageProps) {
  const [view, setView] = useState<ImageView>(FIT_VIEW);
  const drag = useRef<DragState | null>(null);
  const zoom = (delta: number) => setView((current) => {
    const scale = Math.min(4, Math.max(1, Math.round((current.scale + delta) * 100) / 100));
    return scale === 1 ? FIT_VIEW : { ...current, scale };
  });
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? .25 : -.25);
  };
  const beginPan = (event: PointerEvent<HTMLImageElement>) => {
    if (view.scale <= 1) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
  };
  const pan = (event: PointerEvent<HTMLImageElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    setView((current) => ({ ...current, x: currentDrag.originX + event.clientX - currentDrag.x, y: currentDrag.originY + event.clientY - currentDrag.y }));
  };
  const endPan = (event: PointerEvent<HTMLImageElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.current = null;
  };

  return (
    <div className={`zoomable-image ${className}`.trim()}>
      <div role="region" aria-label={`${alt}查看区域`} className="zoomable-image-viewport" onWheel={handleWheel}>
        <img
          src={src}
          alt={alt}
          draggable={false}
          onPointerDown={beginPan}
          onPointerMove={pan}
          onPointerUp={endPan}
          onPointerCancel={() => { drag.current = null; }}
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
        />
      </div>
      <div className={`zoomable-image-controls ${toolbarLabel ? 'asset-preview-toolbar' : ''}`.trim()} aria-label={controlsLabel} role={toolbarLabel ? 'toolbar' : undefined}>
        {toolbarLabel && <span className="asset-preview-filename" title={toolbarLabel}>{toolbarLabel}</span>}
        <div className="zoomable-image-control-buttons">
          <button type="button" aria-label="缩小图片" disabled={view.scale <= 1} onClick={() => zoom(-.25)}>−</button>
          <button type="button" aria-label="适应窗口" onClick={() => setView(FIT_VIEW)}>适应</button>
          <button type="button" aria-label="放大图片" disabled={view.scale >= 4} onClick={() => zoom(.25)}>＋</button>
        </div>
        {toolbarLabel && <span aria-hidden="true" />}
      </div>
    </div>
  );
}
