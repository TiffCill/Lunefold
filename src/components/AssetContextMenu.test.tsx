import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetContextMenu } from './AssetContextMenu';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const callbacks = () => ({
  onAddToConversation: vi.fn(),
  onAddToTimeline: vi.fn(),
  onReveal: vi.fn(),
  onClose: vi.fn(),
});

describe('AssetContextMenu', () => {
  it('clamps the measured menu inside the viewport and invokes actions with the opaque media ID', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return this.getAttribute('role') === 'menu'
        ? ({ width: 180, height: 120, top: 0, left: 0, right: 180, bottom: 120, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
        : ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    vi.stubGlobal('innerWidth', 320);
    vi.stubGlobal('innerHeight', 240);
    const handlers = callbacks();

    render(<AssetContextMenu mediaId="opaque-17" anchor={{ x: 310, y: 230 }} canReveal {...handlers} />);

    const menu = await screen.findByRole('menu', { name: '素材操作' });
    await waitFor(() => {
      expect(menu).toHaveStyle({ left: '132px', top: '112px' });
    });
    expect(screen.getByRole('menuitem', { name: '添加到会话' })).toHaveFocus();

    vi.stubGlobal('innerWidth', 240);
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(menu).toHaveStyle({ left: '52px', top: '112px' }));

    await userEvent.click(screen.getByRole('menuitem', { name: '添加到时间线' }));
    expect(handlers.onAddToTimeline).toHaveBeenCalledWith('opaque-17');
    fireEvent.animationEnd(menu);
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));
  });

  it('cycles only enabled actions with the keyboard and activates the focused item', async () => {
    const handlers = callbacks();
    render(<AssetContextMenu mediaId="demo-1" anchor={{ x: 40, y: 50 }} canReveal={false} {...handlers} />);

    const addConversation = screen.getByRole('menuitem', { name: '添加到会话' });
    const addTimeline = screen.getByRole('menuitem', { name: '添加到时间线' });
    const reveal = screen.getByRole('menuitem', { name: '在文件夹中显示' });
    expect(reveal).toBeDisabled();
    expect(reveal).toHaveAttribute('title', '此素材没有可定位的本地源文件');

    await waitFor(() => expect(addConversation).toHaveFocus());
    fireEvent.keyDown(addConversation, { key: 'ArrowUp' });
    expect(addTimeline).toHaveFocus();
    fireEvent.keyDown(addTimeline, { key: 'Home' });
    expect(addConversation).toHaveFocus();
    fireEvent.keyDown(addConversation, { key: 'End' });
    expect(addTimeline).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(handlers.onAddToTimeline).toHaveBeenCalledWith('demo-1');
    expect(handlers.onAddToTimeline).toHaveBeenCalledTimes(1);
    expect(handlers.onReveal).not.toHaveBeenCalled();
  });

  it('closes on Escape, outside pointer down, and viewport blur', async () => {
    const escapeHandlers = callbacks();
    const first = render(<AssetContextMenu mediaId="asset-a" anchor={{ x: 10, y: 10 }} canReveal {...escapeHandlers} />);
    const escapeMenu = screen.getByRole('menu');
    fireEvent.keyDown(escapeMenu, { key: 'Escape' });
    expect(escapeMenu).toHaveClass('is-closing');
    expect(escapeHandlers.onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(escapeMenu);
    await waitFor(() => expect(escapeHandlers.onClose).toHaveBeenCalledTimes(1));
    first.unmount();

    const outsideHandlers = callbacks();
    const second = render(<AssetContextMenu mediaId="asset-b" anchor={{ x: 10, y: 10 }} canReveal {...outsideHandlers} />);
    fireEvent.pointerDown(document.body);
    fireEvent.animationEnd(document.querySelector('.asset-context-menu')!);
    await waitFor(() => expect(outsideHandlers.onClose).toHaveBeenCalledTimes(1));
    second.unmount();

    const blurHandlers = callbacks();
    render(<AssetContextMenu mediaId="asset-c" anchor={{ x: 10, y: 10 }} canReveal {...blurHandlers} />);
    fireEvent.blur(window);
    fireEvent.animationEnd(document.querySelector('.asset-context-menu')!);
    await waitFor(() => expect(blurHandlers.onClose).toHaveBeenCalledTimes(1));
  });

  it('uses a short fallback to complete cleanup when animation events are unavailable', () => {
    vi.useFakeTimers();
    const handlers = callbacks();
    render(<AssetContextMenu mediaId="fallback" anchor={{ x: 10, y: 10 }} canReveal {...handlers} />);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(handlers.onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);

    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('supports ArrowDown and Space activation without visiting disabled items', async () => {
    const handlers = callbacks();
    render(<AssetContextMenu mediaId="demo-keyboard" anchor={{ x: 20, y: 20 }} canReveal={false} {...handlers} />);

    const addConversation = screen.getByRole('menuitem', { name: '添加到会话' });
    const addTimeline = screen.getByRole('menuitem', { name: '添加到时间线' });
    await waitFor(() => expect(addConversation).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(addTimeline).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(addConversation).toHaveFocus();
    await userEvent.keyboard(' ');

    expect(handlers.onAddToConversation).toHaveBeenCalledOnce();
    expect(handlers.onReveal).not.toHaveBeenCalled();
  });
});
