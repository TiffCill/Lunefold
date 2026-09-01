import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import { createDemoState } from './domain/editor';

afterEach(() => {
  vi.unstubAllGlobals();
});

function holdMediaLibraryRequest() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
}

describe('desktop editor shell', () => {
  test('groups global actions with the modules they affect instead of a top navigation bar', () => {
    holdMediaLibraryRequest();
    render(<App initialState={createDemoState()} />);

    expect(screen.queryByRole('button', { name: '未命名项目⌄' })).not.toBeInTheDocument();
    const assistant = screen.getByRole('complementary', { name: 'AI 创作助手' });
    expect(within(assistant).getByRole('button', { name: 'AI 服务设置' })).toBeInTheDocument();
    const preview = screen.getByRole('region', { name: '预览器' });
    expect(within(preview).getByRole('button', { name: '撤销' })).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: '重做' })).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: '导出' })).toBeInTheDocument();
  });

  test('starts without demo media and asks the user to choose a directory', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/media-library'
      ? Response.json({ items: [], directoryConfigured: false })
      : Response.json({ lastSelectedId: null, conversations: [] })));
    render(<App />);

    await screen.findByText('请选择素材目录');
    expect(screen.queryByText(/花园漫步|人物剪影|液态光影|Midnight Drive/)).not.toBeInTheDocument();
    expect(screen.getByText('时间线空白')).toBeInTheDocument();
    expect(screen.getByText('V1')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '播放进度' })).toHaveAttribute('max', '0');
  });

  test('single-click previews an image asset without moving the timeline', async () => {
    holdMediaLibraryRequest();
    const user = userEvent.setup();
    render(<App initialState={createDemoState()} />);

    const timelineSeek = screen.getByRole('slider', { name: '时间线定位' }) as HTMLInputElement;
    expect(timelineSeek.value).toBe('0');
    await user.click(screen.getByRole('gridcell', { name: /人物剪影/ }));
    expect(screen.getByRole('img', { name: '人物剪影素材预览' })).toBeInTheDocument();
    expect(timelineSeek.value).toBe('0');
  });

  test('timeline pointer or keyboard focus restores timeline preview', async () => {
    holdMediaLibraryRequest();
    const user = userEvent.setup();
    render(<App initialState={createDemoState()} />);

    await user.click(screen.getByRole('gridcell', { name: /人物剪影/ }));
    fireEvent.pointerDown(screen.getByRole('region', { name: '时间线' }));
    expect(screen.getByLabelText('花园漫步视频画面')).toBeInTheDocument();
    await user.click(screen.getByRole('gridcell', { name: /人物剪影/ }));
    fireEvent.focus(screen.getByRole('slider', { name: '时间线播放头' }));
    expect(screen.getByLabelText('花园漫步视频画面')).toBeInTheDocument();
  });

  test('timeline spans the workspace below all three upper modules', () => {
    holdMediaLibraryRequest();
    render(<App initialState={createDemoState()} />);

    expect(screen.getByRole('complementary', { name: '素材库' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '预览器' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'AI 创作助手' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '时间线' })).toHaveClass('timeline');
  });

  test('seeking the timeline switches visual clips and shows blank space', async () => {
    holdMediaLibraryRequest();
    render(<App initialState={createDemoState()} />);
    fireEvent.change(screen.getByRole('slider', { name: '时间线定位' }), { target: { value: '5' } });
    await waitFor(() => expect(screen.getByRole('img', { name: '人物剪影预览' })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('slider', { name: '时间线定位' }), { target: { value: '13' } });
    await waitFor(() => expect(screen.getByText('时间线空白')).toBeInTheDocument());
  });

  test('exposes an adjustable playable media workspace', () => {
    holdMediaLibraryRequest();
    render(<App initialState={createDemoState()} />);
    expect(screen.getByRole('button', { name: '选择素材目录' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整素材库宽度' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整创作助手宽度' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整时间线高度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加视频轨道' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加音频轨道' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '播放进度' })).toHaveAttribute('max', '28');
  });

  test.each([
    { response: { items: [{ id: 'local', name: 'local.png', relativePath: 'local.png', kind: 'image', size: 12, modifiedAt: 7 }], directoryConfigured: true }, text: '本地目录 · 1 项' },
    { response: { items: [], directoryConfigured: true }, text: '目录中没有支持的素材' },
  ])('renders the restored companion library state: $text', async ({ response, text }) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(response)));
    render(<App initialState={createDemoState()} />);

    await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
    if (response.items.length > 0) {
      expect(screen.getAllByRole('gridcell', { name: /local\.png/ })).toHaveLength(1);
    }
  });

  test('removes switched-directory items from the library without breaking an inserted timeline snapshot', async () => {
    const firstItem = { id: 'first-local', name: 'first-local.png', relativePath: 'first-local.png', kind: 'image', size: 12, modifiedAt: 7 };
    const secondItem = { id: 'second-local', name: 'second-local.png', relativePath: 'second-local.png', kind: 'image', size: 15, modifiedAt: 8 };
    let listCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/media-library/select-directory') return Response.json({ status: 'selected' });
      if (url === '/api/conversations') return Response.json({ lastSelectedId: null, conversations: [] });
      listCount += 1;
      return Response.json({ items: listCount === 1 ? [firstItem] : [secondItem] });
    }));
    render(<App initialState={createDemoState()} />);
    const firstTile = await screen.findByRole('gridcell', { name: /first-local\.png/ });

    const lane = document.querySelector<HTMLElement>('[data-track-id="video-2"]');
    expect(lane).not.toBeNull();
    await waitFor(() => {
      const drop = createEvent.drop(lane!);
      Object.defineProperties(drop, {
        clientX: { value: 500 },
        dataTransfer: { value: { getData: () => firstItem.id } },
      });
      fireEvent(lane!, drop);
      expect(screen.getByRole('button', { name: /first-local\.png，5\.0 秒/ })).toBeInTheDocument();
    });
    fireEvent.contextMenu(firstTile, { clientX: 80, clientY: 60 });
    await userEvent.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    expect(screen.getByRole('button', { name: '移除参考素材 first-local.png' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: '时间线定位' }), { target: { value: '13' } });
    const historicPreview = await screen.findByRole('img', { name: 'first-local.png预览' });
    expect(historicPreview).toHaveAttribute('src', '/api/media/first-local/content');

    fireEvent.click(screen.getByRole('button', { name: '选择素材目录' }));
    await screen.findByRole('gridcell', { name: /second-local\.png/ });

    expect(screen.queryByRole('gridcell', { name: /first-local\.png/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /first-local\.png，5\.0 秒/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'first-local.png预览' })).toHaveAttribute('src', '/api/media/first-local/content');
    expect(screen.getByRole('button', { name: '移除参考素材 first-local.png' })).toBeInTheDocument();
  });

  test('renders scanning and safe error states from the companion library', async () => {
    let rejectRequest!: (reason: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectRequest = reject; })));
    render(<App initialState={createDemoState()} />);
    expect(screen.getByText('正在扫描目录…')).toBeInTheDocument();

    rejectRequest(new Error('failed at /Users/private/media'));
    await waitFor(() => expect(screen.getByText('素材库读取失败，请重试或重新选择目录')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('/Users/private');
  });

  test.each([
    { kind: 'video', id: 'short-video', name: 'short.mp4', duration: 1.25, expectedLabel: 'short.mp4，1.3 秒' },
    { kind: 'audio', id: 'long-audio', name: 'long.mp3', duration: 7265.25, expectedLabel: 'long.mp3，7265.3 秒' },
  ] as const)('uses probed source duration when inserting $kind media', async ({ kind, id, name, duration, expectedLabel }) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      items: [{ id, name, relativePath: name, kind, size: 42, modifiedAt: 7 }],
    })));
    render(<App initialState={createDemoState()} mediaLibraryOptions={{ probeDuration: async () => duration }} />);
    const tile = await screen.findByRole('gridcell', { name: new RegExp(name.replace('.', '\\.')) });
    await screen.findByText(`${duration} 秒`);

    fireEvent.contextMenu(tile, { clientX: 80, clientY: 60 });
    await userEvent.click(screen.getByRole('menuitem', { name: '添加到时间线' }));

    expect(screen.getByRole('button', { name: expectedLabel })).toBeInTheDocument();
    expect(screen.queryByText(/已按 5 秒添加/)).not.toBeInTheDocument();
  });

  test('announces a five-second fallback when insertion happens before metadata is ready', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      items: [{ id: 'pending-video', name: 'pending.mp4', relativePath: 'pending.mp4', kind: 'video', size: 42, modifiedAt: 7 }],
    })));
    render(<App initialState={createDemoState()} mediaLibraryOptions={{ probeDuration: () => new Promise<number>(() => undefined) }} />);
    const tile = await screen.findByRole('gridcell', { name: /pending\.mp4/ });

    fireEvent.contextMenu(tile, { clientX: 80, clientY: 60 });
    await userEvent.click(screen.getByRole('menuitem', { name: '添加到时间线' }));

    expect(screen.getByRole('button', { name: 'pending.mp4，5.0 秒' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('“pending.mp4”的时长仍在读取，已按 5 秒添加');
  });

  test('renders distinct context-menu references as ordered chips and removes only one', async () => {
    holdMediaLibraryRequest();
    const user = userEvent.setup();
    render(<App initialState={createDemoState()} />);

    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /花园漫步/ }), { clientX: 120, clientY: 80 });
    await user.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /人物剪影/ }), { clientX: 140, clientY: 100 });
    await user.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /花园漫步/ }), { clientX: 160, clientY: 120 });
    await user.click(screen.getByRole('menuitem', { name: '添加到会话' }));

    const referenceList = screen.getByRole('list', { name: '会话参考素材' });
    expect(referenceList).toHaveTextContent('花园漫步');
    expect(referenceList).toHaveTextContent('人物剪影');
    expect(referenceList.querySelectorAll('[role="listitem"]')).toHaveLength(2);

    expect(screen.getByRole('gridcell', { name: /花园漫步/ })).toHaveClass('is-selected');
    await user.click(screen.getByRole('button', { name: '移除参考素材 花园漫步' }));
    expect(referenceList).not.toHaveTextContent('花园漫步');
    expect(referenceList).toHaveTextContent('人物剪影');
    expect(screen.getByRole('gridcell', { name: /花园漫步/ })).toHaveClass('is-selected');
    expect(screen.getByRole('gridcell', { name: /人物剪影/ })).not.toHaveClass('is-selected');
  });

  test('sends attached image, audio, and video instead of only the selected item', async () => {
    const user = userEvent.setup();
    const items = [
      { id: 'attached-image', name: 'attached.png', relativePath: 'attached.png', kind: 'image', size: 12, modifiedAt: 7 },
      { id: 'attached-audio', name: 'voice.mp3', relativePath: 'voice.mp3', kind: 'audio', size: 13, modifiedAt: 8 },
      { id: 'attached-video', name: 'scene.mp4', relativePath: 'scene.mp4', kind: 'video', size: 14, modifiedAt: 9 },
      { id: 'selected-image', name: 'selected.png', relativePath: 'selected.png', kind: 'image', size: 15, modifiedAt: 8 },
    ];
    let sentBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/media-library') return Response.json({ items });
      if (url === '/api/conversations' && !init?.method) return Response.json({ lastSelectedId: 'c1', conversations: [{ id: 'c1', subject: '新对话', preview: '', createdAt: 1, updatedAt: 1 }] });
      if (url === '/api/conversations/c1' && !init?.method) return Response.json({ id: 'c1', subject: '新对话', createdAt: 1, updatedAt: 1, messages: [] });
      if (url === '/api/conversations/c1' && init?.method === 'PUT') return Response.json({ id: 'c1', subject: '检查附件', createdAt: 1, updatedAt: 2, messages: JSON.parse(String(init.body)).messages });
      if (url === '/api/media/attached-image/content') return new Response(new Blob(['attached-bytes'], { type: 'image/png' }));
      if (url === '/api/media/attached-audio/content') return new Response(new Blob(['audio-bytes'], { type: 'audio/mpeg' }));
      if (url === '/api/media/attached-video/content') return new Response(new Blob(['video-bytes'], { type: 'video/mp4' }));
      if (url === '/api/messages') {
        sentBody = JSON.parse(String(init?.body));
        return new Response('{"type":"done"}\n', { headers: { 'content-type': 'application/x-ndjson' } });
      }
      return Response.json({ status: 'ok' });
    }));
    render(<App initialState={createDemoState()} />);

    const attached = await screen.findByRole('gridcell', { name: /attached\.png/ });
    fireEvent.contextMenu(attached, { clientX: 80, clientY: 60 });
    await user.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /voice\.mp3/ }), { clientX: 80, clientY: 60 });
    await user.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /scene\.mp4/ }), { clientX: 80, clientY: 60 });
    await user.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    await user.click(screen.getByRole('gridcell', { name: /selected\.png/ }));
    await user.type(screen.getByLabelText('编辑指令'), '检查附件');
    await user.click(screen.getByRole('button', { name: '发送指令' }));

    await waitFor(() => expect(sentBody).toBeDefined());
    expect(sentBody?.images).toEqual([expect.objectContaining({ name: 'attached.png', format: 'png' })]);
    expect(sentBody?.audios).toEqual([expect.objectContaining({ name: 'voice.mp3', format: 'mp3' })]);
    expect(sentBody?.videos).toEqual([expect.objectContaining({ name: 'scene.mp4', format: 'mp4' })]);
    expect(screen.queryByRole('button', { name: '移除参考素材 attached.png' })).not.toBeInTheDocument();
    expect(within(document.querySelector('.message-user')!).getByText('attached.png')).toBeInTheDocument();
  });

  test('removes a conversation reference after its local asset truly leaves the library', async () => {
    const firstItem = { id: 'first-reference', name: 'first-reference.png', relativePath: 'first-reference.png', kind: 'image', size: 12, modifiedAt: 7 };
    const secondItem = { id: 'second-reference', name: 'second-reference.png', relativePath: 'second-reference.png', kind: 'image', size: 15, modifiedAt: 8 };
    let listCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/media-library/select-directory') return Response.json({ status: 'selected' });
      if (url === '/api/conversations') return Response.json({ lastSelectedId: null, conversations: [] });
      listCount += 1;
      return Response.json({ items: listCount === 1 ? [firstItem] : [secondItem] });
    }));
    render(<App initialState={createDemoState()} />);

    const firstTile = await screen.findByRole('gridcell', { name: /first-reference\.png/ });
    fireEvent.contextMenu(firstTile, { clientX: 80, clientY: 60 });
    await userEvent.click(screen.getByRole('menuitem', { name: '添加到会话' }));
    expect(screen.getByRole('button', { name: '移除参考素材 first-reference.png' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择素材目录' }));
    await screen.findByRole('gridcell', { name: /second-reference\.png/ });

    await waitFor(() => expect(screen.queryByRole('button', { name: '移除参考素材 first-reference.png' })).not.toBeInTheDocument());
  });

  test('inserts a context-menu asset at the current playback time', async () => {
    holdMediaLibraryRequest();
    const user = userEvent.setup();
    render(<App initialState={createDemoState()} />);
    fireEvent.change(screen.getByRole('slider', { name: '时间线定位' }), { target: { value: '23' } });

    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /人物剪影/ }), { clientX: 140, clientY: 100 });
    await user.click(screen.getByRole('menuitem', { name: '添加到时间线' }));

    expect(screen.getByRole('button', { name: '人物剪影，5.0 秒' })).toHaveStyle({ left: '920px' });
  });

  test('drops an asset through nearest-gap insertion and selects the result', () => {
    holdMediaLibraryRequest();
    render(<App initialState={createDemoState()} />);
    const lane = document.querySelector<HTMLElement>('[data-track-id="video-1"]')!;
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 40, width: 1000, height: 40,
      toJSON: () => ({}),
    });

    const drop = createEvent.drop(lane);
    Object.defineProperties(drop, {
      clientX: { value: 120 },
      dataTransfer: { value: { getData: () => 'portrait' } },
    });
    fireEvent(lane, drop);

    expect(screen.getByRole('button', { name: '人物剪影，5.0 秒' })).toHaveStyle({ left: '880px' });
    expect(screen.getByRole('button', { name: '人物剪影，5.0 秒' })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
  });

  test('keeps demo and companion asset selection visually exclusive', async () => {
    const local = { id: 'exclusive-local', name: 'exclusive.png', relativePath: 'exclusive.png', kind: 'image', size: 12, modifiedAt: 7 };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [local] })));
    render(<App initialState={createDemoState()} />);

    const demoTile = screen.getByRole('gridcell', { name: /花园漫步/ });
    expect(demoTile).toHaveClass('is-selected');
    const localTile = await screen.findByRole('gridcell', { name: /exclusive\.png/ });
    fireEvent.contextMenu(localTile, { clientX: 120, clientY: 80 });

    expect(localTile).toHaveClass('is-selected');
    expect(demoTile).not.toHaveClass('is-selected');

    fireEvent.click(demoTile);
    expect(demoTile).toHaveClass('is-selected');
    expect(localTile).not.toHaveClass('is-selected');
  });
});
