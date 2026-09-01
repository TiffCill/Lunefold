import type { SettingsUpdate } from './settings.ts';
import { SettingsStore } from './settings.ts';
import { GptBotsClient } from './gptbots.ts';
import { MediaCatalogue, MediaCatalogueError, type MediaFileRange, type OpenedMedia, type ResolvedMedia, type ServerMediaItem } from './media/catalogue.ts';
import type { DirectorySelection } from './media/native.ts';
import { adapterRegistry } from './modellix/adapters.ts';
import { encodeAssistantEvents, parseGptBotsStream, type AssistantStreamEvent } from './assistantStream.ts';
import { ConversationStore, type LocalConversation } from './conversations/store.ts';

export type MediaByteRange = MediaFileRange;

export interface MediaHttpDependencies {
  catalogue: Pick<MediaCatalogue, 'list' | 'open' | 'resolve'>;
  selectMediaDirectory: () => Promise<DirectorySelection>;
  streamMedia: (opened: OpenedMedia, range?: MediaByteRange) => Promise<BodyInit> | BodyInit;
  revealMedia: (media: ResolvedMedia) => Promise<void>;
}

export interface CompanionDependencies extends Partial<MediaHttpDependencies> {
  settings: SettingsStore;
  conversations?: ConversationStore;
  maxBodyBytes?: number;
  fetcher?: typeof fetch;
}

type CompanionHandler = (request: Request) => Promise<Response>;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function prependAssistantStatus(source: ReadableStream<AssistantStreamEvent>): ReadableStream<AssistantStreamEvent> {
  const reader = source.getReader();
  let sentStatus = false;
  return new ReadableStream<AssistantStreamEvent>({
    async pull(controller) {
      if (!sentStatus) {
        sentStatus = true;
        controller.enqueue({ type: 'status', label: '正在连接 AI' });
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        reader.releaseLock();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function rangeError(size: number): Response {
  return Response.json(
    { error: { code: 'invalid_range', message: '请求的媒体范围无效' } },
    {
      status: 416,
      headers: {
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'content-range': `bytes */${size}`,
      },
    },
  );
}

function parseByteRange(header: string, size: number): MediaByteRange | null {
  if (!header.startsWith('bytes=') || header.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || size <= 0) return null;
  const [, startText, endText] = match;
  if (!startText && !endText) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

const mimeTypes: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

function mediaMime(item: ServerMediaItem): string {
  const extension = item.name.split('.').pop()?.toLowerCase() ?? '';
  return mimeTypes[extension] ?? `${item.kind}/*`;
}

export function streamMediaFile(opened: OpenedMedia, range?: MediaByteRange): ReadableStream<Uint8Array> {
  return opened.createReadStream(range);
}

function closeWithBodyLifetime(body: BodyInit, close: () => Promise<void>): ReadableStream<Uint8Array> {
  const source = new Response(body).body;
  if (!source) {
    void close().catch(() => undefined);
    return new ReadableStream({ start: (controller) => controller.close() });
  }
  const reader = source.getReader();
  let closePromise: Promise<void> | undefined;
  const closeOnce = () => {
    closePromise ??= close();
    return closePromise;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await closeOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        await closeOnce().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await closeOnce().catch(() => undefined);
      }
    },
  });
}

function publicMediaError(error: unknown): Response | null {
  const code = error instanceof MediaCatalogueError
    ? error.code
    : typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : null;
  if (code === 'media_not_found') return apiError(404, 'media_not_found', '素材不存在');
  if (code === 'directory_unavailable') return apiError(503, 'directory_unavailable', '素材目录不可用');
  return null;
}

function publicConversationError(error: unknown): Response | null {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null;
  if (code === 'conversation_not_found') return apiError(404, 'conversation_not_found', '对话不存在');
  if (code === 'invalid_conversation') return apiError(400, 'invalid_conversation', '对话内容无效');
  return null;
}

function publicConversation(conversation: LocalConversation) {
  const { remoteConversationId: _remoteConversationId, ...visible } = conversation;
  return visible;
}

async function readJson<T>(request: Request, maxBodyBytes: number): Promise<T | Response> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBodyBytes) return apiError(413, 'payload_too_large', '请求内容超过限制');
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return apiError(400, 'invalid_json', '请求内容不是有效 JSON');
  }
}

export function createCompanionHandler(dependencies: CompanionDependencies): CompanionHandler {
  const maxBodyBytes = dependencies.maxBodyBytes ?? 24 * 1024 * 1024;
  const catalogue = dependencies.catalogue ?? new MediaCatalogue({ settings: dependencies.settings });
  const selectMediaDirectory = dependencies.selectMediaDirectory ?? (async () => ({ status: 'cancelled' as const }));
  const streamMedia = dependencies.streamMedia ?? streamMediaFile;
  const revealMedia = dependencies.revealMedia ?? (async () => {
    throw new Error('Native reveal is unavailable');
  });
  const conversations = dependencies.conversations;
  return async (request) => {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/settings' && request.method === 'GET') return json(await dependencies.settings.readMasked());
      if (pathname === '/api/settings' && request.method === 'PUT') {
        const body = await readJson<SettingsUpdate>(request, maxBodyBytes);
        if (body instanceof Response) return body;
        await dependencies.settings.write(body);
        return json(await dependencies.settings.readMasked());
      }
      if (pathname === '/api/models' && request.method === 'GET') {
        const settings = await dependencies.settings.read();
        return json(adapterRegistry.map(({ mapReferences: _mapReferences, ...adapter }) => ({ ...adapter, enabled: settings.enabledAdapterIds.includes(adapter.id) })));
      }
      if (pathname === '/api/conversations' && request.method === 'POST') {
        if (conversations) return json(publicConversation(await conversations.create()));
        const settings = await dependencies.settings.read();
        return json(await new GptBotsClient({ apiKey: settings.gptbotsApiKey, region: settings.gptbotsRegion, userId: settings.gptbotsUserId, fetcher: dependencies.fetcher }).createConversation());
      }
      if (pathname === '/api/conversations' && request.method === 'GET' && conversations) return json(await conversations.list());
      const conversationRoute = /^\/api\/conversations\/([^/]+)(?:\/(select))?$/.exec(pathname);
      if (conversationRoute && conversations) {
        const id = decodeURIComponent(conversationRoute[1]);
        if (conversationRoute[2] === 'select' && request.method === 'POST') {
          await conversations.select(id);
          return json({ status: 'selected' });
        }
        if (!conversationRoute[2] && request.method === 'GET') {
          const conversation = await conversations.get(id);
          if (!conversation) return apiError(404, 'conversation_not_found', '对话不存在');
          return json(publicConversation(conversation));
        }
        if (!conversationRoute[2] && request.method === 'PUT') {
          const body = await readJson<{ messages: import('./conversations/store.ts').StoredConversationMessage[] }>(request, maxBodyBytes);
          if (body instanceof Response) return body;
          return json(publicConversation(await conversations.replace(id, body)));
        }
      }
      if (pathname === '/api/messages' && request.method === 'POST') {
        type MessageMedia = { url?: string; base64_content?: string; format: string; name: string };
        const body = await readJson<{ conversationId: string; text: string; images?: MessageMedia[]; audios?: MessageMedia[]; videos?: MessageMedia[] }>(request, maxBodyBytes);
        if (body instanceof Response) return body;
        if (!body.conversationId || !body.text?.trim()) return apiError(400, 'invalid_message', '会话和消息内容不能为空');
        const settings = await dependencies.settings.read();
        const client = new GptBotsClient({ apiKey: settings.gptbotsApiKey, region: settings.gptbotsRegion, userId: settings.gptbotsUserId, fetcher: dependencies.fetcher });
        let remoteConversationId = body.conversationId;
        if (conversations) {
          const local = await conversations.get(body.conversationId);
          if (!local) return apiError(404, 'conversation_not_found', '对话不存在');
          remoteConversationId = local.remoteConversationId ?? (await client.createConversation()).conversation_id;
          if (!local.remoteConversationId) await conversations.setRemoteConversationId(local.id, remoteConversationId);
        }
        const upstream = await client.streamMessage({ ...body, conversationId: remoteConversationId });
        const stream = encodeAssistantEvents(prependAssistantStatus(parseGptBotsStream(upstream)));
        return new Response(stream, {
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/x-ndjson; charset=utf-8',
            'x-content-type-options': 'nosniff',
          },
        });
      }
      if (pathname === '/api/media-library/select-directory' && request.method === 'POST') {
        const selection = await selectMediaDirectory();
        return json({ status: selection.status });
      }
      if (pathname === '/api/media-library' && request.method === 'GET') {
        const settings = await dependencies.settings.read();
        return json({ items: await catalogue.list(), directoryConfigured: Boolean(settings.mediaDirectory) });
      }

      const mediaRoute = /^\/api\/media\/([^/]+)\/(content|reveal)$/.exec(pathname);
      if (mediaRoute) {
        let mediaId: string;
        try {
          mediaId = decodeURIComponent(mediaRoute[1]);
        } catch {
          return apiError(404, 'media_not_found', '素材不存在');
        }

        if (mediaRoute[2] === 'content' && request.method === 'GET') {
          const opened = await catalogue.open(mediaId);
          try {
            const { media } = opened;
            const rangeHeader = request.headers.get('range');
            let range: MediaByteRange | undefined;
            if (rangeHeader) {
              const parsedRange = parseByteRange(rangeHeader, media.size);
              if (!parsedRange) {
                await opened.close();
                return rangeError(media.size);
              }
              range = parsedRange;
            }
            const contentLength = range ? range.end - range.start + 1 : media.size;
            const headers = new Headers({
              'accept-ranges': 'bytes',
              'cache-control': 'no-store',
              'content-length': String(contentLength),
              'content-type': mediaMime(media),
            });
            if (range) headers.set('content-range', `bytes ${range.start}-${range.end}/${media.size}`);
            const body = closeWithBodyLifetime(await streamMedia(opened, range), opened.close);
            return new Response(body, { status: range ? 206 : 200, headers });
          } catch (error) {
            await opened.close().catch(() => undefined);
            throw error;
          }
        }

        if (mediaRoute[2] === 'reveal' && request.method === 'POST') {
          const media = await catalogue.resolve(mediaId);
          await revealMedia(media);
          return json({ status: 'revealed' });
        }
      }
      return apiError(404, 'not_found', '接口不存在');
    } catch (error) {
      const conversationError = publicConversationError(error);
      if (conversationError) return conversationError;
      const publicError = publicMediaError(error);
      if (publicError) return publicError;
      return apiError(500, 'internal_error', '本地服务处理请求失败');
    }
  };
}
