import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createDirectoryStore,
  type DirectoryStore,
  type StoredDirectoryHandle,
} from './directoryStore';
import { classifyMedia, createMediaId, type LegacyBrowserDirectoryMediaItem } from './mediaTypes';

export interface FileSystemFileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

export interface FileSystemDirectoryHandleLike extends StoredDirectoryHandle {
  values(): AsyncIterable<FileSystemHandleLike>;
  queryPermission?(options?: { mode?: 'read' }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: 'read' }): Promise<PermissionState>;
}

export type FileSystemHandleLike = FileSystemFileHandleLike | FileSystemDirectoryHandleLike;
export type MediaLibraryStatus =
  | 'unsupported'
  | 'unselected'
  | 'permission-needed'
  | 'scanning'
  | 'ready'
  | 'empty'
  | 'denied'
  | 'partial-error';

export interface MediaUrlApi {
  createObjectURL(file: File): string;
  revokeObjectURL(url: string): void;
}

export interface DirectoryScanResult {
  items: LegacyBrowserDirectoryMediaItem[];
  ignoredCount: number;
  errorCount: number;
}

export interface MediaLibraryOptions {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
  store?: DirectoryStore<FileSystemDirectoryHandleLike>;
  urlApi?: MediaUrlApi;
}

function defaultPicker(): (() => Promise<FileSystemDirectoryHandleLike>) | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike> }).showDirectoryPicker;
}

function defaultUrlApi(): MediaUrlApi {
  return {
    createObjectURL: (file) => URL.createObjectURL(file),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

async function scanEntries(
  directory: FileSystemDirectoryHandleLike,
  relativeDirectory: string,
  urlApi: MediaUrlApi,
  result: DirectoryScanResult,
): Promise<void> {
  try {
    for await (const entry of directory.values()) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;

      if (entry.kind === 'directory') {
        await scanEntries(entry, relativePath, urlApi, result);
        continue;
      }

      try {
        const file = await entry.getFile();
        const kind = classifyMedia(file);
        if (!kind) {
          result.ignoredCount += 1;
          continue;
        }

        result.items.push({
          id: createMediaId(relativePath, file),
          name: file.name,
          kind,
          file,
          objectUrl: urlApi.createObjectURL(file),
          size: file.size,
          modifiedAt: file.lastModified,
        });
      } catch {
        result.errorCount += 1;
      }
    }
  } catch {
    result.errorCount += 1;
  }
}

export async function scanDirectory(
  directory: FileSystemDirectoryHandleLike,
  urlApi: MediaUrlApi = defaultUrlApi(),
): Promise<DirectoryScanResult> {
  const result: DirectoryScanResult = { items: [], ignoredCount: 0, errorCount: 0 };
  await scanEntries(directory, '', urlApi, result);
  return result;
}

function revokeItems(items: readonly LegacyBrowserDirectoryMediaItem[], urlApi: MediaUrlApi): void {
  for (const item of items) urlApi.revokeObjectURL(item.objectUrl);
}

export function useMediaLibrary(options: MediaLibraryOptions = {}) {
  const [items, setItems] = useState<LegacyBrowserDirectoryMediaItem[]>([]);
  const [status, setStatus] = useState<MediaLibraryStatus>('unselected');
  const [ignoredCount, setIgnoredCount] = useState(0);
  const urlApiRef = useRef<MediaUrlApi>(options.urlApi ?? defaultUrlApi());
  const storeRef = useRef<DirectoryStore<FileSystemDirectoryHandleLike>>(
    options.store ?? createDirectoryStore<FileSystemDirectoryHandleLike>(),
  );
  const itemsRef = useRef<LegacyBrowserDirectoryMediaItem[]>([]);
  const scanIdRef = useRef(0);
  const mountedRef = useRef(true);

  const clearItems = useCallback(() => {
    revokeItems(itemsRef.current, urlApiRef.current);
    itemsRef.current = [];
    setItems([]);
  }, []);

  const scan = useCallback(async (directory: FileSystemDirectoryHandleLike) => {
    const scanId = ++scanIdRef.current;
    clearItems();
    setIgnoredCount(0);
    setStatus('scanning');
    const result = await scanDirectory(directory, urlApiRef.current);

    if (!mountedRef.current || scanId !== scanIdRef.current) {
      revokeItems(result.items, urlApiRef.current);
      return;
    }

    itemsRef.current = result.items;
    setItems(result.items);
    setIgnoredCount(result.ignoredCount);
    setStatus(result.errorCount > 0 ? 'partial-error' : result.items.length > 0 ? 'ready' : 'empty');
  }, [clearItems]);

  const chooseDirectory = useCallback(async () => {
    const picker = options.showDirectoryPicker ?? defaultPicker();
    if (!picker) {
      setStatus('unsupported');
      return;
    }

    try {
      const directory = await picker();
      const permission = directory.requestPermission ? await directory.requestPermission({ mode: 'read' }) : 'granted';
      if (permission !== 'granted') {
        setStatus('denied');
        return;
      }

      await storeRef.current.save(directory);
      await scan(directory);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('unselected');
        return;
      }
      setStatus('partial-error');
    }
  }, [options.showDirectoryPicker, scan]);

  const restoreDirectory = useCallback(async (requestAccess = false) => {
    let directory: FileSystemDirectoryHandleLike | null;
    try {
      directory = await storeRef.current.load();
    } catch {
      setStatus('unselected');
      return;
    }

    if (!directory) {
      setStatus('unselected');
      return;
    }

    try {
      let permission = directory.queryPermission ? await directory.queryPermission({ mode: 'read' }) : 'granted';
      if (permission === 'prompt' && requestAccess && directory.requestPermission) {
        permission = await directory.requestPermission({ mode: 'read' });
      }
      if (permission === 'granted') {
        await scan(directory);
      } else if (permission === 'denied') {
        setStatus('denied');
      } else {
        setStatus('permission-needed');
      }
    } catch {
      setStatus('partial-error');
    }
  }, [scan]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scanIdRef.current += 1;
      revokeItems(itemsRef.current, urlApiRef.current);
      itemsRef.current = [];
    };
  }, []);

  return { items, status, ignoredCount, chooseDirectory, restoreDirectory };
}
