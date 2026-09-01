import { useCallback, useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

interface Point {
  x: number;
  y: number;
}

interface AssetContextMenuProps {
  mediaId: string;
  anchor: Point;
  canReveal: boolean;
  onAddToConversation: (mediaId: string) => void | Promise<void>;
  onAddToTimeline: (mediaId: string) => void | Promise<void>;
  onReveal: (mediaId: string) => void | Promise<void>;
  onClose: () => void;
}

const VIEWPORT_INSET = 8;
const CLOSE_ANIMATION_FALLBACK_MS = 200;

export function AssetContextMenu({
  mediaId,
  anchor,
  canReveal,
  onAddToConversation,
  onAddToTimeline,
  onReveal,
  onClose,
}: AssetContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState(anchor);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const finishedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const finishClose = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCloseRef.current();
  }, []);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
  }, []);

  useEffect(() => {
    if (!closing) return;
    const fallback = window.setTimeout(finishClose, CLOSE_ANIMATION_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [closing, finishClose]);

  const clampToViewport = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rectangle = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(VIEWPORT_INSET, Math.min(anchor.x, window.innerWidth - rectangle.width - VIEWPORT_INSET)),
      y: Math.max(VIEWPORT_INSET, Math.min(anchor.y, window.innerHeight - rectangle.height - VIEWPORT_INSET)),
    });
  }, [anchor]);

  useLayoutEffect(() => {
    clampToViewport();
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
  }, [clampToViewport]);

  useLayoutEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) requestClose();
    };
    const close = () => requestClose();
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('blur', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', clampToViewport);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', clampToViewport);
    };
  }, [clampToViewport, requestClose]);

  const enabledItems = () => itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
  const moveFocus = (direction: 1 | -1) => {
    const items = enabledItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(currentIndex + direction + items.length) % items.length]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (closingRef.current) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const items = enabledItems();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && document.activeElement instanceof HTMLButtonElement) {
      event.preventDefault();
      document.activeElement.click();
    }
  };

  const activate = (action: (id: string) => void | Promise<void>) => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      void Promise.resolve(action(mediaId)).catch(() => undefined);
    } catch {
      // The owning library reports actionable errors; never leave a rejected menu action unhandled.
    } finally {
      setClosing(true);
    }
  };

  const onAnimationEnd = (_event: AnimationEvent<HTMLDivElement>) => {
    if (closingRef.current) finishClose();
  };

  const style = {
    left: position.x,
    top: position.y,
    '--menu-origin-x': `${anchor.x - position.x}px`,
    '--menu-origin-y': `${anchor.y - position.y}px`,
  } as CSSProperties;

  return createPortal(
    <div
      ref={menuRef}
      className={`asset-context-menu ${closing ? 'is-closing' : ''}`}
      role="menu"
      aria-label="素材操作"
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      style={style}
      onKeyDown={onKeyDown}
      onAnimationEnd={onAnimationEnd}
    >
      <button ref={(node) => { itemRefs.current[0] = node; }} type="button" role="menuitem" disabled={closing} onClick={() => activate(onAddToConversation)}>添加到会话</button>
      <button ref={(node) => { itemRefs.current[1] = node; }} type="button" role="menuitem" disabled={closing} onClick={() => activate(onAddToTimeline)}>添加到时间线</button>
      <button
        ref={(node) => { itemRefs.current[2] = node; }}
        type="button"
        role="menuitem"
        disabled={closing || !canReveal}
        title={canReveal ? undefined : '此素材没有可定位的本地源文件'}
        onClick={() => activate(onReveal)}
      >在文件夹中显示</button>
    </div>,
    document.body,
  );
}
