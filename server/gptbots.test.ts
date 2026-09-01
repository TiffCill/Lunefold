// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { GptBotsClient } from './gptbots';

describe('GPTBots client', () => {
  it('creates a conversation in the configured region', async () => {
    const fetcher = vi.fn(async () => Response.json({ conversation_id: 'conversation-1' }));
    const client = new GptBotsClient({ apiKey: 'secret', region: 'jp', userId: 'editor-user', fetcher });
    await expect(client.createConversation()).resolves.toEqual({ conversation_id: 'conversation-1' });
    expect(fetcher).toHaveBeenCalledWith('https://api-jp.gptbots.ai/v1/conversation', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer secret' }), body: JSON.stringify({ user_id: 'editor-user' }),
    }));
  });

  it('opens a streaming multimodal response with image, audio, and video references', async () => {
    const upstream = new ReadableStream<Uint8Array>();
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(upstream));
    const client = new GptBotsClient({ apiKey: 'secret', region: 'sg', userId: 'u', fetcher });
    await expect(client.streamMessage({
      conversationId: 'c1',
      text: 'animate it',
      images: [{ url: 'https://files.example/a.png', format: 'png', name: 'a' }],
      audios: [{ base64_content: 'audio-data', format: 'mp3', name: 'sound' }],
      videos: [{ base64_content: 'video-data', format: 'mp4', name: 'clip' }],
    })).resolves.toBe(upstream);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
      conversation_id: 'c1', response_mode: 'streaming', messages: [{ role: 'user', content: [
        { type: 'text', text: 'animate it' },
        { type: 'image', image: [{ url: 'https://files.example/a.png', format: 'png', name: 'a' }] },
        { type: 'audio', audio: [{ base64_content: 'audio-data', format: 'mp3', name: 'sound' }] },
        { type: 'video', video: [{ base64_content: 'video-data', format: 'mp4', name: 'clip' }] },
      ] }],
    });
  });

  it('rejects a successful response without a readable body', async () => {
    const client = new GptBotsClient({ apiKey: 'secret', region: 'sg', userId: 'u', fetcher: async () => new Response(null, { status: 204 }) });
    await expect(client.streamMessage({ conversationId: 'c1', text: 'hello' })).rejects.toThrow('GPTBots 未返回可读取的响应');
  });

  it('does not leak upstream response bodies in errors', async () => {
    const client = new GptBotsClient({ apiKey: 'secret', region: 'th', userId: 'u', fetcher: async () => new Response('secret diagnostics', { status: 401 }) });
    await expect(client.createConversation()).rejects.toThrow('GPTBots 请求失败（401）');
  });
});
