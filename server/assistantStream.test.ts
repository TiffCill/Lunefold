import { describe, expect, it } from 'vitest';
import { encodeAssistantEvents, parseGptBotsStream, type AssistantStreamEvent } from './assistantStream.ts';

function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe('assistant stream normalization', () => {
  it('preserves UTF-8 text across chunks and exposes only useful answer and component events', async () => {
    const encoded = new TextEncoder().encode([
      '{"code":11,"message":"MessageInfo","data":{"message_id":"m1"}}\n',
      '{"code":3,"message":"Text","data":"你好"}\n',
      '{"code":10,"message":"FlowOutput","data":[{"content":"找到 2 个片段","from_component_name":"检索时间线"}]}\n',
      '{"code":0,"message":"End","data":null}\n',
    ].join(''));
    const splitAt = encoded.indexOf(0xe5) + 1;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
      },
    });

    await expect(collect(parseGptBotsStream(source))).resolves.toEqual([
      { type: 'delta', text: '你好' },
      { type: 'tool', label: '检索时间线', status: 'complete', result: '找到 2 个片段' },
      { type: 'done' },
    ]);
  });

  it('accepts SSE data prefixes and ignores unknown additive records', async () => {
    const source = byteStream([
      'data: {"code":99,"message":"FutureEvent","data":{"private":"value"}}\n\n',
      'data: {"code":3,"message":"Text","data":"核心回答"}\n\n',
      'data: {"code":0,"message":"End","data":null}\n\n',
    ]);

    await expect(collect(parseGptBotsStream(source))).resolves.toEqual([
      { type: 'delta', text: '核心回答' },
      { type: 'done' },
    ]);
  });

  it('sanitizes malformed and prematurely ended streams', async () => {
    await expect(collect(parseGptBotsStream(byteStream(['{broken}\n'])))).resolves.toEqual([
      { type: 'error', message: 'AI 返回了无法识别的数据' },
    ]);
    await expect(collect(parseGptBotsStream(byteStream(['{"code":3,"message":"Text","data":"部分"}\n'])))).resolves.toEqual([
      { type: 'delta', text: '部分' },
      { type: 'error', message: 'AI 响应意外中断' },
    ]);
  });

  it('limits process results and encodes one application event per line', async () => {
    const source = byteStream([
      `${JSON.stringify({ code: 10, message: 'FlowOutput', data: [{ content: 'x'.repeat(700), from_component_name: '工具' }] })}\n`,
      '{"code":0,"message":"End","data":null}\n',
    ]);
    const events = await collect(parseGptBotsStream(source));
    expect(events[0]).toMatchObject({ type: 'tool', label: '工具', status: 'complete' });
    expect((events[0] as Extract<AssistantStreamEvent, { type: 'tool' }>).result).toHaveLength(500);

    const text = await new Response(encodeAssistantEvents(new ReadableStream<AssistantStreamEvent>({
      start(controller) {
        controller.enqueue({ type: 'delta', text: '回答' });
        controller.enqueue({ type: 'done' });
        controller.close();
      },
    }))).text();
    expect(text).toBe('{"type":"delta","text":"回答"}\n{"type":"done"}\n');
  });
});
