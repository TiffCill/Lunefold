import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { conversationModels, generationModels } from '../domain/editor';
import type { AssistantStreamEvent } from '../conversation/stream';
import { AIAssistant, type AssistantSubmission } from './AIAssistant';

const references = [
  { id: 'image-a', name: 'very-long-reference-image-name.png', kind: 'image' as const, sourceUrl: '/api/media/image-a/content' },
  { id: 'audio-b', name: 'voiceover.wav', kind: 'audio' as const, sourceUrl: '/api/media/audio-b/content' },
];
const emptyReferenceProps = { references: [], onRemoveReference: vi.fn() };

function controlledEvents() {
  const queued: AssistantStreamEvent[] = [];
  const waiting: Array<(value: IteratorResult<AssistantStreamEvent>) => void> = [];
  return {
    stream: {
      [Symbol.asyncIterator]() { return this; },
      next() {
        const value = queued.shift();
        if (value) return Promise.resolve({ done: false as const, value });
        return new Promise<IteratorResult<AssistantStreamEvent>>((resolve) => waiting.push(resolve));
      },
    },
    push(value: AssistantStreamEvent) {
      const resolve = waiting.shift();
      if (resolve) resolve({ done: false, value });
      else queued.push(value);
    },
  };
}

describe('AI assistant model controls', () => {
  test('streams core answer text while showing real activity, then collapses completed activity', async () => {
    const user = userEvent.setup();
    const events = controlledEvents();
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={() => events.stream}
    />);

    await user.type(screen.getByLabelText('编辑指令'), '调整节奏');
    await user.click(screen.getByRole('button', { name: '发送指令' }));
    await act(async () => events.push({ type: 'status', label: '正在分析时间线' }));
    expect(screen.getByText('正在分析时间线')).toBeVisible();

    await act(async () => events.push({ type: 'delta', text: '已调整' }));
    expect(screen.getByText('已调整')).toBeVisible();
    await act(async () => events.push({ type: 'tool', label: '修改片段', status: 'complete', result: '3 项' }));
    await act(async () => events.push({ type: 'delta', text: '剪辑节奏。' }));
    await act(async () => events.push({ type: 'done' }));

    expect(await screen.findByText('已调整剪辑节奏。')).toBeVisible();
    const disclosure = screen.getByRole('button', { name: /已完成 · 2 个步骤/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(document.body.textContent).not.toContain('{"type"');

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('修改片段')).toBeVisible();
    expect(screen.getByText('3 项')).toBeVisible();
  });

  test('keeps the conversation pinned to the bottom for sent and streaming messages', async () => {
    const user = userEvent.setup();
    const events = controlledEvents();
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={() => events.stream}
    />);
    const conversation = document.querySelector<HTMLElement>('.conversation')!;
    Object.defineProperty(conversation, 'scrollHeight', { configurable: true, value: 640 });
    conversation.scrollTop = 0;

    await user.type(screen.getByLabelText('编辑指令'), 'Keep following');
    await user.click(screen.getByRole('button', { name: '发送指令' }));
    await waitFor(() => expect(conversation.scrollTop).toBe(640));

    conversation.scrollTop = 0;
    await act(async () => { events.push({ type: 'delta', text: 'Streaming reply' }); });
    await waitFor(() => expect(conversation.scrollTop).toBe(640));
  });

  test('restores, switches, and creates local conversations from the header picker', async () => {
    const user = userEvent.setup();
    const summaries = [
      { id: 'c2', subject: '第二个主题', preview: '第二段摘要', createdAt: 100, updatedAt: Date.now() },
      { id: 'c1', subject: '上次沟通主题', preview: '第一段摘要', createdAt: 50, updatedAt: Date.now() - 120_000 },
    ];
    const histories = new Map([
      ['c1', { id: 'c1', subject: '上次沟通主题', createdAt: 50, updatedAt: 60, messages: [{ id: 'm1', role: 'assistant', content: '已恢复的历史回答', state: 'complete', process: [], processExpanded: false, createdAt: 60 }] }],
      ['c2', { id: 'c2', subject: '第二个主题', createdAt: 100, updatedAt: 110, messages: [{ id: 'm2', role: 'user', content: '第二个对话内容', createdAt: 110 }] }],
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/conversations' && (!init?.method || init.method === 'GET')) return Response.json({ lastSelectedId: 'c1', conversations: summaries });
      if (url === '/api/conversations' && init?.method === 'POST') return Response.json({ id: 'c3', subject: '新对话', createdAt: 200, updatedAt: 200, messages: [] });
      if (url.endsWith('/select')) return Response.json({ status: 'selected' });
      const id = url.split('/').pop()!;
      return Response.json(histories.get(id));
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      render(<AIAssistant conversationModels={conversationModels} generationModels={generationModels} conversationModelId="gpt-5.5" generationModelId="sora-2-pro" onConversationModelChange={vi.fn()} onGenerationModelChange={vi.fn()} {...emptyReferenceProps} onSubmit={vi.fn()} />);
      expect(await screen.findByText('已恢复的历史回答')).toBeVisible();
      const trigger = screen.getByRole('button', { name: /上次沟通主题/ });
      await user.click(trigger);
      expect(screen.getByRole('dialog', { name: '切换对话' })).toHaveTextContent('第二个主题');
      expect(screen.getByText('第二段摘要')).toBeVisible();
      await user.click(screen.getByRole('button', { name: /第二个主题/ }));
      expect(await screen.findByText('第二个对话内容')).toBeVisible();
      await user.click(screen.getByRole('button', { name: '新对话' }));
      expect(screen.queryByText('第二个对话内容')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('keeps partial content and execution details open after a stream error', async () => {
    const user = userEvent.setup();
    async function* response() {
      yield { type: 'delta', text: '已完成一部分' } as const;
      yield { type: 'error', message: 'AI 响应意外中断' } as const;
    }
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={() => response()}
    />);

    await user.type(screen.getByLabelText('编辑指令'), '开始');
    await user.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByText('已完成一部分')).toBeVisible();
    expect(screen.getByText('AI 响应意外中断')).toBeVisible();
    expect(screen.getByRole('button', { name: /执行失败/ })).toHaveAttribute('aria-expanded', 'true');
  });
  test('changes conversation and generation models independently and submits exact IDs', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={submit}
    />);

    await user.selectOptions(screen.getByLabelText('对话模型'), 'gpt-5-mini');
    await user.selectOptions(screen.getByLabelText('生成模型'), 'gpt-image-2');
    await user.type(screen.getByLabelText('编辑指令'), '让副歌部分切得更快');
    await user.click(screen.getByRole('button', { name: '发送指令' }));

    expect(submit).toHaveBeenCalledWith({
      prompt: '让副歌部分切得更快',
      conversationModelId: 'gpt-5-mini',
      generationModelId: 'gpt-image-2',
      referenceAssetIds: [],
    });
  });

  test('renders one accessible chip per reference and removes only the requested ID', async () => {
    const user = userEvent.setup();
    const removeReference = vi.fn();
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      references={references}
      onRemoveReference={removeReference}
      onSubmit={vi.fn()}
    />);

    const referenceList = screen.getByRole('list', { name: '会话参考素材' });
    expect(within(referenceList).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('very-long-reference-image-name.png')).toHaveAttribute('title', 'very-long-reference-image-name.png');
    expect(screen.getByText('voiceover.wav')).toHaveAttribute('title', 'voiceover.wav');

    await user.click(screen.getByRole('button', { name: '移除参考素材 very-long-reference-image-name.png' }));

    expect(removeReference).toHaveBeenCalledTimes(1);
    expect(removeReference).toHaveBeenCalledWith('image-a');
  });

  test('submits an ordered reference snapshot that later prop changes cannot mutate', async () => {
    const user = userEvent.setup();
    let capturedSubmission: AssistantSubmission | undefined;
    const removeReference = vi.fn();
    const { rerender } = render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      references={references}
      onRemoveReference={removeReference}
      onSubmit={(submission) => { capturedSubmission = submission; }}
    />);

    await user.type(screen.getByLabelText('编辑指令'), 'Use both references');
    await user.click(screen.getByRole('button', { name: '发送指令' }));
    expect(capturedSubmission?.referenceAssetIds).toEqual(['image-a', 'audio-b']);
    expect(removeReference.mock.calls.map(([id]) => id)).toEqual(['image-a', 'audio-b']);
    const sentMessage = screen.getByText('Use both references').closest<HTMLElement>('.message-user')!;
    expect(within(sentMessage).getByText('very-long-reference-image-name.png')).toBeInTheDocument();
    expect(within(sentMessage).getByText('voiceover.wav')).toBeInTheDocument();

    rerender(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      references={[references[1]]}
      onRemoveReference={vi.fn()}
      onSubmit={vi.fn()}
    />);

    expect(capturedSubmission?.referenceAssetIds).toEqual(['image-a', 'audio-b']);
    expect(within(sentMessage).getByText('voiceover.wav')).toBeInTheDocument();
  });

  test('shows image thumbnails in the composer and renders sent image, video, and audio media', async () => {
    const user = userEvent.setup();
    const mediaReferences = [
      { id: 'image', name: 'frame.png', kind: 'image' as const, sourceUrl: '/media/frame.png' },
      { id: 'video', name: 'clip.mp4', kind: 'video' as const, sourceUrl: '/media/clip.mp4' },
      { id: 'audio', name: 'score.mp3', kind: 'audio' as const, sourceUrl: '/media/score.mp3' },
    ];
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      references={mediaReferences}
      onRemoveReference={vi.fn()}
      onSubmit={vi.fn()}
    />);

    expect(screen.getByRole('img', { name: 'frame.png 附件缩略图' })).toHaveAttribute('src', '/media/frame.png');
    await user.type(screen.getByLabelText('编辑指令'), 'Use these files');
    await user.click(screen.getByRole('button', { name: '发送指令' }));

    const sentMessage = screen.getByText('Use these files').closest<HTMLElement>('.message-user')!;
    expect(within(sentMessage).getByRole('img', { name: 'frame.png' })).toHaveAttribute('src', '/media/frame.png');
    expect(sentMessage.querySelector('video')).toHaveAttribute('src', '/media/clip.mp4');
    expect(sentMessage.querySelector('audio')).toHaveAttribute('src', '/media/score.mp3');
    expect(within(sentMessage).getByText('clip.mp4')).toBeInTheDocument();
    expect(within(sentMessage).getByText('score.mp3')).toBeInTheDocument();
  });

  test('renders user input literally and assistant replies as semantic GFM', async () => {
    const user = userEvent.setup();
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={async () => '## Assistant plan\n- First cut\n\n| Shot | State |\n| --- | --- |\n| Intro | Ready |'}
    />);

    await user.type(screen.getByLabelText('编辑指令'), '## User title');
    await user.click(screen.getByRole('button', { name: '发送指令' }));

    expect(await screen.findByRole('heading', { name: 'Assistant plan' })).toBeVisible();
    expect(screen.getByRole('table')).toHaveTextContent('Intro');
    expect(screen.getByText('## User title')).toHaveClass('message-user');
    expect(screen.queryByRole('heading', { name: 'User title' })).toBeNull();
  });

  test('keeps user and assistant messages in conversational order', async () => {
    const user = userEvent.setup();
    let submission = 0;
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={async () => (submission++ === 0 ? 'First reply' : 'Second reply')}
    />);

    await user.type(screen.getByLabelText('编辑指令'), 'First prompt');
    await user.click(screen.getByRole('button', { name: '发送指令' }));
    await screen.findByText('First reply');
    await user.type(screen.getByLabelText('编辑指令'), 'Second prompt');
    await user.click(screen.getByRole('button', { name: '发送指令' }));
    await screen.findByText('Second reply');

    const conversation = screen.getByLabelText('AI 创作助手').querySelector('.conversation');
    const conversationItems = Array.from(conversation?.children ?? []);
    const itemIndex = (text: string) => conversationItems.findIndex((item) => item.textContent === text);
    const firstPromptIndex = itemIndex('First prompt');
    const firstReplyIndex = itemIndex('First reply');
    const secondPromptIndex = itemIndex('Second prompt');
    const secondReplyIndex = itemIndex('Second reply');
    expect(firstPromptIndex).toBeGreaterThan(-1);
    expect(firstPromptIndex).toBeLessThan(firstReplyIndex);
    expect(firstReplyIndex).toBeLessThan(secondPromptIndex);
    expect(secondPromptIndex).toBeLessThan(secondReplyIndex);
  });

  test('renders failed submissions as literal status messages', async () => {
    const user = userEvent.setup();
    render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={async () => { throw new Error('## Retry later'); }}
    />);

    await user.type(screen.getByLabelText('编辑指令'), 'Start render');
    await user.click(screen.getByRole('button', { name: '发送指令' }));

    const status = await screen.findByText('发送失败：## Retry later');
    expect(status.closest('.assistant-process-entry')).toHaveClass('is-error');
    expect(screen.getByRole('button', { name: /执行失败/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('heading', { name: 'Retry later' })).toBeNull();
  });

  test('ignores another form submission while a request is pending', async () => {
    const user = userEvent.setup();
    let finishRequest: ((reply: string) => void) | undefined;
    let submissionCount = 0;
    const pendingReply = new Promise<string>((resolve) => { finishRequest = resolve; });
    const { unmount } = render(<AIAssistant
      conversationModels={conversationModels}
      generationModels={generationModels}
      conversationModelId="gpt-5.5"
      generationModelId="sora-2-pro"
      onConversationModelChange={vi.fn()}
      onGenerationModelChange={vi.fn()}
      {...emptyReferenceProps}
      onSubmit={() => { submissionCount += 1; return pendingReply; }}
    />);

    const textarea = screen.getByLabelText('编辑指令');
    const sendButton = screen.getByRole('button', { name: '发送指令' });
    await user.type(textarea, 'First prompt');
    await user.click(sendButton);
    expect(sendButton).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'Second prompt' } });
    fireEvent.submit(sendButton.closest('form') as HTMLFormElement);

    expect(submissionCount).toBe(1);
    const conversation = screen.getByLabelText('AI 创作助手').querySelector('.conversation');
    expect(Array.from(conversation?.children ?? []).some((item) => item.textContent === 'Second prompt')).toBe(false);

    unmount();
    await act(async () => { finishRequest?.('Completed after unmount'); });
  });
});
