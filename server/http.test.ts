// @vitest-environment node

import { mkdir, mkdtemp, open, realpath, rename, rm, symlink, utimes, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCompanionHandler, type MediaHttpDependencies } from './http';
import { MediaCatalogue, type OpenedMedia, type ResolvedMedia, type ServerMediaItem } from './media/catalogue';
import { companionPlugin } from './plugin';
import { SettingsStore } from './settings';
import { ConversationStore } from './conversations/store';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('companion settings HTTP boundary', () => {
  it('accepts updates but returns only masked secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-http-'));
    directories.push(directory);
    const handler = createCompanionHandler({ settings: new SettingsStore(join(directory, 'settings.json')) });

    const response = await handler(new Request('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gptbotsApiKey: 'gptbots-secret', modellixApiKey: 'modellix-secret', gptbotsRegion: 'jp' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ gptbotsApiKey: { configured: true, lastFour: 'cret' }, modellixApiKey: { configured: true, lastFour: 'cret' }, gptbotsRegion: 'jp' });
    expect(JSON.stringify(body)).not.toContain('gptbots-secret');
  });

  it('returns a stable JSON error for an oversized request', async () => {
    const handler = createCompanionHandler({ settings: new SettingsStore(join(tmpdir(), 'unused-settings.json')), maxBodyBytes: 8 });
    const response = await handler(new Request('http://localhost/api/settings', { method: 'PUT', body: '123456789' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: 'payload_too_large', message: '请求内容超过限制' } });
  });
});

describe('companion assistant HTTP boundary', () => {
  it('creates, lists, restores, selects, and replaces local conversations without exposing remote IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-http-conversations-'));
    directories.push(directory);
    let now = 100;
    const conversations = new ConversationStore(join(directory, 'conversations.json'), { now: () => now, idFactory: () => 'local-1' });
    const handler = createCompanionHandler({ settings: new SettingsStore(join(directory, 'settings.json')), conversations });
    const createdResponse = await handler(new Request('http://localhost/api/conversations', { method: 'POST' }));
    const created = await createdResponse.json() as { id: string };
    expect(created.id).toBe('local-1');
    expect(JSON.stringify(created)).not.toContain('remoteConversationId');

    now = 200;
    const replaced = await handler(new Request(`http://localhost/api/conversations/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ messages: [{ id: 'u1', role: 'user', content: '新的剪辑方向', createdAt: 200 }] }),
    }));
    expect(await replaced.json()).toMatchObject({ subject: '新的剪辑方向' });
    const listed = await (await handler(new Request('http://localhost/api/conversations'))).json();
    expect(listed).toMatchObject({ lastSelectedId: 'local-1', conversations: [{ id: 'local-1', subject: '新的剪辑方向' }] });
    expect(await (await handler(new Request(`http://localhost/api/conversations/${created.id}`))).json()).toMatchObject({ messages: [{ content: '新的剪辑方向' }] });
  });

  it('creates one remote conversation for the first local send and reuses it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-http-remote-map-'));
    directories.push(directory);
    const settings = new SettingsStore(join(directory, 'settings.json'));
    await settings.write({ gptbotsApiKey: 'secret' });
    const conversations = new ConversationStore(join(directory, 'conversations.json'), { idFactory: () => 'local-1' });
    await conversations.create();
    const encoder = new TextEncoder();
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).endsWith('/v1/conversation')
      ? Response.json({ conversation_id: 'remote-1' })
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"code":0,"message":"End","data":null}\n')); controller.close(); } })));
    const handler = createCompanionHandler({ settings, conversations, fetcher });
    const request = () => new Request('http://localhost/api/messages', { method: 'POST', body: JSON.stringify({ conversationId: 'local-1', text: 'hello' }) });
    await (await handler(request())).text();
    await (await handler(request())).text();
    expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/v1/conversation'))).toHaveLength(1);
    const messageBodies = fetcher.mock.calls.filter(([input]) => String(input).endsWith('/v2/conversation/message')).map(([, init]) => JSON.parse(String(init?.body)));
    expect(messageBodies).toHaveLength(2);
    expect(messageBodies.every((body) => body.conversation_id === 'remote-1')).toBe(true);
  });

  it('streams normalized assistant events without exposing the upstream envelope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-http-assistant-'));
    directories.push(directory);
    const settings = new SettingsStore(join(directory, 'settings.json'));
    await settings.write({ gptbotsApiKey: 'secret' });
    const encoder = new TextEncoder();
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"code":11,"message":"MessageInfo","data":{"private":"hidden"}}\n{"code":3,"message":"Text","data":"核心'));
        controller.enqueue(encoder.encode('回答"}\n{"code":0,"message":"End","data":null}\n'));
        controller.close();
      },
    })));
    const handler = createCompanionHandler({ settings, fetcher });

    const response = await handler(new Request('http://localhost/api/messages', {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'c1', text: '调整节奏' }),
    }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(text).toBe([
      JSON.stringify({ type: 'status', label: '正在连接 AI' }),
      JSON.stringify({ type: 'delta', text: '核心回答' }),
      JSON.stringify({ type: 'done' }),
      '',
    ].join('\n'));
    expect(text).not.toContain('MessageInfo');
    expect(text).not.toContain('hidden');
  });

  it('keeps invalid message failures as ordinary JSON responses', async () => {
    const handler = createCompanionHandler({ settings: new SettingsStore(join(tmpdir(), 'unused-message-settings.json')) });
    const response = await handler(new Request('http://localhost/api/messages', {
      method: 'POST',
      body: JSON.stringify({ conversationId: '', text: '' }),
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: { code: 'invalid_message', message: '会话和消息内容不能为空' } });
  });
});

const publicMedia: ServerMediaItem = {
  id: 'opaque-media-id',
  name: 'clip.mp4',
  relativePath: 'nested/clip.mp4',
  kind: 'video',
  size: 10,
  modifiedAt: 1_787_616_000_000,
};

const resolvedMedia: ResolvedMedia = {
  ...publicMedia,
  absolutePath: '/private/library/nested/clip.mp4',
};

function mediaDependencies(overrides: Partial<MediaHttpDependencies> = {}) {
  const openedMedia: OpenedMedia = {
    media: resolvedMedia,
    createReadStream: vi.fn(() => new ReadableStream()),
    close: vi.fn(async () => undefined),
  };
  const catalogue = {
    list: vi.fn(async () => [publicMedia]),
    open: vi.fn(async (id: string) => {
      if (id !== publicMedia.id) throw Object.assign(new Error('hidden path /private/library'), { code: 'media_not_found' });
      return openedMedia;
    }),
    resolve: vi.fn(async (id: string) => {
      if (id !== publicMedia.id) throw Object.assign(new Error('hidden path /private/library'), { code: 'media_not_found' });
      return resolvedMedia;
    }),
  };
  return {
    catalogue,
    selectMediaDirectory: vi.fn(async () => ({ status: 'cancelled' as const })),
    streamMedia: vi.fn(async () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
    revealMedia: vi.fn(async () => undefined),
    openedMedia,
    ...overrides,
  };
}

describe('companion media HTTP boundary', () => {
  it('preserves the selected directory and returns a stable response when selection is cancelled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-http-media-'));
    directories.push(directory);
    const settings = new SettingsStore(join(directory, 'settings.json'));
    await settings.writeMediaDirectory('/Volumes/Existing Library');
    const dependencies = mediaDependencies();
    const handler = createCompanionHandler({ settings, ...dependencies });

    const response = await handler(new Request('http://localhost/api/media-library/select-directory', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'cancelled' });
    expect((await settings.read()).mediaDirectory).toBe('/Volumes/Existing Library');
  });

  it('lists public catalogue metadata without exposing absolute paths', async () => {
    const dependencies = mediaDependencies();
    const handler = createCompanionHandler({ settings: new SettingsStore(join(tmpdir(), 'unused-media-settings.json')), ...dependencies });

    const response = await handler(new Request('http://localhost/api/media-library'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [publicMedia], directoryConfigured: false });
    expect(JSON.stringify(body)).not.toContain('/private/library');
  });

  it('streams a classified partial response with seek headers', async () => {
    const streamMedia = vi.fn(async () => new Uint8Array([2, 3, 4, 5]));
    const dependencies = mediaDependencies({ streamMedia });
    const handler = createCompanionHandler({ settings: new SettingsStore(join(tmpdir(), 'unused-media-settings.json')), ...dependencies });

    const response = await handler(new Request(`http://localhost/api/media/${publicMedia.id}/content`, {
      headers: { range: 'bytes=2-5' },
    }));

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(response.headers.get('content-length')).toBe('4');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([2, 3, 4, 5]);
    expect(streamMedia).toHaveBeenCalledWith(expect.objectContaining({ media: resolvedMedia }), { start: 2, end: 5 });
    expect(dependencies.openedMedia.close).toHaveBeenCalledOnce();
  });

  it('returns a stable safe 416 response for invalid byte ranges', async () => {
    const dependencies = mediaDependencies();
    const handler = createCompanionHandler({ settings: new SettingsStore(join(tmpdir(), 'unused-media-settings.json')), ...dependencies });

    const response = await handler(new Request(`http://localhost/api/media/${publicMedia.id}/content`, {
      headers: { range: 'bytes=50-60' },
    }));

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await response.json()).toEqual({ error: { code: 'invalid_range', message: '请求的媒体范围无效' } });
    expect(dependencies.streamMedia).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/media/missing/content'],
    ['POST', '/api/media/missing/reveal'],
  ])('returns 404 media_not_found without leaking paths for %s %s', async (method, pathname) => {
    const dependencies = mediaDependencies();
    const handler = createCompanionHandler({ settings: new SettingsStore(join(tmpdir(), 'unused-media-settings.json')), ...dependencies });

    const response = await handler(new Request(`http://localhost${pathname}`, { method }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: { code: 'media_not_found', message: '素材不存在' } });
    expect(JSON.stringify(body)).not.toContain('/private/library');
  });

  it('reveals only the catalogue-resolved item and ignores request paths', async () => {
    const revealMedia = vi.fn(async () => undefined);
    const dependencies = mediaDependencies({ revealMedia });
    const handler = createCompanionHandler({ settings: new SettingsStore(join(tmpdir(), 'unused-media-settings.json')), ...dependencies });

    const response = await handler(new Request(`http://localhost/api/media/${publicMedia.id}/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/Users/attacker/private.mp4' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'revealed' });
    expect(revealMedia).toHaveBeenCalledExactlyOnceWith(resolvedMedia);
  });

  it('never serves replacement bytes swapped in between catalogue validation and stream open', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-http-race-'));
    directories.push(directory);
    const root = join(directory, 'library');
    const safePath = join(root, 'race.mp4');
    const archivedPath = join(directory, 'archived-safe.mp4');
    const outsidePath = join(directory, 'outside.mp4');
    await mkdir(root);
    await writeFile(safePath, 'SAFE');
    await writeFile(outsidePath, 'EVIL');
    const timestamp = new Date('2026-08-25T00:00:00.000Z');
    await utimes(safePath, timestamp, timestamp);
    await utimes(outsidePath, timestamp, timestamp);
    const settings = new SettingsStore(join(directory, 'settings.json'));
    await settings.writeMediaDirectory(root);
    let openedReplacement: FileHandle | undefined;
    const catalogue = new MediaCatalogue({
      settings,
      fileOpener: async (path) => {
        await rename(safePath, archivedPath);
        await symlink(outsidePath, safePath);
        openedReplacement = await open(path, 'r');
        return openedReplacement;
      },
    });
    const [{ id }] = await catalogue.list();
    const handler = createCompanionHandler({ settings, catalogue });

    const response = await handler(new Request(`http://localhost/api/media/${id}/content`));
    const bodyText = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(bodyText)).toEqual({ error: { code: 'media_not_found', message: '素材不存在' } });
    expect(bodyText).not.toContain('EVIL');
    await expect(openedReplacement?.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });
});

class PluginResponse extends EventTarget {
  statusCode = 200;
  headersSent = false;
  destroyed = false;
  readonly headers = new Map<string, string | number | readonly string[]>();
  readonly chunks: Uint8Array[] = [];
  private resolveFirstWrite: (() => void) | undefined;
  readonly firstWrite = new Promise<void>((resolve) => { this.resolveFirstWrite = resolve; });

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  removeHeader(name: string) {
    this.headers.delete(name.toLowerCase());
  }

  write(chunk: Uint8Array) {
    this.headersSent = true;
    this.chunks.push(Uint8Array.from(chunk));
    this.resolveFirstWrite?.();
    this.resolveFirstWrite = undefined;
    return true;
  }

  end(chunk?: Uint8Array) {
    if (chunk) this.write(chunk);
    this.headersSent = true;
    this.dispatchEvent(new Event('finish'));
    return this;
  }

  destroy() {
    this.destroyed = true;
    this.dispatchEvent(new Event('close'));
    return this;
  }

  once(event: string, listener: () => void) {
    this.addEventListener(event, listener, { once: true });
    return this;
  }

  off(event: string, listener: () => void) {
    this.removeEventListener(event, listener);
    return this;
  }
}

type PluginMiddleware = (
  request: { url?: string; method?: string; headers: Record<string, string> } & AsyncIterable<Uint8Array>,
  response: PluginResponse,
  next: () => void,
) => Promise<void>;

function mediaPluginMiddleware(options: Parameters<typeof companionPlugin>[0]): PluginMiddleware {
  let middleware: PluginMiddleware | undefined;
  const plugin = companionPlugin(options);
  const configure = plugin.configureServer;
  if (typeof configure !== 'function') throw new Error('Expected configureServer hook');
  configure.call({} as never, {
    middlewares: {
      use(value: PluginMiddleware) {
        middleware = value;
      },
    },
  } as never);
  if (!middleware) throw new Error('Expected companion middleware');
  return middleware;
}

function invokeMediaPlugin(
  middleware: PluginMiddleware,
  pathname: string,
  method = 'GET',
  response = new PluginResponse(),
) {
  const completion = middleware(
    {
      url: pathname,
      method,
      headers: { host: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {},
    },
    response,
    () => undefined,
  );
  return { response, completion };
}

describe('companion plugin media bridge', () => {
  it('writes the first media chunk before the response body completes', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let streamStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { streamStarted = resolve; });
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        value.enqueue(new Uint8Array([1]));
        streamStarted?.();
      },
    });
    const dependencies = mediaDependencies({ streamMedia: async () => body });
    const middleware = mediaPluginMiddleware({
      settings: new SettingsStore(join(tmpdir(), 'unused-stream-settings.json')),
      ...dependencies,
    });

    const { response, completion } = invokeMediaPlugin(middleware, `/api/media/${publicMedia.id}/content`);
    await started;
    const wroteBeforeCompletion = await Promise.race([
      response.firstWrite.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
    ]);
    controller?.enqueue(new Uint8Array([2]));
    controller?.close();
    await completion;

    expect(wroteBeforeCompletion).toBe(true);
    expect(response.chunks.map((chunk) => Array.from(chunk))).toEqual([[1], [2]]);
  });

  it('cancels the source stream when the client disconnects', async () => {
    const cancelled = vi.fn();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        value.enqueue(new Uint8Array([1]));
      },
      cancel: cancelled,
    });
    const dependencies = mediaDependencies({ streamMedia: async () => body });
    const middleware = mediaPluginMiddleware({
      settings: new SettingsStore(join(tmpdir(), 'unused-stream-settings.json')),
      ...dependencies,
    });

    const { response, completion } = invokeMediaPlugin(middleware, `/api/media/${publicMedia.id}/content`);
    const streamed = await Promise.race([
      response.firstWrite.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
    ]);
    response.destroy();
    if (!streamed) controller?.close();
    await completion;

    expect(cancelled).toHaveBeenCalledOnce();
    expect(dependencies.openedMedia.close).toHaveBeenCalledOnce();
  });

  it('waits for drain before reading the next media chunk', async () => {
    class BackpressuredResponse extends PluginResponse {
      private blockFirstWrite = true;

      override write(chunk: Uint8Array) {
        super.write(chunk);
        if (!this.blockFirstWrite) return true;
        this.blockFirstWrite = false;
        return false;
      }
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.enqueue(new Uint8Array([2]));
        controller.close();
      },
    });
    const dependencies = mediaDependencies({ streamMedia: async () => body });
    const middleware = mediaPluginMiddleware({
      settings: new SettingsStore(join(tmpdir(), 'unused-stream-settings.json')),
      ...dependencies,
    });
    const response = new BackpressuredResponse();

    const { completion } = invokeMediaPlugin(
      middleware,
      `/api/media/${publicMedia.id}/content`,
      'GET',
      response,
    );
    await response.firstWrite;
    await Promise.resolve();
    expect(response.chunks.map((chunk) => Array.from(chunk))).toEqual([[1]]);
    response.dispatchEvent(new Event('drain'));
    await completion;

    expect(response.chunks.map((chunk) => Array.from(chunk))).toEqual([[1], [2]]);
  });

  it('persists a production-selected directory and preserves it after cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-plugin-media-'));
    directories.push(directory);
    const selectedRoot = join(directory, 'selected');
    await mkdir(selectedRoot);
    const settings = new SettingsStore(join(directory, 'settings.json'));
    const selectMediaDirectory = vi.fn()
      .mockResolvedValueOnce({ status: 'selected' as const, path: selectedRoot })
      .mockResolvedValueOnce({ status: 'cancelled' as const });
    const middleware = mediaPluginMiddleware({ settings, selectMediaDirectory });

    const first = invokeMediaPlugin(middleware, '/api/media-library/select-directory', 'POST');
    await first.completion;
    expect((await settings.read()).mediaDirectory).toBe(await realpath(selectedRoot));
    expect(JSON.parse(new TextDecoder().decode(Buffer.concat(first.response.chunks)))).toEqual({ status: 'selected' });

    const second = invokeMediaPlugin(middleware, '/api/media-library/select-directory', 'POST');
    await second.completion;
    expect((await settings.read()).mediaDirectory).toBe(await realpath(selectedRoot));
    expect(JSON.parse(new TextDecoder().decode(Buffer.concat(second.response.chunks)))).toEqual({ status: 'cancelled' });
  });

  it('maps a deferred stream failure before headers to media_not_found without leaking details', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('/private/library/vanished.mp4');
      },
    });
    const dependencies = mediaDependencies({ streamMedia: async () => body });
    const middleware = mediaPluginMiddleware({
      settings: new SettingsStore(join(tmpdir(), 'unused-stream-settings.json')),
      ...dependencies,
    });

    const { response, completion } = invokeMediaPlugin(middleware, `/api/media/${publicMedia.id}/content`);
    await expect(completion).resolves.toBeUndefined();
    const bodyText = new TextDecoder().decode(Buffer.concat(response.chunks));

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(bodyText)).toEqual({ error: { code: 'media_not_found', message: '素材不存在' } });
    expect(bodyText).not.toContain('/private/library');
    expect(dependencies.openedMedia.close).toHaveBeenCalledOnce();
  });

  it('closes safely when a deferred stream failure happens after headers are committed', async () => {
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount === 0) {
          pullCount += 1;
          controller.enqueue(new Uint8Array([1]));
          return;
        }
        throw new Error('/private/library/vanished-after-first-chunk.mp4');
      },
    });
    const dependencies = mediaDependencies({ streamMedia: async () => body });
    const middleware = mediaPluginMiddleware({
      settings: new SettingsStore(join(tmpdir(), 'unused-stream-settings.json')),
      ...dependencies,
    });

    const { response, completion } = invokeMediaPlugin(middleware, `/api/media/${publicMedia.id}/content`);
    await expect(completion).resolves.toBeUndefined();

    expect(response.chunks.map((chunk) => Array.from(chunk))).toEqual([[1]]);
    expect(response.destroyed).toBe(true);
    expect(dependencies.openedMedia.close).toHaveBeenCalledOnce();
  });
});
