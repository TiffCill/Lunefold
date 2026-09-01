export interface ModellixTask { status: string; output?: unknown; [key: string]: unknown }

export class ModellixClient {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  private async request(path: string, init?: RequestInit): Promise<Record<string, any>> {
    if (!this.apiKey) throw new Error('尚未配置 Modellix API Key');
    const response = await this.fetcher(`https://api.modellix.ai${path}`, { ...init, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', ...init?.headers } });
    if (!response.ok) throw new Error(`Modellix 请求失败（${response.status}）`);
    const value = await response.json() as Record<string, any>;
    if (value.code !== undefined && value.code !== 0) throw new Error('Modellix 返回任务错误');
    return value;
  }
  async submit(endpoint: string, body: Record<string, unknown>): Promise<string> {
    const value = await this.request(endpoint, { method: 'POST', body: JSON.stringify(body) });
    const taskId = value.data?.task_id;
    if (typeof taskId !== 'string') throw new Error('Modellix 未返回任务 ID');
    return taskId;
  }
  async getTask(taskId: string): Promise<ModellixTask> {
    const value = await this.request(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
    return value.data as ModellixTask;
  }
}
