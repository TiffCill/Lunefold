import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredProcessEntry {
  id: string;
  label: string;
  status: 'running' | 'complete' | 'error';
  result?: string;
}

export interface StoredConversationAttachment {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  sourceUrl?: string;
}

export type StoredConversationMessage =
  | { id: string; role: 'user'; content: string; attachments?: StoredConversationAttachment[]; createdAt: number }
  | { id: string; role: 'status'; content: string; createdAt: number }
  | { id: string; role: 'assistant'; content: string; state: 'streaming' | 'complete' | 'error'; process: StoredProcessEntry[]; processExpanded: boolean; createdAt: number };

export interface LocalConversation {
  id: string;
  remoteConversationId: string | null;
  subject: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredConversationMessage[];
}

export interface ConversationSummary {
  id: string;
  subject: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

interface ConversationDocumentV1 {
  version: 1;
  lastSelectedId: string | null;
  conversations: LocalConversation[];
}

export interface ConversationReplacement {
  messages: StoredConversationMessage[];
}

const emptyDocument = (): ConversationDocumentV1 => ({ version: 1, lastSelectedId: null, conversations: [] });
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const truncate = (text: string, limit: number) => {
  const points = Array.from(normalize(text));
  return points.length > limit ? `${points.slice(0, limit).join('')}…` : points.join('');
};

export function deriveConversationSubject(text: string): string {
  return truncate(text, 20) || '新对话';
}

export function deriveConversationPreview(messages: StoredConversationMessage[]): string {
  const message = [...messages].reverse().find((item) => (item.role === 'user' || item.role === 'assistant') && normalize(item.content));
  return message ? truncate(message.content, 36) : '';
}

function validMessage(value: unknown): value is StoredConversationMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.content !== 'string' || typeof item.createdAt !== 'number') return false;
  if (item.role === 'status') return true;
  if (item.role === 'user') return item.attachments === undefined || (Array.isArray(item.attachments) && item.attachments.every((attachment) => {
    if (!attachment || typeof attachment !== 'object') return false;
    const candidate = attachment as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.name === 'string'
      && (candidate.sourceUrl === undefined || typeof candidate.sourceUrl === 'string')
      && (candidate.kind === 'video' || candidate.kind === 'image' || candidate.kind === 'audio');
  }));
  return item.role === 'assistant' && (item.state === 'streaming' || item.state === 'complete' || item.state === 'error') && Array.isArray(item.process) && typeof item.processExpanded === 'boolean';
}

function validConversation(value: unknown): value is LocalConversation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && (item.remoteConversationId === null || typeof item.remoteConversationId === 'string')
    && typeof item.subject === 'string' && typeof item.createdAt === 'number' && typeof item.updatedAt === 'number'
    && Array.isArray(item.messages) && item.messages.every(validMessage);
}

const clone = <T>(value: T): T => structuredClone(value);

export class ConversationStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly filename: string, options: { now?: () => number; idFactory?: () => string } = {}) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private async readDocument(): Promise<ConversationDocumentV1> {
    try {
      const value = JSON.parse(await readFile(this.filename, 'utf8')) as Partial<ConversationDocumentV1>;
      if (value.version !== 1 || !Array.isArray(value.conversations) || !value.conversations.every(validConversation)) return emptyDocument();
      return { version: 1, lastSelectedId: typeof value.lastSelectedId === 'string' ? value.lastSelectedId : null, conversations: value.conversations };
    } catch {
      return emptyDocument();
    }
  }

  private async writeDocument(document: ConversationDocumentV1) {
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filename);
    await chmod(this.filename, 0o600);
  }

  private mutate<T>(operation: (document: ConversationDocumentV1) => Promise<T> | T): Promise<T> {
    const result = this.queue.then(async () => operation(await this.readDocument()));
    this.queue = result.catch(() => undefined);
    return result;
  }

  async list(): Promise<{ lastSelectedId: string | null; conversations: ConversationSummary[] }> {
    await this.queue;
    const document = await this.readDocument();
    return {
      lastSelectedId: document.lastSelectedId,
      conversations: document.conversations.map((item) => ({
        id: item.id, subject: item.subject, preview: deriveConversationPreview(item.messages), createdAt: item.createdAt, updatedAt: item.updatedAt,
      })).sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    };
  }

  async create(): Promise<LocalConversation> {
    return this.mutate(async (document) => {
      const timestamp = this.now();
      const conversation: LocalConversation = { id: this.idFactory(), remoteConversationId: null, subject: '新对话', createdAt: timestamp, updatedAt: timestamp, messages: [] };
      document.conversations.push(conversation);
      document.lastSelectedId = conversation.id;
      await this.writeDocument(document);
      return clone(conversation);
    });
  }

  async get(id: string): Promise<LocalConversation | null> {
    await this.queue;
    const found = (await this.readDocument()).conversations.find((item) => item.id === id);
    return found ? clone(found) : null;
  }

  async select(id: string): Promise<void> {
    await this.mutate(async (document) => {
      if (!document.conversations.some((item) => item.id === id)) throw Object.assign(new Error('Conversation not found'), { code: 'conversation_not_found' });
      document.lastSelectedId = id;
      await this.writeDocument(document);
    });
  }

  async replace(id: string, input: ConversationReplacement): Promise<LocalConversation> {
    if (!Array.isArray(input.messages) || !input.messages.every(validMessage)) throw Object.assign(new Error('Invalid conversation'), { code: 'invalid_conversation' });
    return this.mutate(async (document) => {
      const conversation = document.conversations.find((item) => item.id === id);
      if (!conversation) throw Object.assign(new Error('Conversation not found'), { code: 'conversation_not_found' });
      conversation.messages = clone(input.messages);
      const firstUser = conversation.messages.find((item) => item.role === 'user');
      if (firstUser) conversation.subject = deriveConversationSubject(firstUser.content);
      conversation.updatedAt = this.now();
      await this.writeDocument(document);
      return clone(conversation);
    });
  }

  async setRemoteConversationId(id: string, remoteConversationId: string): Promise<LocalConversation> {
    return this.mutate(async (document) => {
      const conversation = document.conversations.find((item) => item.id === id);
      if (!conversation) throw Object.assign(new Error('Conversation not found'), { code: 'conversation_not_found' });
      conversation.remoteConversationId = remoteConversationId;
      await this.writeDocument(document);
      return clone(conversation);
    });
  }
}
