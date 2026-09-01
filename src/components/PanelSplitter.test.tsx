import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { PanelSplitter } from './PanelSplitter';

describe('PanelSplitter', () => {
  test('reports vertical pointer movement at a one-to-one pixel ratio and commits once on release', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<PanelSplitter orientation="vertical" value={300} min={180} max={420} onChange={onChange} onCommit={onCommit} />);
    const splitter = screen.getByRole('separator');

    fireEvent.pointerDown(splitter, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 132 });
    fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 132 });

    expect(onChange).toHaveBeenLastCalledWith(332);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(332);
  });

  test('uses a soft boundary while dragging and commits the legal boundary on release', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<PanelSplitter orientation="vertical" value={200} min={180} max={420} onChange={onChange} onCommit={onCommit} />);
    const splitter = screen.getByRole('separator');

    fireEvent.pointerDown(splitter, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 0 });
    const draggedValue = onChange.mock.lastCall?.[0];
    fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 0 });

    expect(draggedValue).toBeGreaterThan(100);
    expect(draggedValue).toBeLessThan(180);
    expect(onCommit).toHaveBeenCalledWith(180);
  });

  test('adjusts a focused vertical splitter by 8 pixels or 32 pixels with Shift', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<PanelSplitter orientation="vertical" value={300} min={180} max={420} onChange={onChange} onCommit={onCommit} />);
    const splitter = screen.getByRole('separator');

    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });

    expect(onChange).toHaveBeenNthCalledWith(1, 308);
    expect(onChange).toHaveBeenNthCalledWith(2, 268);
    expect(onCommit).toHaveBeenNthCalledWith(1, 308);
    expect(onCommit).toHaveBeenNthCalledWith(2, 268);
  });

  test('publishes horizontal separator semantics and supports inverted arrows', () => {
    const onChange = vi.fn();
    render(<PanelSplitter orientation="horizontal" value={300} min={200} max={500} invert onChange={onChange} onCommit={vi.fn()} />);
    const splitter = screen.getByRole('separator');

    fireEvent.keyDown(splitter, { key: 'ArrowDown' });

    expect(splitter).toHaveAttribute('aria-orientation', 'horizontal');
    expect(splitter).toHaveAttribute('aria-valuemin', '200');
    expect(splitter).toHaveAttribute('aria-valuemax', '500');
    expect(splitter).toHaveAttribute('aria-valuenow', '300');
    expect(onChange).toHaveBeenCalledWith(292);
  });
});
