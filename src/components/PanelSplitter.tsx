import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { rubberband } from '../motion/physics';

export interface PanelSplitterProps {
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  'aria-label'?: string;
}

interface DragState {
  pointerId: number;
  startCoordinate: number;
  startValue: number;
  lastValue: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function PanelSplitter({
  orientation,
  value,
  min,
  max,
  invert = false,
  onChange,
  onCommit,
  'aria-label': ariaLabel = '调整面板大小',
}: PanelSplitterProps) {
  const drag = useRef<DragState | null>(null);
  const springFrame = useRef<number | null>(null);
  const isVertical = orientation === 'vertical';
  const direction = invert ? -1 : 1;
  const coordinate = (event: PointerEvent<HTMLDivElement>) => isVertical ? event.clientX : event.clientY;
  const valueAt = (startValue: number, startCoordinate: number, currentCoordinate: number) => (
    startValue + (currentCoordinate - startCoordinate) * direction
  );
  const softened = (rawValue: number) => {
    const range = Math.max(1, max - min);
    if (rawValue < min) return min + rubberband(rawValue - min, range);
    if (rawValue > max) return max + rubberband(rawValue - max, range);
    return rawValue;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (springFrame.current !== null) cancelAnimationFrame(springFrame.current);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startCoordinate: coordinate(event),
      startValue: value,
      lastValue: value,
    };
  };

  useEffect(() => () => {
    if (springFrame.current !== null) cancelAnimationFrame(springFrame.current);
  }, []);

  const settleAt = (from: number, target: number) => {
    if (typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - from) < .5) {
      onChange(target); onCommit(target); return;
    }
    let position = from;
    let velocity = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .032); previous = now;
      velocity += ((target - position) * 180 - velocity * 27) * dt;
      position += velocity * dt;
      onChange(position);
      if (Math.abs(target - position) > .15 || Math.abs(velocity) > .15) springFrame.current = requestAnimationFrame(tick);
      else { springFrame.current = null; onChange(target); onCommit(target); }
    };
    springFrame.current = requestAnimationFrame(tick);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    const nextValue = softened(valueAt(activeDrag.startValue, activeDrag.startCoordinate, coordinate(event)));
    activeDrag.lastValue = nextValue;
    onChange(nextValue);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    const finalValue = valueAt(activeDrag.startValue, activeDrag.startCoordinate, coordinate(event));
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    settleAt(activeDrag.lastValue, clamp(finalValue, min, max));
  };
  const cancelDrag = (event: PointerEvent<HTMLDivElement>) => {
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    drag.current = null;
    settleAt(activeDrag.lastValue, clamp(activeDrag.lastValue, min, max));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const positiveKey = isVertical ? 'ArrowRight' : 'ArrowDown';
    const negativeKey = isVertical ? 'ArrowLeft' : 'ArrowUp';
    if (event.key !== positiveKey && event.key !== negativeKey) return;

    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const keyDirection = event.key === positiveKey ? 1 : -1;
    const nextValue = clamp(value + keyDirection * direction * step, min, max);
    onChange(nextValue);
    onCommit(nextValue);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamp(value, min, max)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={cancelDrag}
      onKeyDown={handleKeyDown}
    />
  );
}
