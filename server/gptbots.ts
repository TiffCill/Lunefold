import type { GptBotsRegion } from './settings.ts';

export interface GptBotsMedia {
  url?: string;
  base64_content?: string;
  format: string;
  name: string;
}

export interface GptBotsMessageInput {
  conversationId: string;
  text: string;
  images?: GptBotsMedia[];
  audios?: GptBotsMedia[];
  videos?: GptBotsMedia[];
}

export interface GptBotsClientOptions {
  apiKey: string;
  region: GptBotsRegion;
  userId: string;
  fetcher?: typeof fetch;
}

export class GptBotsClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: GptBotsClientOptions) {
    this.baseUrl = `https://api-${options.region}.gptbots.ai`;
    this.fetcher = options.fetcher ?? fetch;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    if (!this.options.apiKey) throw new Error('尚未配置 GPTBots API Key');
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GPTBots 请求失败（${response.status}）`);
    return response.json();
  }

  async createConversation(): Promise<{ conversation_id: string }> {
    return await this.post('/v1/conversation', { user_id: this.options.userId }) as { conversation_id: string };
  }

  async sendMessage(input: GptBotsMessageInput): Promise<unknown> {
    const response = await this.messageResponse(input, 'blocking');
    return response.json();
  }

  async streamMessage(input: GptBotsMessageInput): Promise<ReadableStream<Uint8Array>> {
    const response = await this.messageResponse(input, 'streaming');
    if (!response.body) throw new Error('GPTBots 未返回可读取的响应');
    return response.body;
  }

  private async messageResponse(input: GptBotsMessageInput, responseMode: 'blocking' | 'streaming'): Promise<Response> {
    if (!this.options.apiKey) throw new Error('尚未配置 GPTBots API Key');
    const content: unknown[] = [{ type: 'text', text: input.text }];
    if (input.images?.length) content.push({ type: 'image', image: input.images });
    if (input.audios?.length) content.push({ type: 'audio', audio: input.audios });
    if (input.videos?.length) content.push({ type: 'video', video: input.videos });
    const response = await this.fetcher(`${this.baseUrl}/v2/conversation/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: input.conversationId,
        response_mode: responseMode,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!response.ok) throw new Error(`GPTBots 请求失败（${response.status}）`);
    return response;
  }
}
