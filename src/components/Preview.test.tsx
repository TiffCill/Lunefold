import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDemoProject } from '../timeline/fixtures';
import { resolveProgramState } from '../program/resolveProgramFrame';
import { Preview } from './Preview';

const playback = { status: 'paused' as const, currentTime: 5, duration: 28, selectedMediaId: 'timeline-program' };

describe('Preview', () => {
  it('shows black only when the timeline has no visual at project time', () => {
    render(<Preview program={resolveProgramState(createDemoProject(), 12.5)} playback={{ ...playback, currentTime: 12.5 }} onTogglePlayback={vi.fn()} onSeek={vi.fn()} onStepFrame={vi.fn()} />);
    expect(screen.getByText('时间线空白')).toBeInTheDocument();
  });

  it('renders the highest timeline visual and delegates controls', () => {
    const toggle = vi.fn();
    render(<Preview program={resolveProgramState(createDemoProject(), 5)} playback={playback} onTogglePlayback={toggle} onSeek={vi.fn()} onStepFrame={vi.fn()} />);
    expect(screen.getByRole('img', { name: '人物剪影预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('seeks the shared project clock', () => {
    const seek = vi.fn();
    render(<Preview program={resolveProgramState(createDemoProject(), 5)} playback={playback} onTogglePlayback={vi.fn()} onSeek={seek} onStepFrame={vi.fn()} />);
    fireEvent.change(screen.getByRole('slider', { name: '播放进度' }), { target: { value: '10' } });
    expect(seek).toHaveBeenCalledWith(10);
  });

  it('does not repeatedly seek an audio element while playback advances', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const project = createDemoProject();
    const { rerender } = render(<Preview program={resolveProgramState(project, 5)} playback={{ ...playback, status: 'playing', currentTime: 5 }} onTogglePlayback={vi.fn()} onSeek={vi.fn()} onStepFrame={vi.fn()} />);
    const audio = screen.getByLabelText('Midnight Drive音频') as HTMLAudioElement;
    expect(audio.currentTime).toBe(5);

    rerender(<Preview program={resolveProgramState(project, 5.1)} playback={{ ...playback, status: 'playing', currentTime: 5.1 }} onTogglePlayback={vi.fn()} onSeek={vi.fn()} onStepFrame={vi.fn()} />);

    expect(audio.currentTime).toBe(5);
  });

  it('renders an asset preview instead of the timeline program', () => {
    render(<Preview program={resolveProgramState(createDemoProject(), 5)} playback={playback} asset={{ id: 'i1', name: 'still.png', kind: 'image', src: '/still.png' }} onTogglePlayback={vi.fn()} onSeek={vi.fn()} onStepFrame={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'still.png素材预览' })).toBeVisible();
    expect(screen.queryByRole('img', { name: '人物剪影预览' })).toBeNull();
  });
});
