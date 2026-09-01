import { describe, expect, it } from 'vitest';
import { CompanionApiError } from '../api/companion';
import { streamAssistantResponse, type AssistantStreamEvent } from './stream';

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }));
}

async function collect(iterable: AsyncIterable<AssistantStreamEvent>) {
  const values: AssistantStreamEvent[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe('assistant response decoder', () => {
  it('decodes complete validated events across arbitrary UTF-8 chunks', async () => {
    const encoded = new TextEncoder().encode('{"type":"delta","text":"你好"}\n{"type":"done"}\n');
    const splitAt = encoded.indexOf(0xe5) + 1;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
      },
    }));

    await expect(collect(streamAssistantResponse(response))).resolves.toEqual([
      { type: 'delta', text: '你好' },
      { type: 'done' },
    ]);
  });

  it('rejects malformed, unknown, and prematurely ended application streams', async () => {
    await expect(collect(streamAssistantResponse(responseFromChunks(['{broken}\n'])))).rejects.toEqual(
      expect.objectContaining<Partial<CompanionApiError>>({ code: 'invalid_stream' }),
    );
    await expect(collect(streamAssistantResponse(responseFromChunks(['{"type":"private","secret":true}\n'])))).rejects.toEqual(
      expect.objectContaining<Partial<CompanionApiError>>({ code: 'invalid_stream' }),
    );
    await expect(collect(streamAssistantResponse(responseFromChunks(['{"type":"delta","text":"部分"}\n'])))).rejects.toEqual(
      expect.objectContaining<Partial<CompanionApiError>>({ code: 'interrupted_stream' }),
    );
  });

  it('preserves a sanitized server error as a terminal event', async () => {
    await expect(collect(streamAssistantResponse(responseFromChunks([
      '{"type":"status","label":"正在连接 AI"}\n{"type":"error","message":"AI 响应意外中断"}\n',
    ])))).resolves.toEqual([
      { type: 'status', label: '正在连接 AI' },
      { type: 'error', message: 'AI 响应意外中断' },
    ]);
  });
});
