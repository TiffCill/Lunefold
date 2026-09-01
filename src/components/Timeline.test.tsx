import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoState } from '../domain/editor';
import '../styles.css';
import { pointerXToTimelineTime, Timeline } from './Timeline';

const props = () => ({ state: createDemoState(), onSelectClip: vi.fn(), onAddTrack: vi.fn(), onDeleteTrack: vi.fn(), onEdit: vi.fn(), onInsertAsset: vi.fn(), currentTime: 5, duration: 28, onSeek: vi.fn() });

describe('Timeline', () => {
  it('maps the pointer to timeline time with one shared gutter and scroll coordinate system', () => {
    expect(pointerXToTimelineTime(352, {
      scrollerLeft: 100,
      scrollLeft: 200,
      trackLabelWidth: 52,
      pixelsPerSecond: 40,
      duration: 28,
    })).toBe(10);
    expect(pointerXToTimelineTime(-100, { scrollerLeft: 100, scrollLeft: 0, trackLabelWidth: 52, pixelsPerSecond: 40, duration: 28 })).toBe(0);
    expect(pointerXToTimelineTime(5000, { scrollerLeft: 100, scrollLeft: 0, trackLabelWidth: 52, pixelsPerSecond: 40, duration: 28 })).toBe(28);
  });

  it('captures ruler dragging and seeks one-to-one at the active zoom and scroll offset', async () => {
    const value = props();
    render(<Timeline {...value} />);
    const content = await screen.findByTestId('timeline-content');
    const scroller = content.closest('.timeline-scroll') as HTMLDivElement;
    const ruler = content.querySelector('.timeline-ruler') as HTMLDivElement;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 0, left: 100, top: 0, right: 1100, bottom: 300, width: 1000, height: 300,
      toJSON: () => ({}),
    });
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperties(ruler, {
      setPointerCapture: { configurable: true, value: capture },
      releasePointerCapture: { configurable: true, value: release },
    });
    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);

    fireEvent.pointerDown(ruler, { pointerId: 7, clientX: 352 });
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 392 });
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 432 });
    fireEvent.pointerUp(ruler, { pointerId: 7, clientX: 432 });

    expect(value.onSeek.mock.calls.map(([time]) => time)).toEqual([10, 11, 12]);
    expect(capture).toHaveBeenCalledWith(7);
    expect(release).toHaveBeenCalledWith(7);

    fireEvent.change(screen.getByRole('slider', { name: '时间线缩放' }), { target: { value: '80' } });
    scroller.scrollLeft = 400;
    fireEvent.scroll(scroller);
    fireEvent.pointerDown(ruler, { pointerId: 8, clientX: 552 });
    fireEvent.pointerMove(ruler, { pointerId: 8, clientX: 632 });
    fireEvent.pointerUp(ruler, { pointerId: 8, clientX: 632 });
    expect(value.onSeek.mock.calls.slice(-2).map(([time]) => time)).toEqual([10, 11]);
  });
  it('renders canonical clip positions and widths in timeline pixels', () => {
    render(<Timeline {...props()} />);
    expect(screen.getByRole('button', { name: /花园漫步，12.0 秒/ })).toHaveStyle({ left: '0px', width: '480px' });
    expect(screen.getByRole('button', { name: /人物剪影，7.0 秒/ })).toHaveStyle({ left: '160px', width: '280px' });
  });

  it('adds visual and audio tracks with canonical kinds', async () => {
    const value = props();
    render(<Timeline {...value} />);
    await userEvent.click(screen.getByRole('button', { name: '添加视频轨道' }));
    await userEvent.click(screen.getByRole('button', { name: '添加音频轨道' }));
    expect(value.onAddTrack).toHaveBeenNthCalledWith(1, 'visual');
    expect(value.onAddTrack).toHaveBeenNthCalledWith(2, 'audio');
  });

  it('confirms deletion for a populated track', async () => {
    const value = props();
    render(<Timeline {...value} />);
    await userEvent.click(screen.getByRole('button', { name: '删除 V1' }));
    expect(screen.getByRole('dialog', { name: '删除轨道' })).toHaveTextContent('2 个片段');
    await userEvent.click(screen.getByRole('button', { name: '确认删除轨道' }));
    expect(value.onDeleteTrack).toHaveBeenCalledWith('video-1', true);
  });

  it('uses the shared playhead time and supports zoom', () => {
    render(<Timeline {...props()} />);
    expect(screen.getByRole('slider', { name: '时间线播放头' })).toHaveAttribute('aria-valuenow', '5');
    fireEvent.change(screen.getByRole('slider', { name: '时间线缩放' }), { target: { value: '80' } });
    expect(screen.getByRole('button', { name: /人物剪影，7.0 秒/ })).toHaveStyle({ left: '320px', width: '560px' });
  });

  it('keeps a horizontal scroll runway when the project is narrower than the viewport', async () => {
    render(<Timeline {...props()} duration={5} />);

    await waitFor(() => expect(screen.getByTestId('timeline-content')).toHaveStyle({ width: '1320px' }));
  });

  it('uses only the outer timeline scroller so the track area does not cover content', () => {
    render(<Timeline {...props()} />);

    const trackGrid = document.querySelector<HTMLElement>('.track-grid')!;
    expect(getComputedStyle(trackGrid).overflowY).toBe('visible');
    expect(getComputedStyle(trackGrid).height).toBe('auto');
  });

  it('grows the timeline content and keeps ruler marks bounded when zoomed in', async () => {
    render(<Timeline {...props()} />);

    fireEvent.change(screen.getByRole('slider', { name: '时间线缩放' }), { target: { value: '160' } });

    await waitFor(() => {
      expect(Number.parseFloat(screen.getByTestId('timeline-content').style.width)).toBeGreaterThan(1000);
      expect(document.querySelectorAll('.timeline-ruler > span').length).toBeLessThan(12);
    });
  });

  it('does not change content width after repeated horizontal scrolling', async () => {
    render(<Timeline {...props()} />);
    const content = await screen.findByTestId('timeline-content');
    const scroller = content.closest('.timeline-scroll') as HTMLDivElement;
    const initialWidth = content.style.width;

    scroller.scrollLeft = 800;
    fireEvent.scroll(scroller);
    scroller.scrollLeft = 1200;
    fireEvent.scroll(scroller);

    expect(content.style.width).toBe(initialWidth);
  });

  it('contains virtualized ruler ticks that extend beyond the content edge', async () => {
    render(<Timeline {...props()} />);
    const content = await screen.findByTestId('timeline-content');
    const scroller = content.closest('.timeline-scroll') as HTMLDivElement;
    const contentWidth = Number.parseFloat(content.style.width);
    scroller.scrollLeft = contentWidth - 1000;
    fireEvent.scroll(scroller);

    await waitFor(() => {
      const ruler = document.querySelector('.timeline-ruler') as HTMLDivElement;
      const tickPositions = Array.from(ruler.querySelectorAll<HTMLElement>('span'), (tick) => Number.parseFloat(tick.style.left));
      expect(Math.max(...tickPositions)).toBeGreaterThan(contentWidth);
      expect(getComputedStyle(ruler).overflow).toBe('hidden');
    });
  });

  it('anchors zoom at the viewport center when the playhead is offscreen', async () => {
    render(<Timeline {...props()} currentTime={0} />);
    const content = await screen.findByTestId('timeline-content');
    const scroller = content.closest('.timeline-scroll') as HTMLDivElement;
    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);
    const visuallyCenteredTime = (scroller.scrollLeft + 500 - 52) / 40;
    expect(52 + visuallyCenteredTime * 40 - scroller.scrollLeft).toBe(500);

    fireEvent.change(screen.getByRole('slider', { name: '时间线缩放' }), { target: { value: '80' } });

    await waitFor(() => expect(52 + visuallyCenteredTime * 80 - scroller.scrollLeft).toBe(500));
  });

  it('previews and commits the same dual-edge snapped clip position', () => {
    const value = props();
    render(<Timeline {...value} />);
    const clip = screen.getByRole('button', { name: /人物剪影，7.0 秒/ });

    fireEvent.pointerDown(clip, { pointerId: 1, clientX: 160, clientY: 80 });
    fireEvent.pointerMove(clip, { pointerId: 1, clientX: 199, clientY: 80 });

    expect(clip).toHaveStyle({ left: '200px' });
    expect(screen.getByTestId('timeline-snap-guide')).toHaveStyle({ left: '532px' });

    fireEvent.pointerUp(clip, { pointerId: 1, clientX: 199, clientY: 80 });

    expect(value.onEdit).toHaveBeenCalledWith({
      type: 'moveClip',
      clipId: 'clip-portrait',
      trackId: 'video-2',
      start: 5,
    });
    expect(screen.queryByTestId('timeline-snap-guide')).not.toBeInTheDocument();
  });

  it('clears the snap guide without committing on pointer cancel', () => {
    const value = props();
    render(<Timeline {...value} />);
    const clip = screen.getByRole('button', { name: /人物剪影，7.0 秒/ });

    fireEvent.pointerDown(clip, { pointerId: 2, clientX: 160, clientY: 80 });
    fireEvent.pointerMove(clip, { pointerId: 2, clientX: 199, clientY: 80 });
    expect(screen.getByTestId('timeline-snap-guide')).toBeInTheDocument();

    fireEvent.pointerCancel(clip, { pointerId: 2, clientX: 199, clientY: 80 });

    expect(screen.queryByTestId('timeline-snap-guide')).not.toBeInTheDocument();
    expect(value.onEdit).not.toHaveBeenCalled();
  });

  it('prefers snap targets on the pointer target track when distances tie', () => {
    const value = props();
    value.state.clips = {
      moving: { id: 'moving', assetId: 'portrait', trackId: 'video-2', start: 4, duration: 2, sourceIn: 0 },
      preferred: { id: 'preferred', assetId: 'garden', trackId: 'video-1', start: 5.1, duration: 1, sourceIn: 0 },
      other: { id: 'other', assetId: 'waves', trackId: 'video-2', start: 4.9, duration: 1, sourceIn: 0 },
    };
    const targetLane = document.createElement('div');
    targetLane.dataset.trackId = 'video-1';
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => targetLane) });

    try {
      render(<Timeline {...value} />);
      const clip = screen.getByRole('button', { name: /人物剪影，2.0 秒/ });

      fireEvent.pointerDown(clip, { pointerId: 3, clientX: 160, clientY: 80 });
      fireEvent.pointerMove(clip, { pointerId: 3, clientX: 200, clientY: 80 });

      expect(clip).toHaveStyle({ left: '204px' });
      expect(screen.getByTestId('timeline-snap-guide')).toHaveStyle({ left: '256px' });

      fireEvent.pointerUp(clip, { pointerId: 3, clientX: 200, clientY: 80 });
      expect(value.onEdit).toHaveBeenCalledWith({
        type: 'moveClip',
        clipId: 'moving',
        trackId: 'video-1',
        start: 5.1,
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
    }
  });

  it('does not commit a visual clip to an audio track and marks the lane as incompatible', () => {
    const value = props();
    const audioLane = document.createElement('div');
    audioLane.dataset.trackId = 'audio-1';
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => audioLane) });

    try {
      render(<Timeline {...value} />);
      const clip = screen.getByRole('button', { name: /人物剪影，7.0 秒/ });
      const renderedAudioLane = document.querySelector<HTMLElement>('[data-track-id="audio-1"]')!;

      fireEvent.pointerDown(clip, { pointerId: 4, clientX: 160, clientY: 80 });
      fireEvent.pointerMove(clip, { pointerId: 4, clientX: 200, clientY: 190 });

      expect(renderedAudioLane).toHaveClass('is-incompatible-drop');
      expect(clip).toHaveClass('is-invalid-drop');

      fireEvent.pointerUp(clip, { pointerId: 4, clientX: 200, clientY: 190 });
      expect(value.onEdit).not.toHaveBeenCalled();
      expect(renderedAudioLane).not.toHaveClass('is-incompatible-drop');
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
    }
  });

  it('deletes the selected clip with Delete or Backspace unless text input is active', () => {
    const value = props();
    render(<Timeline {...value} />);

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(value.onEdit).toHaveBeenCalledWith({ type: 'deleteClip', clipId: 'clip-garden' });

    value.onEdit.mockClear();
    const input = screen.getByRole('slider', { name: '时间线缩放' });
    input.focus();
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(value.onEdit).not.toHaveBeenCalled();
  });

  it('dispatches an asset drop as a semantic insertion at the pointer time and target track', () => {
    const value = props();
    render(<Timeline {...value} />);
    const lane = document.querySelector<HTMLElement>('[data-track-id="video-1"]')!;
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 0, left: 100, top: 0, right: 900, bottom: 40, width: 800, height: 40,
      toJSON: () => ({}),
    });

    const drop = createEvent.drop(lane);
    Object.defineProperties(drop, {
      clientX: { value: 220 },
      dataTransfer: { value: { getData: () => 'portrait' } },
    });
    fireEvent(lane, drop);

    expect(value.onInsertAsset).toHaveBeenCalledWith({
      type: 'insert-asset-at-playhead',
      assetId: 'portrait',
      playheadTime: 3,
      preferredTrackId: 'video-1',
    });
    expect(value.onEdit).not.toHaveBeenCalled();
  });
});
