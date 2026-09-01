import { memo, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { ConversationMessage } from '../conversation/types';
import type { AssistantStreamEvent } from '../conversation/stream';
import { companionApi, type ConversationSummaryDto } from '../api/companion';
import { formatConversationTime } from '../conversation/time';
import type { MediaKind, ModelRef } from '../domain/editor';
import { MarkdownMessage } from './MarkdownMessage';
import { ImageDetailViewer } from './ImageDetailViewer';

export interface AssistantSubmission {
  prompt: string;
  conversationModelId: string;
  generationModelId: string;
  referenceAssetIds: string[];
  conversationId?: string;
}

export interface AssistantReference {
  id: string;
  name: string;
  kind: MediaKind;
  sourceUrl: string;
}

function AttachmentMedia({ attachment }: { attachment: import('../conversation/types').ConversationAttachment }) {
  const [unavailable, setUnavailable] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!attachment.sourceUrl || unavailable) return <div className="message-attachment-unavailable"><span aria-hidden="true">!</span><small>{attachment.name} · 素材不可用</small></div>;
  return <figure className={`message-attachment is-${attachment.kind}`}>
    {attachment.kind === 'image' && <button type="button" className="message-attachment-preview-button" aria-label={`查看图片详情：${attachment.name}`} onClick={() => setDetailsOpen(true)}><img src={attachment.sourceUrl} alt={attachment.name} onError={() => setUnavailable(true)} /></button>}
    {attachment.kind === 'video' && <video src={attachment.sourceUrl} controls preload="metadata" aria-label={attachment.name} onError={() => setUnavailable(true)} />}
    {attachment.kind === 'audio' && <audio src={attachment.sourceUrl} controls preload="metadata" aria-label={attachment.name} onError={() => setUnavailable(true)} />}
    <figcaption>{attachment.name}</figcaption>
    {detailsOpen && attachment.kind === 'image' && <ImageDetailViewer src={attachment.sourceUrl} alt={attachment.name} filename={attachment.name} onClose={() => setDetailsOpen(false)} />}
  </figure>;
}

interface AIAssistantProps {
  conversationModels: ModelRef[];
  generationModels: ModelRef[];
  conversationModelId: string;
  generationModelId: string;
  onConversationModelChange: (modelId: string) => void;
  onGenerationModelChange: (modelId: string) => void;
  references: AssistantReference[];
  onRemoveReference: (id: string) => void;
  onOpenSettings?: () => void;
  onSubmit: (submission: AssistantSubmission) => void | string | AsyncIterable<AssistantStreamEvent> | Promise<void | string | AsyncIterable<AssistantStreamEvent>>;
}

function AIAssistantView({
  conversationModels,
  generationModels,
  conversationModelId: initialConversationModel,
  generationModelId: initialGenerationModel,
  onConversationModelChange,
  onGenerationModelChange,
  onSubmit,
  references,
  onRemoveReference,
  onOpenSettings,
}: AIAssistantProps) {
  const [prompt, setPrompt] = useState('');
  const [conversationModelId, setConversationModelId] = useState(initialConversationModel);
  const [generationModelId, setGenerationModelId] = useState(initialGenerationModel);
  const [messages, setMessagesState] = useState<ConversationMessage[]>([]);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationSubject, setConversationSubject] = useState('新对话');
  const [conversationBusy, setConversationBusy] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerTrigger = useRef<HTMLButtonElement | null>(null);
  const [pending, setPending] = useState(false);
  const nextMessageId = useRef(1);
  const mounted = useRef(true);
  const pendingRequest = useRef(false);
  useEffect(() => setConversationModelId(initialConversationModel), [initialConversationModel]);
  useEffect(() => setGenerationModelId(initialGenerationModel), [initialGenerationModel]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const setMessages = (updater: ConversationMessage[] | ((current: ConversationMessage[]) => ConversationMessage[])) => {
    const next = typeof updater === 'function' ? updater(messagesRef.current) : updater;
    messagesRef.current = next;
    setMessagesState(next);
  };

  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages]);

  const refreshConversationList = async () => {
    const listed = await companionApi.listConversations();
    setConversations(listed.conversations ?? []);
    return listed;
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const listed = await companionApi.listConversations();
        let id = listed.lastSelectedId ?? listed.conversations[0]?.id;
        if (!id) id = (await companionApi.createLocalConversation()).id;
        const active = await companionApi.getConversation(id);
        if (cancelled) return;
        setConversations((await companionApi.listConversations()).conversations ?? []);
        setActiveConversationId(active.id);
        setConversationSubject(active.subject);
        setMessages(active.messages ?? []);
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setConversationBusy(false);
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node) && !pickerTrigger.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPickerOpen(false); pickerTrigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside, true); document.removeEventListener('keydown', closeEscape); };
  }, [pickerOpen]);

  const createConversation = async () => {
    if (conversationBusy || pendingRequest.current) return;
    setConversationBusy(true);
    try {
      const created = await companionApi.createLocalConversation();
      setActiveConversationId(created.id); setConversationSubject(created.subject); setMessages(created.messages ?? []);
      await refreshConversationList(); setPickerOpen(false);
    } finally { if (mounted.current) setConversationBusy(false); }
  };

  const selectConversation = async (id: string) => {
    if (id === activeConversationId || conversationBusy || pendingRequest.current) { setPickerOpen(false); return; }
    setConversationBusy(true);
    try {
      await companionApi.selectConversation(id);
      const selected = await companionApi.getConversation(id);
      if (!mounted.current) return;
      setActiveConversationId(selected.id); setConversationSubject(selected.subject); setMessages(selected.messages ?? []); setPickerOpen(false);
    } finally { if (mounted.current) setConversationBusy(false); }
  };

  const createTextMessage = (role: 'user' | 'status', content: string): ConversationMessage => ({
    id: `local-message-${nextMessageId.current++}`,
    role,
    content,
    createdAt: Date.now(),
  });

  const updateAssistant = (id: string, update: (message: Extract<ConversationMessage, { role: 'assistant' }>) => Extract<ConversationMessage, { role: 'assistant' }>) => {
    setMessages((current) => current.map((message) => message.id === id && message.role === 'assistant' ? update(message) : message));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pendingRequest.current) return;
    const value = prompt.trim(); if (!value) return;
    pendingRequest.current = true;
    const referenceSnapshot = references.map((reference) => ({ ...reference }));
    const userMessage: ConversationMessage = {
      ...createTextMessage('user', value),
      role: 'user',
      ...(referenceSnapshot.length ? { attachments: referenceSnapshot } : {}),
    };
    const assistantId = `local-message-${nextMessageId.current++}`;
    setMessages((current) => [...current, userMessage, {
      id: assistantId,
      role: 'assistant',
      content: '',
      state: 'streaming',
      process: [],
      processExpanded: true,
      createdAt: Date.now(),
    }]); setPrompt('');
    setPending(true);
    try {
      const referenceAssetIds = referenceSnapshot.map((reference) => reference.id);
      const reply = await onSubmit({ prompt: value, conversationModelId, generationModelId, referenceAssetIds, ...(activeConversationId ? { conversationId: activeConversationId } : {}) });
      referenceAssetIds.forEach(onRemoveReference);
      if (typeof reply === 'string') {
        if (mounted.current) updateAssistant(assistantId, (message) => ({ ...message, content: reply, state: 'complete', processExpanded: false }));
      } else if (reply && Symbol.asyncIterator in Object(reply)) {
        let terminal = false;
        for await (const streamEvent of reply as AsyncIterable<AssistantStreamEvent>) {
          if (!mounted.current) break;
          if (streamEvent.type === 'delta') {
            updateAssistant(assistantId, (message) => ({ ...message, content: message.content + streamEvent.text }));
          } else if (streamEvent.type === 'status') {
            updateAssistant(assistantId, (message) => ({
              ...message,
              process: [...message.process.filter((entry) => entry.status !== 'running'), { id: `process-${nextMessageId.current++}`, label: streamEvent.label, status: 'running' }],
            }));
          } else if (streamEvent.type === 'tool') {
            updateAssistant(assistantId, (message) => ({
              ...message,
              process: [...message.process.map((entry) => entry.status === 'running' ? { ...entry, status: 'complete' as const } : entry), {
                id: `process-${nextMessageId.current++}`,
                label: streamEvent.label,
                status: streamEvent.status,
                ...(streamEvent.result ? { result: streamEvent.result } : {}),
              }],
            }));
          } else if (streamEvent.type === 'done') {
            terminal = true;
            updateAssistant(assistantId, (message) => ({
              ...message,
              content: message.content || '已完成，但没有返回可显示的内容。',
              state: 'complete',
              process: message.process.map((entry) => entry.status === 'running' ? { ...entry, status: 'complete' } : entry),
              processExpanded: false,
            }));
          } else if (streamEvent.type === 'error') {
            terminal = true;
            updateAssistant(assistantId, (message) => ({
              ...message,
              state: 'error',
              processExpanded: true,
              process: [...message.process.map((entry) => entry.status === 'running' ? { ...entry, status: 'error' as const } : entry), {
                id: `process-${nextMessageId.current++}`,
                label: streamEvent.message,
                status: 'error',
              }],
            }));
          }
        }
        if (!terminal && mounted.current) throw new Error('AI 响应意外中断');
      } else if (mounted.current) {
        updateAssistant(assistantId, (message) => ({ ...message, content: '已完成，但没有返回可显示的内容。', state: 'complete', processExpanded: false }));
      }
    } catch (error) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : String(error);
        updateAssistant(assistantId, (assistant) => ({
          ...assistant,
          state: 'error',
          processExpanded: true,
          process: [...assistant.process, { id: `process-${nextMessageId.current++}`, label: `发送失败：${message}`, status: 'error' }],
        }));
      }
    } finally {
      if (mounted.current && activeConversationId) {
        try {
          const saved = await companionApi.replaceConversation(activeConversationId, messagesRef.current);
          setConversationSubject(saved.subject);
          await refreshConversationList();
        } catch {
          setMessages((current) => [...current, createTextMessage('status', '对话记录保存失败，请稍后重试')]);
        }
      }
      pendingRequest.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <aside className="ai-panel material-heavy" aria-label="AI 创作助手">
      <header className="assistant-heading"><div className="assistant-orb" aria-hidden="true" /><div className="assistant-title"><button ref={pickerTrigger} type="button" className="conversation-trigger" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>{conversationSubject}<span aria-hidden="true">⌄</span></button><span>已连接项目上下文</span></div><button type="button" className="assistant-settings-button" aria-label="AI 服务设置" onClick={onOpenSettings}>⚙</button><button type="button" className="new-conversation-button" aria-label="新对话" disabled={conversationBusy || pending} onClick={() => void createConversation()}>＋</button>{pickerOpen && <div ref={pickerRef} className="conversation-picker" role="dialog" aria-label="切换对话"><div className="conversation-picker-heading"><strong>最近对话</strong><span>{conversations.length}</span></div>{conversations.map((conversation) => <button type="button" key={conversation.id} aria-current={conversation.id === activeConversationId ? 'true' : undefined} onClick={() => void selectConversation(conversation.id)}><span><strong>{conversation.subject}</strong><time>{formatConversationTime(conversation.updatedAt)}</time></span><small>{conversation.preview || '暂无消息'}</small></button>)}</div>}</header>
      <div ref={conversationRef} className="conversation" aria-live="polite">
        {messages.map((message) => {
          if (message.role === 'assistant') {
            const processLabel = message.state === 'error'
              ? `执行失败 · ${message.process.length} 个步骤`
              : message.state === 'complete'
                ? `已完成 · ${message.process.length} 个步骤`
                : `执行中 · ${message.process.length} 个步骤`;
            const processId = `${message.id}-process`;
            return <div className={`message message-assistant is-${message.state}`} key={message.id}>
              {(message.process.length > 0 || message.state === 'streaming' || message.state === 'error') && <div className="assistant-process">
                <button type="button" aria-expanded={message.processExpanded} aria-controls={processId} onClick={() => updateAssistant(message.id, (current) => ({ ...current, processExpanded: !current.processExpanded }))}>
                  <span className="assistant-process-indicator" aria-hidden="true" />{processLabel}<span aria-hidden="true">⌄</span>
                </button>
                <div id={processId} className="assistant-process-body" data-state={message.processExpanded ? 'open' : 'closed'}>
                  <div>
                    {message.process.map((entry) => <div className={`assistant-process-entry is-${entry.status}`} key={entry.id}>
                      <span aria-hidden="true">{entry.status === 'complete' ? '✓' : entry.status === 'error' ? '!' : '•'}</span>
                      <div><strong>{entry.label}</strong>{entry.result && <small>{entry.result}</small>}</div>
                    </div>)}
                  </div>
                </div>
              </div>}
              {message.content && <MarkdownMessage content={message.content} />}
            </div>;
          }
          if (message.role === 'status') {
            return <div className="change-status" key={message.id}>{message.content}</div>;
          }
          return <div className="message message-user" key={message.id}>{message.content}{message.role === 'user' && message.attachments?.length ? <div className="message-attachments" aria-label="已发送附件">{message.attachments.map((attachment) => <AttachmentMedia key={attachment.id} attachment={attachment} />)}</div> : null}</div>;
        })}
      </div>
      <form className="composer" onSubmit={submit}>
        {references.length > 0 && (
          <div className="reference-chips" role="list" aria-label="会话参考素材">
            {references.map((reference) => (
              <div className="reference-chip" role="listitem" key={reference.id}>
                {reference.kind === 'image' ? <img className="reference-thumbnail" src={reference.sourceUrl} alt={`${reference.name} 附件缩略图`} /> : <span className={`reference-kind is-${reference.kind}`} aria-hidden="true">{reference.kind === 'video' ? '▶' : '♫'}</span>}
                <span className="reference-name" title={reference.name}>{reference.name}</span>
                <button
                  type="button"
                  aria-label={`移除参考素材 ${reference.name}`}
                  onClick={() => onRemoveReference(reference.id)}
                >×</button>
              </div>
            ))}
          </div>
        )}
        <textarea aria-label="编辑指令" placeholder="描述你想生成或修改的内容…" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <div className="model-controls">
          <label><span>对话</span><select aria-label="对话模型" value={conversationModelId} onChange={(event) => { setConversationModelId(event.target.value); onConversationModelChange(event.target.value); }}>{conversationModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          <label><span>生成</span><select aria-label="生成模型" value={generationModelId} onChange={(event) => { setGenerationModelId(event.target.value); onGenerationModelChange(event.target.value); }}>{generationModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          <button type="submit" aria-label="发送指令" disabled={pending || conversationBusy}>↑</button>
        </div>
      </form>
    </aside>
  );
}

export const AIAssistant = memo(AIAssistantView);
