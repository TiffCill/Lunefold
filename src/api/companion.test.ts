import { afterEach, describe, expect, it, vi } from 'vitest';
import { companionApi, CompanionApiError } from './companion';

afterEach(() => vi.unstubAllGlobals());

describe('companion message transport', () => {
  it('returns the readable response without decoding it as JSON', async () => {
    const response = new Response('{"type":"delta","text":"核心回答"}\n', {
      headers: { 'content-type': 'application/x-ndjson' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(companionApi.sendMessage({ conversationId: 'c1', text: 'hello' })).resolves.toBe(response);
  });

  it('decodes sanitized JSON errors before a message stream starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'invalid_message', message: '消息无效' } }, { status: 400 })));

    await expect(companionApi.sendMessage({ conversationId: '', text: '' })).rejects.toEqual(
      expect.objectContaining<Partial<CompanionApiError>>({ code: 'invalid_message', message: '消息无效' }),
    );
  });
});
