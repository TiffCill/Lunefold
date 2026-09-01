import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { cwd } from 'node:process';

import { createCompanionHandler, streamMediaFile, type CompanionDependencies } from './http.ts';
import { MediaCatalogue } from './media/catalogue.ts';
import { createNativeMediaOperations } from './media/native.ts';
import { developmentSettingsFilename, SettingsStore } from './settings.ts';
import { ConversationStore } from './conversations/store.ts';
import { join } from 'node:path';

async function readRequestBody(request: IncomingMessage): Promise<ArrayBuffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(size);
  const body = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return buffer;
}

function waitForDrainOrClose(target: ServerResponse): Promise<'drain' | 'close'> {
  return new Promise((resolve) => {
    const onDrain = () => {
      target.off('close', onClose);
      resolve('drain');
    };
    const onClose = () => {
      target.off('drain', onDrain);
      resolve('close');
    };
    target.once('drain', onDrain);
    target.once('close', onClose);
  });
}

function endWithMediaNotFound(target: ServerResponse) {
  const body = new TextEncoder().encode(JSON.stringify({
    error: { code: 'media_not_found', message: '素材不存在' },
  }));
  for (const header of ['accept-ranges', 'content-length', 'content-range', 'content-type']) {
    target.removeHeader(header);
  }
  target.statusCode = 404;
  target.setHeader('cache-control', 'no-store');
  target.setHeader('content-length', String(body.byteLength));
  target.setHeader('content-type', 'application/json');
  target.end(body);
}

async function sendResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => target.setHeader(key, value));
  if (!response.body) {
    target.end();
    return;
  }

  const reader = response.body.getReader();
  let clientDisconnected = false;
  const onClose = () => {
    clientDisconnected = true;
    void reader.cancel().catch(() => undefined);
  };
  target.once('close', onClose);

  try {
    while (!clientDisconnected) {
      const { done, value } = await reader.read();
      if (done || clientDisconnected) break;
      if (!target.write(value)) {
        const event = await waitForDrainOrClose(target);
        if (event === 'close') break;
      }
    }
    if (!clientDisconnected) {
      target.off('close', onClose);
      target.end();
    }
  } catch {
    target.off('close', onClose);
    await reader.cancel().catch(() => undefined);
    if (clientDisconnected) return;
    if (!target.headersSent) {
      endWithMediaNotFound(target);
      return;
    }
    target.destroy();
  } finally {
    target.off('close', onClose);
  }
}

export function companionPlugin(options: Partial<CompanionDependencies> = {}): Plugin {
  const settings = options.settings ?? new SettingsStore(developmentSettingsFilename(cwd()));
  const conversations = options.conversations ?? new ConversationStore(join(cwd(), '.lumina-data', 'conversations.json'));
  const catalogue = options.catalogue ?? new MediaCatalogue({ settings });
  const native = createNativeMediaOperations();
  const directorySelector = options.selectMediaDirectory ?? (() => native.selectDirectory());
  const selectMediaDirectory = async () => {
    const selection = await directorySelector();
    if (selection.status === 'selected') {
      await new MediaCatalogue({
        settings,
        directorySelector: async () => selection.path,
      }).selectDirectory();
    }
    return selection;
  };
  const handler = createCompanionHandler({
    settings,
    conversations,
    maxBodyBytes: options.maxBodyBytes,
    fetcher: options.fetcher,
    catalogue,
    selectMediaDirectory,
    streamMedia: options.streamMedia ?? streamMediaFile,
    revealMedia: options.revealMedia ?? ((media) => native.reveal(media.absolutePath)),
  });
  return {
    name: 'lumina-local-companion',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/api/')) { next(); return; }
        const origin = `http://${request.headers.host ?? '127.0.0.1'}`;
        const webRequest = new Request(new URL(request.url, origin), {
          method: request.method,
          headers: request.headers as HeadersInit,
          body: await readRequestBody(request),
        });
        await sendResponse(await handler(webRequest), response);
      });
    },
  };
}
