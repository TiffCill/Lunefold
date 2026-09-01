import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageDetailViewer } from './ImageDetailViewer';

interface MarkdownMessageProps {
  content: string;
}

interface MarkdownBoundaryProps extends MarkdownMessageProps {
  children: ReactNode;
}

interface MarkdownBoundaryState {
  hasError: boolean;
}

class MarkdownBoundary extends Component<MarkdownBoundaryProps, MarkdownBoundaryState> {
  state: MarkdownBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MarkdownBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {}

  render() {
    if (this.state.hasError) {
      return <p className="markdown-message markdown-message-fallback">{this.props.content}</p>;
    }

    return this.props.children;
  }
}

function isAllowedLink(href: string | undefined): href is string {
  if (!href) return false;

  try {
    const protocol = new URL(href).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

type LinkedMediaKind = 'image' | 'video';

function linkedMediaKind(href: string): LinkedMediaKind | null {
  try {
    const pathname = new URL(href).pathname.toLowerCase();
    if (/\.(?:png|jpe?g|webp|gif)$/.test(pathname)) return 'image';
    if (/\.(?:mp4|webm|mov)$/.test(pathname)) return 'video';
  } catch {
    return null;
  }
  return null;
}

function normalizeSupportedMediaHtml(content: string) {
  const lines = content.split('\n');
  let fence: string | null = null;
  return lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? null : fence ?? marker;
      return line;
    }
    if (fence) return line;
    const videoTag = line.match(/^\s*<video\b([^>]*)>\s*<\/video>\s*$/i);
    if (!videoTag) return line;
    const source = videoTag[1].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!source || !isAllowedLink(source) || source.startsWith('mailto:') || linkedMediaKind(source) !== 'video') return line;
    const markdownSafeSource = source.replace(/[()]/g, (character) => encodeURIComponent(character));
    return `[生成视频](${markdownSafeSource})`;
  }).join('\n');
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  return '';
}

function LinkedMedia({ href, label, kind }: { href: string; label: string; kind: LinkedMediaKind }) {
  const [failed, setFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const filename = (() => {
    try { return decodeURIComponent(new URL(href).pathname.split('/').pop() || 'media'); } catch { return 'media'; }
  })();
  return <span className={`markdown-media is-${kind} ${failed ? 'is-unavailable' : ''}`}>
    {!failed && kind === 'image' && <button type="button" className="markdown-media-preview-button" aria-label={`查看图片详情：${label}`} onClick={() => setDetailsOpen(true)}><img src={href} alt={label} loading="lazy" onError={() => setFailed(true)} /></button>}
    {!failed && kind === 'video' && <video src={href} aria-label={label} controls preload="metadata" onError={() => setFailed(true)} />}
    {failed && <span className="markdown-media-error">媒体加载失败</span>}
    <span className="markdown-media-caption">{label}</span>
    <span className="markdown-media-actions">
      <a href={href} target="_blank" rel="noopener noreferrer">打开原文件</a>
      <a href={href} download={filename} target="_blank" rel="noopener noreferrer">下载</a>
    </span>
    {detailsOpen && !failed && <ImageDetailViewer src={href} alt={label} filename={filename} onClose={() => setDetailsOpen(false)} />}
  </span>;
}

const components: Components = {
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : undefined;
    if (!href || !isAllowedLink(href) || href.startsWith('mailto:')) return <span>{alt || '图片'}</span>;
    return <LinkedMedia href={href} label={alt || '生成图片'} kind="image" />;
  },
  a({ href, children }) {
    if (!isAllowedLink(href)) {
      return <span>{children}</span>;
    }

    if (href.startsWith('mailto:')) {
      return <a href={href}>{children}</a>;
    }

    const mediaKind = linkedMediaKind(href);
    if (mediaKind) return <LinkedMedia href={href} label={nodeText(children) || '媒体预览'} kind={mediaKind} />;

    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const normalizedContent = normalizeSupportedMediaHtml(content);
  return (
    <MarkdownBoundary content={content}>
      <div className="markdown-message">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{normalizedContent}</ReactMarkdown>
      </div>
    </MarkdownBoundary>
  );
}
