import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { MediaAsset } from '../domain/editor';
import type { MediaItem } from '../media/mediaTypes';
import type { MediaLibraryStatus } from '../media/useMediaLibrary';
import type { CompanionMediaLibraryStatus } from '../media/useCompanionMediaLibrary';
import { AssetContextMenu } from './AssetContextMenu';

interface AssetLibraryProps {
  assets: Record<string, MediaAsset>;
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  localItems?: MediaItem[];
  directoryStatus?: MediaLibraryStatus | CompanionMediaLibraryStatus;
  directoryError?: string | null;
  actionError?: string | null;
  insertionNotice?: string | null;
  ignoredCount?: number;
  onChooseDirectory?: () => void;
  onRestoreDirectory?: () => void;
  selectedLocalMediaId?: string | null;
  onSelectLocalMedia?: (item: MediaItem) => void;
  onAddToConversation?: (mediaId: string) => void;
  onAddToTimeline?: (mediaId: string) => void;
  onReveal?: (mediaId: string) => void | Promise<void>;
  onClearActionError?: () => void;
}

interface MenuState {
  serial: number;
  mediaId: string;
  mediaName: string;
  anchor: { x: number; y: number };
  canReveal: boolean;
  origin: HTMLButtonElement;
}

const kindLabel = { video: '视频', image: '图片', audio: '音频' } as const;

export function AssetLibrary({
  assets,
  selectedAssetId,
  onSelectAsset,
  localItems = [],
  directoryStatus = 'unselected',
  directoryError,
  actionError,
  insertionNotice,
  ignoredCount = 0,
  onChooseDirectory,
  onRestoreDirectory,
  selectedLocalMediaId,
  onSelectLocalMedia,
  onAddToConversation,
  onAddToTimeline,
  onReveal,
  onClearActionError,
}: AssetLibraryProps) {
  const chooseDirectoryRef = useRef<HTMLButtonElement>(null);
  const menuSerialRef = useRef(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [actionStatus, setActionStatus] = useState<{ kind: 'status' | 'error'; text: string } | null>(null);
  const assetCount = Object.keys(assets).length + localItems.length;
  const closeMenu = useCallback(() => {
    const origin = menu?.origin;
    setMenu(null);
    queueMicrotask(() => {
      if (origin?.isConnected) origin.focus();
      else chooseDirectoryRef.current?.focus();
    });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const stillAvailable = Boolean(assets[menu.mediaId]) || localItems.some((item) => item.id === menu.mediaId);
    if (!stillAvailable) closeMenu();
  }, [assets, closeMenu, localItems, menu]);

  const openMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    mediaId: string,
    mediaName: string,
    canReveal: boolean,
    select: () => void,
  ) => {
    event.preventDefault();
    select();
    setActionStatus(null);
    onClearActionError?.();
    setMenu({ serial: ++menuSerialRef.current, mediaId, mediaName, canReveal, origin: event.currentTarget, anchor: { x: event.clientX, y: event.clientY } });
  };
  const reveal = async (mediaId: string) => {
    const mediaName = menu?.mediaName ?? '素材';
    try {
      await onReveal?.(mediaId);
      setActionStatus({ kind: 'status', text: `已在文件夹中显示“${mediaName}”` });
    } catch {
      setActionStatus({ kind: 'error', text: `无法在文件夹中显示“${mediaName}”` });
    }
  };
  const visibleActionStatus = actionError
    ? { kind: 'error' as const, text: actionError }
    : actionStatus;
  const directoryText = directoryStatus === 'ready'
    ? `本地目录 · ${localItems.length} 项`
    : directoryStatus === 'scanning'
      ? '正在扫描目录…'
      : directoryStatus === 'permission-needed'
        ? '需要恢复目录访问'
        : directoryStatus === 'denied'
          ? '目录访问被拒绝'
          : directoryStatus === 'unsupported'
            ? '当前浏览器不支持目录读取'
            : directoryStatus === 'empty'
              ? '目录中没有支持的素材'
              : directoryStatus === 'reselect-required'
                ? directoryError ?? '素材目录不可用，请重新选择素材目录'
                : directoryStatus === 'partial-error'
                  ? directoryError ?? `已读取部分素材 · 忽略 ${ignoredCount} 项`
                  : directoryStatus === 'unselected'
                    ? '请选择素材目录'
                    : '素材库尚未准备好';
  return (
    <aside className="asset-library material-heavy" aria-label="素材库">
      <div className="panel-heading">
        <div><strong>素材库</strong><span>{assetCount} 个素材</span></div>
        <button ref={chooseDirectoryRef} type="button" aria-label="选择素材目录" onClick={onChooseDirectory}>＋</button>
      </div>
      <div className={`directory-status status-${directoryStatus}`}>
        <span>{directoryText}</span>
        {directoryStatus === 'unselected' && <button type="button" onClick={onChooseDirectory}>选择目录</button>}
        {directoryStatus === 'permission-needed' && <button type="button" onClick={onRestoreDirectory}>恢复访问</button>}
        {directoryStatus === 'reselect-required' && <button type="button" aria-label="重新选择素材目录" onClick={onChooseDirectory}>重新选择</button>}
        {directoryStatus === 'partial-error' && onRestoreDirectory && <button type="button" onClick={onRestoreDirectory}>重试</button>}
      </div>
      {visibleActionStatus && <div className={`asset-action-status is-${visibleActionStatus.kind}`} role={visibleActionStatus.kind === 'error' ? 'alert' : 'status'}>{visibleActionStatus.text}</div>}
      {insertionNotice && <div className="asset-insertion-notice" role="status">{insertionNotice}</div>}
      <label className="search-field"><span>⌕</span><input placeholder="搜索素材" aria-label="搜索素材" /></label>
      <div className="asset-grid" role="grid" aria-label="素材库文件">
        {Object.values(assets).map((asset, index) => (
          <button
            type="button"
            draggable
            role="gridcell"
            key={asset.id}
            title={asset.name}
            aria-label={`${asset.name}，${kindLabel[asset.kind]}`}
            className={`asset-tile art-${index + 1} ${!selectedLocalMediaId && asset.id === selectedAssetId ? 'is-selected' : ''}`}
            onClick={() => onSelectAsset(asset.id)}
            onContextMenu={(event) => openMenu(event, asset.id, asset.name, false, () => onSelectAsset(asset.id))}
            onDragStart={(event) => event.dataTransfer.setData('application/x-timeline-asset', asset.id)}
          >
            <span className="asset-tile-art" aria-hidden="true"><i>{asset.kind === 'audio' ? '♫' : asset.kind === 'image' ? '▧' : '▶'}</i></span>
            <span className="asset-kind-badge">{kindLabel[asset.kind]}</span>
            <strong>{asset.name}</strong>
          </button>
        ))}
        {localItems.map((item) => (
          <button
            type="button"
            role="gridcell"
            draggable
            key={item.id}
            title={item.name}
            aria-label={`${item.name}，${kindLabel[item.kind]}`}
            className={`asset-tile local-tile media-${item.kind} ${selectedLocalMediaId === item.id ? 'is-selected' : ''}`}
            onClick={() => onSelectLocalMedia?.(item)}
            onContextMenu={(event) => openMenu(event, item.id, item.name, Boolean(onReveal), () => onSelectLocalMedia?.(item))}
            onDragStart={(event) => event.dataTransfer.setData('application/x-timeline-asset', item.id)}
          >
            {item.kind === 'image' ? <img src={item.objectUrl} alt="" /> : <span className="asset-tile-art" aria-hidden="true"><i>{item.kind === 'video' ? '▶' : '♫'}</i></span>}
            <span className="asset-kind-badge">{kindLabel[item.kind]}</span>
            <strong>{item.name}</strong>
            {item.durationStatus === 'pending' && <small className="asset-duration-state">读取时长…</small>}
            {item.durationStatus === 'failed' && <small className="asset-duration-state is-warning">时长未知</small>}
            {item.durationStatus === 'ready' && typeof item.duration === 'number' && <small className="asset-duration-state">{item.duration} 秒</small>}
          </button>
        ))}
      </div>
      {menu && (
        <AssetContextMenu
          key={menu.serial}
          mediaId={menu.mediaId}
          anchor={menu.anchor}
          canReveal={menu.canReveal}
          onAddToConversation={(mediaId) => onAddToConversation?.(mediaId)}
          onAddToTimeline={(mediaId) => onAddToTimeline?.(mediaId)}
          onReveal={reveal}
          onClose={closeMenu}
        />
      )}
    </aside>
  );
}
