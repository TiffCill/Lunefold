import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { open as openFile, readdir, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';

import type { MediaKind } from '../../src/media/mediaTypes';
import type { SettingsStore } from '../settings';

const mediaExtensions: Record<MediaKind, ReadonlySet<string>> = {
  video: new Set(['mp4', 'webm', 'mov']),
  image: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']),
  audio: new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']),
};

export interface ServerMediaItem {
  id: string;
  name: string;
  relativePath: string;
  kind: MediaKind;
  size: number;
  modifiedAt: number;
}

export interface ResolvedMedia extends ServerMediaItem {
  absolutePath: string;
}

export interface MediaFileRange {
  start: number;
  end: number;
}

export interface OpenedMedia {
  media: ResolvedMedia;
  createReadStream(range?: MediaFileRange): ReadableStream<Uint8Array>;
  close(): Promise<void>;
}

interface CachedResolvedMedia {
  authorizedRoot: string;
  authorizedRootIdentity: FileIdentity;
  fileIdentity: FileIdentity;
  item: ResolvedMedia;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

interface ScannedResolvedMedia {
  fileIdentity: FileIdentity;
  item: ResolvedMedia;
}

export type DirectorySelector = () => Promise<string | null>;
export type MediaFileOpener = (absolutePath: string) => Promise<FileHandle>;

export interface MediaCatalogueOptions {
  settings: SettingsStore;
  directorySelector?: DirectorySelector;
  fileOpener?: MediaFileOpener;
}

export class MediaCatalogueError extends Error {
  constructor(public readonly code: 'directory_unavailable' | 'media_not_found') {
    super(code);
    this.name = 'MediaCatalogueError';
  }
}

function classifyPath(path: string): MediaKind | null {
  const extension = basename(path).split('.').pop()?.toLowerCase();
  if (!extension || extension === basename(path).toLowerCase()) return null;
  return (Object.keys(mediaExtensions) as MediaKind[])
    .find((kind) => mediaExtensions[kind].has(extension)) ?? null;
}

function isWithinRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

function identityOf(fileStat: Pick<Stats, 'dev' | 'ino'>): FileIdentity {
  return { dev: fileStat.dev, ino: fileStat.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function publicItem(root: string, absolutePath: string, size: number, modifiedAt: number, kind: MediaKind): ResolvedMedia {
  const relativePath = relative(root, absolutePath).split(sep).join('/');
  const id = createHash('sha256').update(`${relativePath}:${size}:${modifiedAt}`).digest('hex');
  return {
    id,
    name: basename(absolutePath),
    relativePath,
    kind,
    size,
    modifiedAt,
    absolutePath,
  };
}

export class MediaCatalogue {
  private readonly resolvedById = new Map<string, CachedResolvedMedia[]>();
  private readonly directorySelector: DirectorySelector;
  private readonly fileOpener: MediaFileOpener;

  constructor(private readonly options: MediaCatalogueOptions) {
    this.directorySelector = options.directorySelector ?? (async () => null);
    this.fileOpener = options.fileOpener ?? ((absolutePath) => openFile(absolutePath, 'r'));
  }

  async selectDirectory(): Promise<void> {
    const selectedDirectory = await this.directorySelector();
    if (!selectedDirectory) return;

    const root = await this.resolveDirectory(selectedDirectory);
    await this.options.settings.writeMediaDirectory(root);
  }

  async list(): Promise<ServerMediaItem[]> {
    const settings = await this.options.settings.read();
    if (!settings.mediaDirectory) return [];

    const root = await this.resolveDirectory(settings.mediaDirectory);
    const rootStat = await stat(root);
    const discovered = await this.scan(root);
    for (const scanned of discovered) this.remember({
      authorizedRoot: root,
      authorizedRootIdentity: identityOf(rootStat),
      fileIdentity: scanned.fileIdentity,
      item: scanned.item,
    });

    return discovered.map(({ item: { absolutePath: _absolutePath, ...item } }) => item);
  }

  async resolve(mediaId: string): Promise<ResolvedMedia> {
    const cached = await this.uniqueCached(mediaId);
    return this.validateCached(mediaId, cached);
  }

  async open(mediaId: string): Promise<OpenedMedia> {
    const cached = await this.uniqueCached(mediaId);
    const media = await this.validateCached(mediaId, cached);
    let handle: FileHandle | undefined;
    try {
      handle = await this.fileOpener(media.absolutePath);
      const fileStat = await handle.stat();
      if (
        !fileStat.isFile()
        || !sameIdentity(identityOf(fileStat), cached.fileIdentity)
        || fileStat.size !== cached.item.size
        || Math.round(fileStat.mtimeMs) !== cached.item.modifiedAt
      ) {
        throw new MediaCatalogueError('media_not_found');
      }

      const authorizedHandle = handle;
      let closePromise: Promise<void> | undefined;
      const close = () => {
        closePromise ??= authorizedHandle.close();
        return closePromise;
      };
      return {
        media,
        createReadStream(range) {
          const stream = authorizedHandle.createReadStream({
            autoClose: false,
            ...(range ? { start: range.start, end: range.end } : {}),
          });
          return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
        },
        close,
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error instanceof MediaCatalogueError) throw error;
      throw new MediaCatalogueError('media_not_found');
    }
  }

  private async uniqueCached(mediaId: string): Promise<CachedResolvedMedia> {
    if (!this.resolvedById.has(mediaId)) await this.list();
    const candidates = this.resolvedById.get(mediaId);
    if (!candidates || candidates.length !== 1) throw new MediaCatalogueError('media_not_found');
    return candidates[0];
  }

  private remember(cached: CachedResolvedMedia): void {
    const candidates = this.resolvedById.get(cached.item.id) ?? [];
    const existingIndex = candidates.findIndex((candidate) => (
      candidate.authorizedRoot === cached.authorizedRoot
      && candidate.item.absolutePath === cached.item.absolutePath
      && sameIdentity(candidate.authorizedRootIdentity, cached.authorizedRootIdentity)
      && sameIdentity(candidate.fileIdentity, cached.fileIdentity)
    ));
    if (existingIndex === -1) candidates.push(cached);
    else candidates[existingIndex] = cached;
    this.resolvedById.set(cached.item.id, candidates);
  }

  private async validateCached(mediaId: string, cached: CachedResolvedMedia): Promise<ResolvedMedia> {
    try {
      const authorizedRoot = await realpath(cached.authorizedRoot);
      const rootStat = await stat(authorizedRoot);
      if (
        authorizedRoot !== cached.authorizedRoot
        || !rootStat.isDirectory()
        || !sameIdentity(identityOf(rootStat), cached.authorizedRootIdentity)
      ) {
        throw new MediaCatalogueError('media_not_found');
      }
      const absolutePath = await realpath(cached.item.absolutePath);
      if (!isWithinRoot(authorizedRoot, absolutePath)) throw new MediaCatalogueError('media_not_found');
      const fileStat = await stat(absolutePath);
      const kind = classifyPath(absolutePath);
      if (!fileStat.isFile() || !kind || !sameIdentity(identityOf(fileStat), cached.fileIdentity)) {
        throw new MediaCatalogueError('media_not_found');
      }
      const current = publicItem(authorizedRoot, absolutePath, fileStat.size, Math.round(fileStat.mtimeMs), kind);
      if (
        current.id !== mediaId
        || current.relativePath !== cached.item.relativePath
        || current.name !== cached.item.name
        || current.kind !== cached.item.kind
        || current.size !== cached.item.size
        || current.modifiedAt !== cached.item.modifiedAt
      ) {
        throw new MediaCatalogueError('media_not_found');
      }
      return current;
    } catch (error) {
      if (error instanceof MediaCatalogueError) throw error;
      throw new MediaCatalogueError('media_not_found');
    }
  }

  private async resolveDirectory(directory: string): Promise<string> {
    try {
      const root = await realpath(directory);
      if (!(await stat(root)).isDirectory()) throw new MediaCatalogueError('directory_unavailable');
      return root;
    } catch (error) {
      if (error instanceof MediaCatalogueError) throw error;
      throw new MediaCatalogueError('directory_unavailable');
    }
  }

  private async scan(root: string): Promise<ScannedResolvedMedia[]> {
    const discovered: ScannedResolvedMedia[] = [];
    const visitedDirectories = new Set<string>();

    const visit = async (directory: string): Promise<void> => {
      const resolvedDirectory = await realpath(directory);
      if (!isWithinRoot(root, resolvedDirectory) || visitedDirectories.has(resolvedDirectory)) return;
      visitedDirectories.add(resolvedDirectory);

      let entries;
      try {
        entries = await readdir(resolvedDirectory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const candidate = join(resolvedDirectory, entry.name);
        let resolvedPath: string;
        let fileStat: Awaited<ReturnType<typeof stat>>;
        try {
          resolvedPath = await realpath(candidate);
          if (!isWithinRoot(root, resolvedPath)) continue;
          fileStat = await stat(resolvedPath);
        } catch {
          continue;
        }

        if (fileStat.isDirectory()) {
          await visit(resolvedPath);
          continue;
        }
        if (!fileStat.isFile()) continue;

        const kind = classifyPath(resolvedPath);
        if (!kind) continue;
        discovered.push({
          fileIdentity: identityOf(fileStat),
          item: publicItem(root, resolvedPath, fileStat.size, Math.round(fileStat.mtimeMs), kind),
        });
      }
    };

    await visit(root);
    const sorted = discovered.sort((left, right) => left.item.relativePath.localeCompare(right.item.relativePath));
    const uniqueByIdentity = new Map<string, ScannedResolvedMedia>();
    for (const item of sorted) {
      const identity = `${item.fileIdentity.dev}:${item.fileIdentity.ino}`;
      if (!uniqueByIdentity.has(identity)) uniqueByIdentity.set(identity, item);
    }
    return [...uniqueByIdentity.values()];
  }
}
