export type MediaKind = 'video' | 'image' | 'audio';
export type MediaDurationStatus = 'not-applicable' | 'pending' | 'ready' | 'failed';

interface MediaItemMetadata {
  id: string;
  name: string;
  kind: MediaKind;
  size: number;
  modifiedAt: number;
  duration?: number;
  width?: number;
  height?: number;
}

export interface MediaItem extends MediaItemMetadata {
  objectUrl: string;
  contentUrl: string;
  relativePath: string;
  durationStatus: MediaDurationStatus;
}

export type CompanionMediaItem = MediaItem;

export interface LegacyBrowserDirectoryMediaItem extends MediaItemMetadata {
  file: File;
  objectUrl: string;
}

const extensionsByKind: Record<MediaKind, ReadonlySet<string>> = {
  video: new Set(['mp4', 'webm', 'mov']),
  image: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']),
  audio: new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']),
};

const mimeTypesByKind: Record<MediaKind, ReadonlySet<string>> = {
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  audio: new Set([
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
    'audio/x-flac',
  ]),
};

function kindFromMimeType(type: string): MediaKind | null {
  return (Object.keys(mimeTypesByKind) as MediaKind[])
    .find((kind) => mimeTypesByKind[kind].has(type)) ?? null;
}

function extensionOf(name: string): string | null {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === name.length - 1) return null;
  return name.slice(dotIndex + 1).toLowerCase();
}

export function classifyMedia(file: File): MediaKind | null {
  const mimeKind = kindFromMimeType(file.type.toLowerCase());
  if (mimeKind) return mimeKind;

  const extension = extensionOf(file.name);
  if (!extension) return null;

  return (Object.keys(extensionsByKind) as MediaKind[]).find((kind) => extensionsByKind[kind].has(extension)) ?? null;
}

export function createMediaId(relativePath: string, file: Pick<File, 'size' | 'lastModified'>): string {
  return `${relativePath}:${file.size}:${file.lastModified}`;
}
