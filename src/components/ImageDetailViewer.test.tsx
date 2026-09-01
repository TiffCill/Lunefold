import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageDetailViewer } from './ImageDetailViewer';

describe('ImageDetailViewer', () => {
  it('offers zoom and download, and closes with Escape or the backdrop', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ImageDetailViewer src="/large.png" alt="生成图片" filename="large.png" onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: '图片详情：生成图片' })).toBeVisible();
    expect(screen.getByRole('button', { name: '放大图片' })).toBeVisible();
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('download', 'large.png');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    rerender(<ImageDetailViewer src="/large.png" alt="生成图片" filename="large.png" onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('image-detail-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
