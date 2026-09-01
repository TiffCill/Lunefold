// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationStore, deriveConversationPreview, deriveConversationSubject } from './store';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('local conversation store', () => {
  it('derives readable subjects and previews by Unicode code point', () => {
    expect(deriveConversationSubject('  让副歌\n  跟随强拍切换  ')).toBe('让副歌 跟随强拍切换');
    expect(deriveConversationSubject('一二三四五六七八九十一二三四五六七八九十二三')).toBe('一二三四五六七八九十一二三四五六七八九十…');
    expect(deriveConversationPreview([
      { id: 'u', role: 'user', content: '开始', createdAt: 1 },
      { id: 'a', role: 'assistant', content: '最后一条\n 可显示的回答', state: 'complete', process: [], processExpanded: false, createdAt: 2 },
    ])).toBe('最后一条 可显示的回答');
  });

  it('creates, persists, orders, and restores selected conversations without touching communication time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-conversations-'));
    directories.push(directory);
    const filename = join(directory, 'conversations.json');
    let now = 100;
    let serial = 0;
    const store = new ConversationStore(filename, { now: () => now, idFactory: () => `c${++serial}` });
    const first = await store.create();
    now = 200;
    const second = await store.create();
    now = 300;
    await store.replace(first.id, {
      messages: [{ id: 'u1', role: 'user', content: '让副歌跟随强拍切换', createdAt: 300 }],
    });

    const beforeSelect = await store.get(second.id);
    now = 400;
    await store.select(second.id);
    const afterSelect = await store.get(second.id);
    const listed = await store.list();

    expect(listed.lastSelectedId).toBe(second.id);
    expect(listed.conversations.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(listed.conversations[0]).toMatchObject({ subject: '让副歌跟随强拍切换', preview: '让副歌跟随强拍切换', updatedAt: 300 });
    expect(afterSelect?.updatedAt).toBe(beforeSelect?.updatedAt);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({ version: 1, lastSelectedId: second.id });
  });

  it('recovers from missing and corrupt files and stores a remote mapping', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumina-conversations-corrupt-'));
    directories.push(directory);
    const filename = join(directory, 'conversations.json');
    const store = new ConversationStore(filename, { now: () => 10, idFactory: () => 'local' });
    expect(await store.list()).toEqual({ lastSelectedId: null, conversations: [] });
    await writeFile(filename, '{broken');
    await chmod(filename, 0o600);
    expect(await store.list()).toEqual({ lastSelectedId: null, conversations: [] });
    const created = await store.create();
    await store.setRemoteConversationId(created.id, 'remote-secret-id');
    expect(await store.get(created.id)).toMatchObject({ remoteConversationId: 'remote-secret-id' });
  });
});
