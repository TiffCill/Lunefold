import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ZoomableImage } from './ZoomableImage';

describe('ZoomableImage', () => {
  it('supports button, wheel, fit, and pointer pan controls', () => {
    render(<ZoomableImage src="/image.png" alt="素材图片" />);
    const image = screen.getByRole('img', { name: '素材图片' });

    fireEvent.click(screen.getByRole('button', { name: '放大图片' }));
    expect(image.getAttribute('style')).toContain('scale(1.25)');
    fireEvent.wheel(screen.getByRole('region', { name: '素材图片查看区域' }), { deltaY: -100 });
    expect(image.getAttribute('style')).toContain('scale(1.5)');
    fireEvent.pointerDown(image, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(image, { pointerId: 1, clientX: 40, clientY: 35 });
    expect(image.getAttribute('style')).toContain('translate3d(20px, 15px, 0)');
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(image.getAttribute('style')).toContain('translate3d(0px, 0px, 0) scale(1)');
  });
});
