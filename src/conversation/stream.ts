import { CompanionApiError } from '../api/companion';

export type AssistantStreamEvent =
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; label: string; status: 'running' | 'complete' | 'error'; result?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

function isEvent(value: unknown): value is AssistantStreamEvent {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'done') return true;
  if (event.type === 'status') return typeof event.label === 'string';
  if (event.type === 'delta') return typeof event.text === 'string';
  if (event.type === 'error') return typeof event.message === 'string';
  return event.type === 'tool'
    && typeof event.label === 'string'
    && (event.status === 'running' || event.status === 'complete' || event.status === 'error')
    && (event.result === undefined || typeof event.result === 'string');
}

export async function* streamAssistantResponse(response: Response): AsyncGenerator<AssistantStreamEvent> {
  if (!response.body) throw new CompanionApiError('invalid_stream', 'AI 未返回可读取的响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  let completedRead = false;
  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      completedRead = done;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          throw new CompanionApiError('invalid_stream', 'AI 返回了无法识别的数据');
        }
        if (!isEvent(value)) throw new CompanionApiError('invalid_stream', 'AI 返回了无法识别的数据');
        yield value;
        if (value.type === 'done' || value.type === 'error') terminal = true;
      }
      if (done) break;
    }
    if (!terminal) {
      if (buffer.trim()) throw new CompanionApiError('invalid_stream', 'AI 返回了无法识别的数据');
      throw new CompanionApiError('interrupted_stream', 'AI 响应意外中断');
    }
  } finally {
    if (!completedRead && !terminal) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
