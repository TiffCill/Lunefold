import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { rubberband } from '../motion/physics';

interface ResizablePanelProps {
  children: ReactNode;
  width: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange: (width: number) => void;
}

export function ResizablePanel({ children, width, minWidth = 260, maxWidth = 480, onWidthChange }: ResizablePanelProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.classList.add('is-dragging');
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const raw = drag.current.startWidth - (event.clientX - drag.current.startX);
    if (raw < minWidth) onWidthChange(minWidth + rubberband(raw - minWidth, 220));
    else if (raw > maxWidth) onWidthChange(maxWidth + rubberband(raw - maxWidth, 220));
    else onWidthChange(raw);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    event.currentTarget.classList.remove('is-dragging');
    onWidthChange(Math.max(minWidth, Math.min(maxWidth, width)));
  };
  return <><div className="panel-resizer" role="separator" aria-label="调整 AI 对话框宽度" aria-orientation="vertical" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} />{children}</>;
}
