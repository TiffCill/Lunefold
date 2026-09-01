import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([
      {
        target,
        contentRect: {
          width: 1000,
          height: 300,
          top: 0,
          right: 1000,
          bottom: 300,
          left: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
      } as ResizeObserverEntry,
    ], this as unknown as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
}

afterEach(cleanup);
