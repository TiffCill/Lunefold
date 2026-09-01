export type AssistantStreamEvent =
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; label: string; status: 'running' | 'complete' | 'error'; result?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface GptBotsRecord {
  code?: unknown;
  message?: unknown;
  data?: unknown;
}

const PROCESS_RESULT_LIMIT = 500;

function visibleText(value: unknown, limit = PROCESS_RESULT_LIMIT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return normalized ? normalized.slice(0, limit) : undefined;
}

function mapRecord(record: GptBotsRecord): AssistantStreamEvent[] {
  if (record.code === 3 && typeof record.data === 'string') {
    return record.data ? [{ type: 'delta', text: record.data }] : [];
  }
  if (record.code === 10 && Array.isArray(record.data)) {
    return record.data.flatMap((item): AssistantStreamEvent[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as { content?: unknown; from_component_name?: unknown };
      const label = visibleText(value.from_component_name, 120);
      if (!label) return [];
      const result = visibleText(value.content);
      return [{ type: 'tool', label, status: 'complete', ...(result ? { result } : {}) }];
    });
  }
  if (record.code === 0 || record.message === 'End') return [{ type: 'done' }];
  return [];
}

function extractJsonRecords(buffer: string): { records: string[]; tail: string } {
  const records: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (start < 0) {
      if (/\s/.test(character)) continue;
      if (buffer.startsWith('data:', index)) {
        index += 4;
        continue;
      }
      if (character !== '{') {
        const newline = buffer.indexOf('\n', index);
        if (newline < 0) return { records, tail: buffer.slice(index) };
        records.push(buffer.slice(index, newline).trim());
        index = newline;
        continue;
      }
      start = index;
      depth = 1;
      continue;
    }

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) {
        records.push(buffer.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return { records, tail: start >= 0 ? buffer.slice(start) : '' };
}

export function parseGptBotsStream(source: ReadableStream<Uint8Array>): ReadableStream<AssistantStreamEvent> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let cancelled = false;

  return new ReadableStream<AssistantStreamEvent>({
    async start(controller) {
      let buffer = '';
      let terminal = false;
      try {
        while (!cancelled && !terminal) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const extracted = extractJsonRecords(buffer);
          buffer = extracted.tail;
          for (const raw of extracted.records) {
            if (!raw) continue;
            let record: GptBotsRecord;
            try {
              record = JSON.parse(raw) as GptBotsRecord;
            } catch {
              controller.enqueue({ type: 'error', message: 'AI 返回了无法识别的数据' });
              terminal = true;
              break;
            }
            for (const event of mapRecord(record)) {
              controller.enqueue(event);
              if (event.type === 'done' || event.type === 'error') terminal = true;
            }
            if (terminal) break;
          }
          if (done) break;
        }
        if (!cancelled && !terminal) {
          if (buffer.trim()) controller.enqueue({ type: 'error', message: 'AI 返回了无法识别的数据' });
          else controller.enqueue({ type: 'error', message: 'AI 响应意外中断' });
        }
        if (!cancelled) controller.close();
      } catch {
        if (!cancelled) {
          controller.enqueue({ type: 'error', message: 'AI 响应意外中断' });
          controller.close();
        }
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      cancelled = true;
      await reader.cancel(reason);
    },
  });
}

export function encodeAssistantEvents(source: ReadableStream<AssistantStreamEvent>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        reader.releaseLock();
        return;
      }
      controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
