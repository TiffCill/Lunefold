import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CompanionApiError,
  companionApi,
  type CompanionMediaMetadata,
} from '../api/companion';
import type { CompanionMediaItem } from './mediaTypes';

export type CompanionMediaLibraryStatus = 'scanning' | 'unselected' | 'ready' | 'empty' | 'partial-error' | 'reselect-required';
export type CompanionMediaLibraryErrorCode = 'directory_unavailable' | 'media_not_found' | 'request_failed';
export type DurationProbe = (item: CompanionMediaItem, signal: AbortSignal) => Promise<number>;

export interface CompanionMediaLibraryOptions {
  probeDuration?: DurationProbe;
  refreshIntervalMs?: number;
}

export class MediaLibraryRequestError extends Error {
  constructor(public readonly code: CompanionMediaLibraryErrorCode, message: string) {
    super(message);
    this.name = 'MediaLibraryRequestError';
  }
}

function safeError(error: unknown, fallbackMessage: string): MediaLibraryRequestError {
  const code = error instanceof CompanionApiError && (
    error.code === 'directory_unavailable' || error.code === 'media_not_found'
  ) ? error.code : 'request_failed';
  const message = code === 'directory_unavailable'
    ? '素材目录不可用'
    : code === 'media_not_found'
      ? '素材不存在'
      : fallbackMessage;
  return new MediaLibraryRequestError(code, message);
}

function toMediaItem(item: CompanionMediaMetadata): CompanionMediaItem {
  const contentUrl = `/api/media/${encodeURIComponent(item.id)}/content`;
  return {
    id: item.id,
    name: item.name,
    relativePath: item.relativePath,
    kind: item.kind,
    size: item.size,
    modifiedAt: item.modifiedAt,
    contentUrl,
    // Retained while the existing asset grid migrates from browser object URLs.
    objectUrl: contentUrl,
    durationStatus: item.kind === 'image' ? 'not-applicable' : 'pending',
  };
}

export function probeBrowserMediaDuration(item: CompanionMediaItem, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || item.kind === 'image') {
      reject(new Error('media_metadata_unavailable'));
      return;
    }
    const element = document.createElement(item.kind === 'audio' ? 'audio' : 'video');
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute('src');
    };
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('invalid_media_duration'));
    };
    const abort = () => finish();
    const timeout = setTimeout(() => finish(), 8_000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => finish(element.duration);
    element.onerror = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    element.src = item.contentUrl;
    element.load();
  });
}

export function useCompanionMediaLibrary(options: CompanionMediaLibraryOptions = {}) {
  const [items, setItems] = useState<CompanionMediaItem[]>([]);
  const [status, setStatus] = useState<CompanionMediaLibraryStatus>('scanning');
  const [errorCode, setErrorCode] = useState<CompanionMediaLibraryErrorCode | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const selectionIdRef = useRef(0);
  const selectionPromiseRef = useRef<Promise<void> | null>(null);
  const probeAbortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<CompanionMediaItem[]>([]);
  const hasLoadedRef = useRef(false);
  const directoryConfiguredRef = useRef<boolean | null>(null);
  const pollingRef = useRef(false);
  const probeDurationRef = useRef<DurationProbe>(options.probeDuration ?? probeBrowserMediaDuration);
  probeDurationRef.current = options.probeDuration ?? probeBrowserMediaDuration;

  const refresh = useCallback(async (refreshOptions: { silent?: boolean } = {}) => {
    const requestId = ++requestIdRef.current;
    probeAbortRef.current?.abort();
    const probeController = new AbortController();
    probeAbortRef.current = probeController;
    if (mountedRef.current && !refreshOptions.silent) {
      setStatus('scanning');
      setErrorCode(null);
      setDirectoryError(null);
    }
    try {
      const response = await companionApi.listMedia();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const nextItems = response.items.map(toMediaItem);
      const directoryConfigured = response.directoryConfigured ?? response.items.length > 0;
      const nextStatus: CompanionMediaLibraryStatus = directoryConfigured
        ? (nextItems.length > 0 ? 'ready' : 'empty')
        : 'unselected';
      const unchanged = hasLoadedRef.current && directoryConfiguredRef.current === directoryConfigured
        && nextItems.length === itemsRef.current.length && nextItems.every((item, index) => {
        const current = itemsRef.current[index];
        return current?.id === item.id && current.name === item.name && current.relativePath === item.relativePath
          && current.kind === item.kind && current.size === item.size && current.modifiedAt === item.modifiedAt;
      });
      hasLoadedRef.current = true;
      directoryConfiguredRef.current = directoryConfigured;
      if (unchanged) {
        if (!refreshOptions.silent) setStatus(nextStatus);
        return;
      }
      itemsRef.current = nextItems;
      setItems(nextItems);
      setStatus(nextStatus);
      for (const item of nextItems) {
        if (item.durationStatus === 'not-applicable') continue;
        void probeDurationRef.current(item, probeController.signal).then((duration) => {
          if (!Number.isFinite(duration) || duration <= 0) throw new Error('invalid_media_duration');
          if (!mountedRef.current || requestId !== requestIdRef.current || probeController.signal.aborted) return;
          setItems((current) => current.map((candidate) => (
            candidate.id === item.id && candidate.contentUrl === item.contentUrl
              ? { ...candidate, duration, durationStatus: 'ready' }
              : candidate
          )));
        }).catch(() => {
          if (!mountedRef.current || requestId !== requestIdRef.current || probeController.signal.aborted) return;
          setItems((current) => current.map((candidate) => (
            candidate.id === item.id && candidate.contentUrl === item.contentUrl
              ? { ...candidate, duration: undefined, durationStatus: 'failed' }
              : candidate
          )));
        });
      }
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const safe = safeError(error, '无法读取素材库');
      setErrorCode(safe.code);
      if (safe.code === 'directory_unavailable') {
        setStatus('reselect-required');
        setDirectoryError('素材目录不可用，请重新选择素材目录');
      } else {
        setStatus('partial-error');
        setDirectoryError('素材库读取失败，请重试或重新选择目录');
      }
    }
  }, []);

  const chooseDirectory = useCallback(() => {
    if (selectionPromiseRef.current) return selectionPromiseRef.current;
    const selectionId = ++selectionIdRef.current;
    const selectionPromise = (async () => {
      try {
        const selection = await companionApi.selectMediaDirectory();
        if (!mountedRef.current || selectionId !== selectionIdRef.current || selection.status === 'cancelled') return;
        await refresh();
      } catch (error) {
        if (!mountedRef.current || selectionId !== selectionIdRef.current) return;
        const safe = safeError(error, '无法选择素材目录');
        setErrorCode(safe.code);
        if (safe.code === 'directory_unavailable') {
          setStatus('reselect-required');
          setDirectoryError('素材目录不可用，请重新选择素材目录');
        } else {
          setStatus('partial-error');
          setDirectoryError('无法选择素材目录，请重试');
        }
      }
    })().finally(() => {
      if (selectionPromiseRef.current === selectionPromise) selectionPromiseRef.current = null;
    });
    selectionPromiseRef.current = selectionPromise;
    return selectionPromise;
  }, [refresh]);

  const reveal = useCallback(async (mediaId: string) => {
    try {
      await companionApi.revealMedia(mediaId);
      if (mountedRef.current) setActionError(null);
    } catch (error) {
      const safe = safeError(error, '无法在 Finder 中显示素材');
      if (mountedRef.current) setActionError(safe.message);
      throw safe;
    }
  }, []);

  const clearActionError = useCallback(() => setActionError(null), []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      selectionIdRef.current += 1;
      selectionPromiseRef.current = null;
      probeAbortRef.current?.abort();
      probeAbortRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    const intervalMs = options.refreshIntervalMs ?? 3_000;
    if (intervalMs <= 0) return;
    const poll = async () => {
      if (!mountedRef.current || pollingRef.current || document.visibilityState === 'hidden') return;
      pollingRef.current = true;
      try { await refresh({ silent: true }); } finally { pollingRef.current = false; }
    };
    const onFocus = () => { void poll(); };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void poll(); };
    const timer = window.setInterval(() => { void poll(); }, intervalMs);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [options.refreshIntervalMs, refresh]);

  return {
    items,
    status,
    errorCode,
    directoryError,
    actionError,
    chooseDirectory,
    refresh,
    reveal,
    clearActionError,
  };
}
