import { fireEvent, render, screen } from '@testing-library/react';
import type { Options } from 'react-markdown';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownMessage } from './MarkdownMessage';

const rendererFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>();
  const { createElement } = await import('react');

  return {
    ...actual,
    default: (props: Options) => {
      if (rendererFailure.enabled) throw new Error('simulated renderer failure');
      return createElement(actual.default, props);
    },
  };
});

describe('MarkdownMessage', () => {
  it('renders GFM without executing raw HTML', () => {
    render(<MarkdownMessage content={'## Title\n- [x] ready\n<script>alert(1)</script>'} />);

    expect(screen.getByRole('heading', { name: 'Title' })).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/<script>/)).toBeVisible();
  });

  it('renders GFM tables and code without escaping the message container', () => {
    render(<MarkdownMessage content={'| Name | State |\n| --- | --- |\n| Cut | Ready |\n\nUse `trim`.\n\n```ts\nconst frame = 24;\n```'} />);

    expect(screen.getByRole('table')).toHaveTextContent('Cut');
    expect(screen.getByText('trim')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByText('const frame = 24;')).toHaveProperty('tagName', 'CODE');
  });

  it('opens allowed external HTTP links with safe attributes', () => {
    render(<MarkdownMessage content={'[reference](https://example.com/reference) and [mail](mailto:studio@example.com)'} />);

    const externalLink = screen.getByRole('link', { name: 'reference' });
    expect(externalLink).toHaveAttribute('href', 'https://example.com/reference');
    expect(externalLink).toHaveAttribute('target', '_blank');
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'mailto:studio@example.com');
  });

  it('renders linked video and image files as previews with open and download actions', () => {
    render(<MarkdownMessage content={'[动态视频](https://file.modellix.ai/result.mp4?token=abc)\n\n[生成图片](https://file.modellix.ai/result.webp)'} />);

    const video = screen.getByLabelText('动态视频');
    expect(video).toHaveProperty('tagName', 'VIDEO');
    expect(video).toHaveAttribute('src', 'https://file.modellix.ai/result.mp4?token=abc');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');

    const image = screen.getByRole('img', { name: '生成图片' });
    expect(image).toHaveAttribute('src', 'https://file.modellix.ai/result.webp');
    expect(image).toHaveAttribute('loading', 'lazy');

    expect(screen.getAllByRole('link', { name: '打开原文件' })).toHaveLength(2);
    const downloads = screen.getAllByRole('link', { name: '下载' });
    expect(downloads).toHaveLength(2);
    expect(downloads[0]).toHaveAttribute('download');
  });

  it('turns an AI-generated HTML video tag into the safe video player', () => {
    render(<MarkdownMessage content={'已按照您的要求生成展示视频，严格保持家具材质一致：\n\n<video src="https://file.modellix.ai/aigc/video/63759d72-0da7-4616-a33f-c7438155cb5e_760518d9e768.mp4" controls width="100%"></video>\n\n如有其他角度或不同场景的需求，随时告诉我！'} />);

    const video = screen.getByLabelText('生成视频');
    expect(video).toHaveProperty('tagName', 'VIDEO');
    expect(video).toHaveAttribute('src', 'https://file.modellix.ai/aigc/video/63759d72-0da7-4616-a33f-c7438155cb5e_760518d9e768.mp4');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('download');
  });

  it('does not activate unsafe or non-video HTML sources', () => {
    render(<MarkdownMessage content={'<video src="javascript:alert(1)" controls></video>\n\n<video src="https://example.com/page.html" controls></video>'} />);

    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText(/javascript:alert/)).toBeVisible();
    expect(screen.getByText(/page\.html/)).toBeVisible();
  });

  it('opens generated image details and closes with Escape', () => {
    render(<MarkdownMessage content={'[生成图片](https://file.example/result.webp)'} />);

    fireEvent.click(screen.getByRole('button', { name: '查看图片详情：生成图片' }));
    expect(screen.getByRole('dialog', { name: '图片详情：生成图片' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '图片详情：生成图片' })).toBeNull();
  });

  it('renders markdown image syntax as a responsive clickable preview', () => {
    render(<MarkdownMessage content={'![生成图片](https://file.example/render?id=42)'} />);

    const preview = screen.getByRole('button', { name: '查看图片详情：生成图片' });
    expect(preview).toHaveClass('markdown-media-preview-button');
    expect(preview.closest('.markdown-media')).toBeInTheDocument();
    fireEvent.click(preview);
    expect(screen.getByRole('dialog', { name: '图片详情：生成图片' })).toBeVisible();
  });

  it('keeps non-media URLs as regular links', () => {
    render(<MarkdownMessage content={'[documentation](https://example.com/watch?id=123)'} />);

    expect(screen.getByRole('link', { name: 'documentation' })).toHaveAttribute('target', '_blank');
    expect(document.querySelector('video, img')).toBeNull();
  });

  it('renders unsafe link protocols as non-navigable text', () => {
    render(<MarkdownMessage content={'[do not open](javascript:alert(1))'} />);

    expect(screen.getByText('do not open')).not.toHaveAttribute('href');
    expect(screen.queryByRole('link', { name: 'do not open' })).toBeNull();
  });

  it('falls back to the original plain text when rendering throws', () => {
    rendererFailure.enabled = true;
    try {
      render(<MarkdownMessage content={'## Preserve this\n- exactly as written'} />);
    } finally {
      rendererFailure.enabled = false;
    }

    expect(screen.getByText('## Preserve this - exactly as written')).toHaveClass('markdown-message-fallback');
  });
});
