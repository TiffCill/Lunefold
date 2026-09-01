import { describe, expect, test } from 'vitest';

import { DIRECTORY_HANDLE_KEY, createDirectoryStore } from './directoryStore';

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  succeed(result: T) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.(new Event('success')));
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: () => true };
  readonly values = new Map<string, unknown>();
  lastKey: string | undefined;

  createObjectStore() {
    return undefined;
  }

  transaction() {
    const transaction = {
      oncomplete: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      error: null,
      objectStore: () => ({
        get: (key: string) => {
          const request = new FakeRequest<unknown>();
          request.succeed(this.values.get(key));
          return request;
        },
        put: (value: unknown, key: string) => {
          this.lastKey = key;
          this.values.set(key, value);
          const request = new FakeRequest<IDBValidKey>();
          request.succeed(key);
          queueMicrotask(() => transaction.oncomplete?.(new Event('complete')));
          return request;
        },
      }),
    };
    return transaction;
  }
}

function createFakeIndexedDb(database: FakeDatabase) {
  return {
    open: () => {
      const request = new FakeRequest<FakeDatabase>() as FakeRequest<FakeDatabase> & {
        onupgradeneeded: ((event: Event) => void) | null;
      };
      request.onupgradeneeded = null;
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.(new Event('upgradeneeded'));
        request.onsuccess?.(new Event('success'));
      });
      return request;
    },
  } as unknown as IDBFactory;
}

describe('directory handle store', () => {
  test('keeps the latest selected directory under one fixed key', async () => {
    const database = new FakeDatabase();
    const store = createDirectoryStore(createFakeIndexedDb(database));
    const firstHandle = { kind: 'directory' as const, name: 'first' };
    const latestHandle = { kind: 'directory' as const, name: 'latest' };

    await store.save(firstHandle);
    await store.save(latestHandle);

    expect(database.lastKey).toBe(DIRECTORY_HANDLE_KEY);
    await expect(store.load()).resolves.toBe(latestHandle);
  });

  test('reports unavailable IndexedDB without silently losing the directory selection', async () => {
    const store = createDirectoryStore(undefined);

    await expect(store.load()).rejects.toThrow('IndexedDB is unavailable');
  });
});
