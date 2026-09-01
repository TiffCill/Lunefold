export const DIRECTORY_DATABASE_NAME = 'lumina-media-library';
export const DIRECTORY_STORE_NAME = 'directory-handles';
export const DIRECTORY_HANDLE_KEY = 'media-directory';

export interface StoredDirectoryHandle {
  kind: 'directory';
  name: string;
}

export interface DirectoryStore<Handle extends StoredDirectoryHandle = StoredDirectoryHandle> {
  load(): Promise<Handle | null>;
  save(handle: Handle): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DIRECTORY_DATABASE_NAME, 1);

  return new Promise((resolve, reject) => {
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
        database.createObjectStore(DIRECTORY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
  });
}

export function createDirectoryStore<Handle extends StoredDirectoryHandle>(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): DirectoryStore<Handle> {
  if (!factory) {
    const unavailable = () => Promise.reject(new Error('IndexedDB is unavailable'));
    return { load: unavailable, save: unavailable };
  }

  const database = openDatabase(factory);

  return {
    async load() {
      const connection = await database;
      const transaction = connection.transaction(DIRECTORY_STORE_NAME, 'readonly');
      const store = transaction.objectStore(DIRECTORY_STORE_NAME);
      const result = await requestResult(store.get(DIRECTORY_HANDLE_KEY));
      return (result as Handle | undefined) ?? null;
    },
    async save(handle) {
      const connection = await database;
      const transaction = connection.transaction(DIRECTORY_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(DIRECTORY_STORE_NAME);
      const completed = transactionComplete(transaction);
      await requestResult(store.put(handle, DIRECTORY_HANDLE_KEY));
      await completed;
    },
  };
}
