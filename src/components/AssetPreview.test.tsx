import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetPreview } from './AssetPreview';

describe('AssetPreview', () => {
  it('renders image assets with zoom controls', () => {
    render(<AssetPreview asset={{ id: 'i1', name: 'still.png', kind: 'image', src: '/still.png' }} />);
    expect(screen.getByRole('img', { name: 'still.png素材预览' })).toBeVisible();
    const toolbar = screen.getByRole('toolbar', { name: '素材预览控制' });
    expect(toolbar).toHaveTextContent('still.png');
    expect(toolbar).toContainElement(screen.getByRole('button', { name: '放大图片' }));
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重做' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导出' })).toBeNull();
    expect(screen.queryByText('素材预览')).toBeNull();
  });

  it('seeks video assets with their own progress control', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    render(<AssetPreview asset={{ id: 'v1', name: 'clip.mp4', kind: 'video', src: '/clip.mp4' }} />);
    const video = screen.getByLabelText('clip.mp4素材视频') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
    fireEvent.loadedMetadata(video);
    fireEvent.change(screen.getByRole('slider', { name: '素材播放进度' }), { target: { value: '3' } });
    expect(video.currentTime).toBe(3);
    const toolbar = screen.getByRole('toolbar', { name: '素材预览控制' });
    expect(toolbar).toHaveTextContent('clip.mp4');
    expect(toolbar).toHaveTextContent('00:00:03:00 / 00:00:10:00');
    expect(toolbar).toContainElement(screen.getByRole('button', { name: '播放素材' }));
    expect(screen.queryByRole('button', { name: '导出' })).toBeNull();
  });

});
