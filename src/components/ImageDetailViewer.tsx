import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ZoomableImage } from './ZoomableImage';

interface ImageDetailViewerProps {
  src: string;
  alt: string;
  filename: string;
  onClose: () => void;
}

export function ImageDetailViewer({ src, alt, filename, onClose }: ImageDetailViewerProps) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose]);

  return createPortal(
    <div
      className="image-detail-backdrop"
      data-testid="image-detail-backdrop"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <dialog open className="image-detail-viewer" aria-label={`图片详情：${alt}`}>
        <header><strong>{alt}</strong><button type="button" aria-label="关闭图片详情" onClick={onClose}>×</button></header>
        <ZoomableImage key={src} src={src} alt={alt} controlsLabel="图片详情缩放控制" />
        <footer><a href={src} download={filename} target="_blank" rel="noopener noreferrer">下载</a></footer>
      </dialog>
    </div>,
    document.body,
  );
}
