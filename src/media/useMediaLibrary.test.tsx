import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { DirectoryStore } from './directoryStore';
import type { MediaUrlApi } from './useMediaLibrary';
import { scanDirectory, useMediaLibrary, type FileSystemDirectoryHandleLike } from './useMediaLibrary';

function fileHandle(name: string, file: File) {
  return { kind: 'file' as const, name, getFile: async () => file };
}

function directory(name: string, entries: unknown[]): FileSystemDirectoryHandleLike {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* entries as never[];
    },
  };
}

const urlApi: MediaUrlApi & { created: string[]; revoked: string[] } = {
  created: [],
  revoked: [],
  createObjectURL(file) {
    const url = `blob:${file.name}:${this.created.length}`;
    this.created.push(url);
    return url;
  },
  revokeObjectURL(url) {
    this.revoked.push(url);
  },
};

describe('media directory scanning', () => {
  test('recursively collects supported files while isolating individual file failures', async () => {
    const directoryHandle = directory('root', [
      fileHandle('clip.mp4', new File(['video'], 'clip.mp4', { type: 'video/mp4', lastModified: 11 })),
      fileHandle('notes.txt', new File(['notes'], 'notes.txt', { type: 'text/plain' })),
      { kind: 'file' as const, name: 'broken.mp3', getFile: async () => Promise.reject(new Error('unreadable')) },
      directory('nested', [fileHandle('cover.png', new File(['image'], 'cover.png', { type: 'image/png', lastModified: 12 }))]),
    ]);

    const result = await scanDirectory(directoryHandle, urlApi);

    expect(result.items.map((item) => item.name)).toEqual(['clip.mp4', 'cover.png']);
    expect(result.ignoredCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.items[1].id).toContain('nested/cover.png');
  });

  test('revokes active object URLs when the library unmounts', async () => {
    const pickedDirectory = directory('root', [
      fileHandle('score.mp3', new File(['audio'], 'score.mp3', { type: 'audio/mpeg' })),
    ]);
    const store: DirectoryStore<FileSystemDirectoryHandleLike> = {
      load: async () => null,
      save: async () => undefined,
    };
    const { result, unmount } = renderHook(() => useMediaLibrary({
      showDirectoryPicker: async () => pickedDirectory,
      store,
      urlApi,
    }));

    await act(async () => {
      await result.current.chooseDirectory();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toHaveLength(1);

    unmount();
    expect(urlApi.revoked).toContain(result.current.items[0].objectUrl);
  });

  test('continues scanning after the StrictMode effect replay', async () => {
    const pickedDirectory = directory('root', [fileHandle('clip.mp4', new File(['video'], 'clip.mp4', { type: 'video/mp4' }))]);
    const store: DirectoryStore<FileSystemDirectoryHandleLike> = { load: async () => null, save: async () => undefined };
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useMediaLibrary({ showDirectoryPicker: async () => pickedDirectory, store, urlApi }), { wrapper });
    await act(async () => { await result.current.chooseDirectory(); });
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toHaveLength(1);
  });

  test('requests permission when restoring from an explicit user action', async () => {
    let requested = 0;
    const stored = { ...directory('root', [fileHandle('score.mp3', new File(['audio'], 'score.mp3', { type: 'audio/mpeg' }))]), queryPermission: async () => 'prompt' as PermissionState, requestPermission: async () => { requested += 1; return 'granted' as PermissionState; } };
    const store: DirectoryStore<FileSystemDirectoryHandleLike> = { load: async () => stored, save: async () => undefined };
    const { result } = renderHook(() => useMediaLibrary({ store, urlApi }));
    await act(async () => { await result.current.restoreDirectory(); });
    expect(result.current.status).toBe('permission-needed');
    await act(async () => { await result.current.restoreDirectory(true); });
    expect(requested).toBe(1);
    expect(result.current.status).toBe('ready');
  });
});
