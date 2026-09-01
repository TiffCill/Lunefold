export interface MaskedSettings {
  gptbotsApiKey: { configured: boolean; lastFour: string | null };
  modellixApiKey: { configured: boolean; lastFour: string | null };
  gptbotsRegion: 'sg' | 'jp' | 'th';
  gptbotsUserId: string;
  enabledAdapterIds: string[];
  defaultImageAspectRatio: string;
  defaultVideoDuration: number;
  defaultVideoResolution: string;
}

export interface CompanionMediaMetadata {
  id: string;
  name: string;
  relativePath: string;
  kind: 'video' | 'image' | 'audio';
  size: number;
  modifiedAt: number;
}

export type DirectorySelectionStatus = 'selected' | 'cancelled';

export interface ConversationSummaryDto {
  id: string;
  subject: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalConversationDto {
  id: string;
  subject: string;
  createdAt: number;
  updatedAt: number;
  messages: import('../conversation/types').ConversationMessage[];
}

export class CompanionApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CompanionApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const value = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    throw new CompanionApiError(
      value?.error?.code ?? 'request_failed',
      value?.error?.message ?? '本地服务请求失败',
    );
  }
  return value as T;
}

async function streamingApi(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (response.ok) return response;
  const value = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  throw new CompanionApiError(
    value?.error?.code ?? 'request_failed',
    value?.error?.message ?? '本地服务请求失败',
  );
}

export const companionApi = {
  getSettings: () => api<MaskedSettings>('/api/settings'),
  saveSettings: (settings: Record<string, unknown>) => api<MaskedSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  listConversations: () => api<{ lastSelectedId: string | null; conversations: ConversationSummaryDto[] }>('/api/conversations'),
  createLocalConversation: () => api<LocalConversationDto>('/api/conversations', { method: 'POST', body: '{}' }),
  getConversation: (id: string) => api<LocalConversationDto>(`/api/conversations/${encodeURIComponent(id)}`),
  replaceConversation: (id: string, messages: import('../conversation/types').ConversationMessage[]) => api<LocalConversationDto>(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ messages }) }),
  selectConversation: (id: string) => api<{ status: 'selected' }>(`/api/conversations/${encodeURIComponent(id)}/select`, { method: 'POST', body: '{}' }),
  sendMessage: (body: unknown) => streamingApi('/api/messages', { method: 'POST', body: JSON.stringify(body) }),
  selectMediaDirectory: () => api<{ status: DirectorySelectionStatus }>('/api/media-library/select-directory', { method: 'POST' }),
  listMedia: () => api<{ items: CompanionMediaMetadata[]; directoryConfigured: boolean }>('/api/media-library'),
  revealMedia: (mediaId: string) => api<{ status: 'revealed' }>(`/api/media/${encodeURIComponent(mediaId)}/reveal`, { method: 'POST' }),
};
