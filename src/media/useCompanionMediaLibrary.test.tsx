import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';

import { useCompanionMediaLibrary } from './useCompanionMediaLibrary';
import type { CompanionMediaItem, LegacyBrowserDirectoryMediaItem } from './mediaTypes';

const serverVideo = {
  id: 'clip/id',
  name: 'clip.mp4',
  relativePath: 'nested/clip.mp4',
  kind: 'video' as const,
  size: 2048,
  modifiedAt: 42,
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCompanionMediaLibrary', () => {
  test('keeps companion metadata structurally separate from browser File handles and absolute paths', () => {
    expectTypeOf<'file' extends keyof CompanionMediaItem ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'absolutePath' extends keyof CompanionMediaItem ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'file' extends keyof LegacyBrowserDirectoryMediaItem ? true : false>().toEqualTypeOf<true>();
  });

  test('restores companion items on mount with an encoded content URL and no local file data', async () => {
    const fetcher = vi.fn(async () => json({ items: [{ ...serverVideo, absolutePath: '/Users/private/clip.mp4' }] }));
    vi.stubGlobal('fetch', fetcher);

    const { result } = renderHook(() => useCompanionMediaLibrary());

    expect(result.current.status).toBe('scanning');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toEqual([{
      ...serverVideo,
      contentUrl: '/api/media/clip%2Fid/content',
      objectUrl: '/api/media/clip%2Fid/content',
      durationStatus: 'pending',
    }]);
    expect(result.current.items[0]).not.toHaveProperty('file');
    expect(JSON.stringify(result.current.items)).not.toContain('/Users/');
  });

  test('reports an empty companion directory after the initial restoration', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], directoryConfigured: true })));

    const { result } = renderHook(() => useCompanionMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.items).toEqual([]);
  });

  test('reports an unselected library when no media directory is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [], directoryConfigured: false })));

    const { result } = renderHook(() => useCompanionMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe('unselected'));
    expect(result.current.items).toEqual([]);
  });

  test('refreshes the catalogue after selecting a directory', async () => {
    let listCount = 0;
    const pickedAudio = { ...serverVideo, id: 'score', name: 'score.mp3', relativePath: 'score.mp3', kind: 'audio' as const };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/media-library/select-directory') {
        expect(init?.method).toBe('POST');
        return json({ status: 'selected' });
      }
      listCount += 1;
      return json({ items: listCount === 1 ? [serverVideo] : [pickedAudio] });
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCompanionMediaLibrary());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.chooseDirectory();
    });

    expect(result.current.items.map((item) => item.name)).toEqual(['score.mp3']);
    expect(listCount).toBe(2);
  });

  test('preserves the current items and state when directory selection is cancelled', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/media-library/select-directory'
      ? json({ status: 'cancelled' })
      : json({ items: [serverVideo] }));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCompanionMediaLibrary());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.chooseDirectory();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.items.map((item) => item.id)).toEqual(['clip/id']);
    expect(fetcher.mock.calls.filter(([input]) => String(input) === '/api/media-library')).toHaveLength(1);
  });

  test('allows only one native directory picker request at a time', async () => {
    let finishSelection!: (response: Response) => void;
    let listCount = 0;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/media-library/select-directory') {
        return new Promise<Response>((resolve) => { finishSelection = resolve; });
      }
      listCount += 1;
      return Promise.resolve(json({ items: [serverVideo] }));
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCompanionMediaLibrary());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.chooseDirectory();
      second = result.current.chooseDirectory();
    });
    expect(fetcher.mock.calls.filter(([input]) => String(input) === '/api/media-library/select-directory')).toHaveLength(1);

    finishSelection(json({ status: 'selected' }));
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(listCount).toBe(2);
    expect(result.current.status).toBe('ready');
  });

  test('surfaces a safe reveal error without leaking a filesystem path', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/reveal')
      ? json({ error: { code: 'internal_error', message: 'open failed: /Users/private/movie.mp4' } }, 500)
      : json({ items: [serverVideo] }));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCompanionMediaLibrary());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let failure: unknown;
    await act(async () => {
      try {
        await result.current.reveal('clip/id');
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toMatchObject({ code: 'request_failed', message: '无法在 Finder 中显示素材' });
    expect(String(failure)).not.toContain('/Users/private');
    expect(result.current.status).toBe('ready');
    expect(result.current.actionError).toBe('无法在 Finder 中显示素材');
    expect(result.current.items).toHaveLength(1);
  });

  test('probes finite video and audio duration while skipping images', async () => {
    const items = [
      serverVideo,
      { ...serverVideo, id: 'audio', name: 'score.mp3', relativePath: 'score.mp3', kind: 'audio' as const },
      { ...serverVideo, id: 'image', name: 'still.png', relativePath: 'still.png', kind: 'image' as const },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => json({ items })));
    const probeDuration = vi.fn(async (item: { id: string }) => item.id === 'audio' ? 7265.25 : 1.25);

    const { result } = renderHook(() => useCompanionMediaLibrary({ probeDuration }));

    await waitFor(() => {
      expect(result.current.items).toHaveLength(3);
      expect(result.current.items.every((item) => item.durationStatus !== 'pending')).toBe(true);
    });
    expect(result.current.items.map((item) => ({ id: item.id, duration: item.duration, status: item.durationStatus }))).toEqual([
      { id: 'clip/id', duration: 1.25, status: 'ready' },
      { id: 'audio', duration: 7265.25, status: 'ready' },
      { id: 'image', duration: undefined, status: 'not-applicable' },
    ]);
    expect(probeDuration).toHaveBeenCalledTimes(2);
  });

  test('marks invalid metadata as failed and ignores an obsolete probe after refresh', async () => {
    let listCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [{
      ...serverVideo,
      id: listCount++ === 0 ? 'old' : 'new',
    }] })));
    let resolveOld!: (duration: number) => void;
    const probeDuration = vi.fn((item: { id: string }) => item.id === 'old'
      ? new Promise<number>((resolve) => { resolveOld = resolve; })
      : Promise.resolve(Number.POSITIVE_INFINITY));
    const { result } = renderHook(() => useCompanionMediaLibrary({ probeDuration }));
    await waitFor(() => expect(result.current.items[0]?.id).toBe('old'));

    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.items[0]).toMatchObject({ id: 'new', durationStatus: 'failed' }));
    resolveOld(33);
    await act(async () => { await Promise.resolve(); });

    expect(result.current.items[0]).toMatchObject({ id: 'new', durationStatus: 'failed' });
    expect(result.current.items[0].duration).toBeUndefined();
  });

  test('maps an unavailable directory to recovery state without creating an action error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      error: { code: 'directory_unavailable', message: 'failed at /Users/private/media' },
    }, 503)));

    const { result } = renderHook(() => useCompanionMediaLibrary());

    await waitFor(() => expect(result.current.status).toBe('reselect-required'));
    expect(result.current.directoryError).toBe('素材目录不可用，请重新选择素材目录');
    expect(result.current.actionError).toBeNull();
    expect(JSON.stringify(result.current)).not.toContain('/Users/private');
  });

  test('clears a prior reveal action error after a successful reveal', async () => {
    let revealCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/reveal')) return json({ items: [serverVideo] });
      revealCount += 1;
      return revealCount === 1
        ? json({ error: { code: 'internal_error', message: '/Users/private' } }, 500)
        : json({ status: 'revealed' });
    }));
    const { result } = renderHook(() => useCompanionMediaLibrary());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await expect(result.current.reveal(serverVideo.id)).rejects.toBeDefined(); });
    expect(result.current.actionError).not.toBeNull();

    await act(async () => { await result.current.reveal(serverVideo.id); });

    expect(result.current.status).toBe('ready');
    expect(result.current.actionError).toBeNull();
  });

  test('ignores stale list responses and state updates after unmount', async () => {
    let resolveInitial!: (response: Response) => void;
    const initial = new Promise<Response>((resolve) => { resolveInitial = resolve; });
    const fetcher = vi.fn()
      .mockImplementationOnce(() => initial)
      .mockResolvedValueOnce(json({ items: [{ ...serverVideo, id: 'new', name: 'new.mp4' }] }));
    vi.stubGlobal('fetch', fetcher);
    const { result, unmount } = renderHook(() => useCompanionMediaLibrary());

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.items.map((item) => item.id)).toEqual(['new']);

    resolveInitial(json({ items: [{ ...serverVideo, id: 'stale', name: 'stale.mp4' }] }));
    await act(async () => { await initial; });
    expect(result.current.items.map((item) => item.id)).toEqual(['new']);

    let resolveAfterUnmount!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveAfterUnmount = resolve; }));
    let refreshAfterUnmount!: Promise<void>;
    act(() => {
      refreshAfterUnmount = result.current.refresh();
    });
    unmount();
    resolveAfterUnmount(json({ items: [] }));
    await refreshAfterUnmount;
  });

  test('silently refreshes a visible library on an interval and immediately on window focus', async () => {
    vi.useFakeTimers();
    let listCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      listCount += 1;
      const items = listCount === 1
        ? [serverVideo]
        : [{ ...serverVideo, id: `new-${listCount}`, name: `new-${listCount}.mp4` }];
      return json({ items });
    }));
    const { result } = renderHook(() => useCompanionMediaLibrary({ refreshIntervalMs: 3_000, probeDuration: async () => 1 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.status).toBe('ready');

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(result.current.status).toBe('ready');
    expect(result.current.items[0]?.name).toBe('new-2.mp4');

    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    expect(result.current.items[0]?.name).toBe('new-3.mp4');
  });
});
