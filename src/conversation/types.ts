export interface ProcessEntry {
  id: string;
  label: string;
  status: 'running' | 'complete' | 'error';
  result?: string;
}

export interface ConversationAttachment {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  sourceUrl?: string;
}

export type ConversationMessage =
  | { id: string; role: 'user'; content: string; attachments?: ConversationAttachment[]; createdAt: number }
  | { id: string; role: 'status'; content: string; createdAt: number }
  | {
      id: string;
      role: 'assistant';
      content: string;
      state: 'streaming' | 'complete' | 'error';
      process: ProcessEntry[];
      processExpanded: boolean;
      createdAt: number;
    };
