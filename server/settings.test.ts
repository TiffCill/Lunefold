// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingsStore, developmentSettingsFilename, redactSecrets } from './settings';

const temporaryDirectories: string[] = [];

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), 'lumina-settings-'));
  temporaryDirectories.push(directory);
  const filename = join(directory, 'settings.json');
  return { filename, store: new SettingsStore(filename) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SettingsStore', () => {
  it('keeps development secrets in a private ignored project directory', () => {
    expect(developmentSettingsFilename('/workspace/editor')).toBe('/workspace/editor/.lumina-data/settings.json');
  });
  it('masks complete provider keys at the browser boundary', async () => {
    const { store } = await createStore();
    await store.write({
      gptbotsApiKey: 'gb-secret-1234',
      modellixApiKey: 'mx-secret-5678',
      gptbotsRegion: 'sg',
      gptbotsUserId: 'editor-user',
    });

    const masked = await store.readMasked();
    expect(masked).toMatchObject({
      gptbotsApiKey: { configured: true, lastFour: '1234' },
      modellixApiKey: { configured: true, lastFour: '5678' },
      gptbotsRegion: 'sg',
      gptbotsUserId: 'editor-user',
    });
    expect(JSON.stringify(masked)).not.toContain('gb-secret');
    expect(JSON.stringify(masked)).not.toContain('mx-secret');
  });

  it('writes owner-only settings and preserves omitted secrets', async () => {
    const { filename, store } = await createStore();
    await store.write({ gptbotsApiKey: 'first-key', modellixApiKey: 'second-key', gptbotsRegion: 'sg', gptbotsUserId: 'user-1234' });
    await store.write({ gptbotsRegion: 'jp', gptbotsUserId: 'user-5678' });

    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({
      gptbotsApiKey: 'first-key',
      modellixApiKey: 'second-key',
      gptbotsRegion: 'jp',
      gptbotsUserId: 'user-5678',
    });
  });

  it('migrates existing settings with an empty media directory and persists a selected directory', async () => {
    const { filename, store } = await createStore();
    await store.write({ gptbotsRegion: 'sg' });

    expect((await store.read()).mediaDirectory).toBe('');

    await store.writeMediaDirectory('/Volumes/Media/Project');
    expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({
      mediaDirectory: '/Volumes/Media/Project',
    });
    expect(await store.readMasked()).not.toHaveProperty('mediaDirectory');
  });

  it('does not let a hostile public settings payload change the private media directory', async () => {
    const { store } = await createStore();
    await store.writeMediaDirectory('/Volumes/Media/Authorized');

    await store.write({ mediaDirectory: '/Users/attacker' } as never);

    expect((await store.read()).mediaDirectory).toBe('/Volumes/Media/Authorized');
  });

  it('redacts bearer tokens and stored secrets from diagnostics', () => {
    expect(redactSecrets('Authorization: Bearer abcdef and key mx-secret', ['mx-secret']))
      .toBe('Authorization: Bearer [REDACTED] and key [REDACTED]');
  });
});
