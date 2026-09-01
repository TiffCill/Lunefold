// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ModellixClient } from './client';

describe('Modellix client', () => {
  it('submits and polls an async task with bearer auth', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => String(input).includes('/tasks/')
      ? Response.json({ code: 0, data: { status: 'completed', output: ['https://files.example/out.mp4'] } })
      : Response.json({ code: 0, data: { task_id: 'task-1', status: 'pending' } }));
    const client = new ModellixClient('key', fetcher);
    await expect(client.submit('/api/v1/bytedance/model', { prompt: 'go' })).resolves.toBe('task-1');
    await expect(client.getTask('task-1')).resolves.toMatchObject({ status: 'completed' });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: expect.objectContaining({ Authorization: 'Bearer key' }) });
  });
});
