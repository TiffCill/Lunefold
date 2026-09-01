// @vitest-environment node

import { link, mkdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { MediaCatalogue, MediaCatalogueError } from './catalogue';
import { SettingsStore } from '../settings';

const temporaryDirectories: string[] = [];

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lumina-catalogue-'));
  temporaryDirectories.push(directory);
  const root = join(directory, 'library');
  await mkdir(join(root, 'nested'), { recursive: true });
  const settings = new SettingsStore(join(directory, 'settings.json'));
  await settings.writeMediaDirectory(root);
  return { directory, root, settings };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('MediaCatalogue', () => {
  it('recursively publishes only supported media metadata with opaque stable IDs', async () => {
    const { root, settings } = await createFixture();
    const clip = join(root, 'nested', 'shot.MP4');
    await writeFile(clip, 'clip');
    await utimes(clip, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
    await writeFile(join(root, 'notes.txt'), 'not media');

    const catalogue = new MediaCatalogue({ settings });
    const first = await catalogue.list();
    const second = await catalogue.list();

    expect(first).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      name: 'shot.MP4',
      relativePath: 'nested/shot.MP4',
      kind: 'video',
      size: 4,
      modifiedAt: 1767225600000,
    })]);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(JSON.stringify(first)).not.toContain(root);
    expect(first[0]).not.toHaveProperty('absolutePath');
  });

  it('excludes a symlink whose resolved path escapes the authorized root', async () => {
    const { directory, root, settings } = await createFixture();
    const outside = join(directory, 'outside.mp4');
    await writeFile(outside, 'outside');
    await symlink(outside, join(root, 'escaped.mp4'));

    const catalogue = new MediaCatalogue({ settings });

    await expect(catalogue.list()).resolves.toEqual([]);
  });

  it('deduplicates in-root symlink and hardlink aliases with one deterministic public item', async () => {
    const { root, settings } = await createFixture();
    const canonical = join(root, 'a-canonical.mp4');
    await writeFile(canonical, 'clip');
    await link(canonical, join(root, 'b-hardlink.mp4'));
    await symlink(canonical, join(root, 'c-symlink.mp4'));
    const catalogue = new MediaCatalogue({ settings });

    const first = await catalogue.list();
    const second = await catalogue.list();

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: 'a-canonical.mp4', relativePath: 'a-canonical.mp4' });
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
    expect(second).toEqual(first);
  });

  it('does not resolve IDs for files that disappeared after scanning', async () => {
    const { root, settings } = await createFixture();
    const clip = join(root, 'shot.mp4');
    await writeFile(clip, 'clip');
    const catalogue = new MediaCatalogue({ settings });
    const [{ id }] = await catalogue.list();
    await rm(clip);

    await expect(catalogue.resolve(id)).rejects.toMatchObject({
      code: 'media_not_found',
    });
  });

  it('lists only the active directory while resolving a previously scanned authorized item', async () => {
    const { directory, root: firstRoot, settings } = await createFixture();
    const secondRoot = join(directory, 'second-library');
    await mkdir(secondRoot);
    const firstClip = join(firstRoot, 'first.mp4');
    const secondClip = join(secondRoot, 'second.mp4');
    await writeFile(firstClip, 'first');
    await writeFile(secondClip, 'second');
    const catalogue = new MediaCatalogue({ settings });
    const [firstItem] = await catalogue.list();

    await settings.writeMediaDirectory(secondRoot);
    const secondItems = await catalogue.list();

    expect(secondItems.map((item) => item.name)).toEqual(['second.mp4']);
    await expect(catalogue.resolve(firstItem.id)).resolves.toMatchObject({
      id: firstItem.id,
      name: 'first.mp4',
      absolutePath: await realpath(firstClip),
    });
  });

  it('rejects a historic item that disappeared, changed metadata, or escaped its original authorized root', async () => {
    const { directory, root: firstRoot, settings } = await createFixture();
    const secondRoot = join(directory, 'second-library');
    await mkdir(secondRoot);
    const original = join(firstRoot, 'historic.mp4');
    await writeFile(original, 'safe');
    const catalogue = new MediaCatalogue({ settings });
    const [historicItem] = await catalogue.list();
    await settings.writeMediaDirectory(secondRoot);
    await catalogue.list();

    await rm(original);
    await expect(catalogue.resolve(historicItem.id)).rejects.toMatchObject({ code: 'media_not_found' });

    await writeFile(original, 'replacement-with-different-metadata');
    await expect(catalogue.resolve(historicItem.id)).rejects.toMatchObject({ code: 'media_not_found' });

    await rm(original);
    const outside = join(directory, 'outside.mp4');
    await writeFile(outside, 'safe');
    await symlink(outside, original);
    await expect(catalogue.resolve(historicItem.id)).rejects.toMatchObject({ code: 'media_not_found' });
  });

  it('rejects ambiguous IDs from different authorized roots instead of serving the wrong file', async () => {
    const { directory, root: firstRoot, settings } = await createFixture();
    const secondRoot = join(directory, 'second-library');
    await mkdir(secondRoot);
    const firstClip = join(firstRoot, 'same.mp4');
    const secondClip = join(secondRoot, 'same.mp4');
    await writeFile(firstClip, 'same');
    await writeFile(secondClip, 'same');
    const timestamp = new Date('2026-02-03T04:05:06.000Z');
    await utimes(firstClip, timestamp, timestamp);
    await utimes(secondClip, timestamp, timestamp);
    const catalogue = new MediaCatalogue({ settings });
    const [firstItem] = await catalogue.list();

    await settings.writeMediaDirectory(secondRoot);
    const [secondItem] = await catalogue.list();

    expect(secondItem.id).toBe(firstItem.id);
    await expect(catalogue.resolve(firstItem.id)).rejects.toMatchObject({ code: 'media_not_found' });
  });

  it('rejects a same-size same-mtime file replacement with a different filesystem identity', async () => {
    const { directory, root: firstRoot, settings } = await createFixture();
    const secondRoot = join(directory, 'second-library');
    await mkdir(secondRoot);
    const original = join(firstRoot, 'identity.mp4');
    const replacement = join(firstRoot, 'replacement.mp4');
    const timestamp = new Date('2026-03-04T05:06:07.000Z');
    await writeFile(original, 'AAAA');
    await utimes(original, timestamp, timestamp);
    const catalogue = new MediaCatalogue({ settings });
    const [historicItem] = await catalogue.list();
    const originalIdentity = await stat(original);
    await settings.writeMediaDirectory(secondRoot);
    await catalogue.list();

    await writeFile(replacement, 'BBBB');
    await utimes(replacement, timestamp, timestamp);
    await rename(replacement, original);
    const replacementIdentity = await stat(original);

    expect(replacementIdentity.size).toBe(historicItem.size);
    expect(Math.round(replacementIdentity.mtimeMs)).toBe(historicItem.modifiedAt);
    expect([replacementIdentity.dev, replacementIdentity.ino]).not.toEqual([originalIdentity.dev, originalIdentity.ino]);
    await expect(catalogue.resolve(historicItem.id)).rejects.toMatchObject({ code: 'media_not_found' });
  });

  it('rejects replacement of the whole authorized root even when file metadata is preserved', async () => {
    const { directory, root: firstRoot, settings } = await createFixture();
    const secondRoot = join(directory, 'second-library');
    const archivedRoot = join(directory, 'archived-library');
    await mkdir(secondRoot);
    const original = join(firstRoot, 'root-identity.mp4');
    const timestamp = new Date('2026-04-05T06:07:08.000Z');
    await writeFile(original, 'SAME');
    await utimes(original, timestamp, timestamp);
    const originalRootIdentity = await stat(firstRoot);
    const catalogue = new MediaCatalogue({ settings });
    const [historicItem] = await catalogue.list();
    await settings.writeMediaDirectory(secondRoot);
    await catalogue.list();

    await rename(firstRoot, archivedRoot);
    await mkdir(join(firstRoot, 'nested'), { recursive: true });
    const recreated = join(firstRoot, 'root-identity.mp4');
    await writeFile(recreated, 'EVIL');
    await utimes(recreated, timestamp, timestamp);
    const replacementRootIdentity = await stat(firstRoot);
    const replacementFile = await stat(recreated);

    expect([replacementRootIdentity.dev, replacementRootIdentity.ino]).not.toEqual([originalRootIdentity.dev, originalRootIdentity.ino]);
    expect(replacementFile.size).toBe(historicItem.size);
    expect(Math.round(replacementFile.mtimeMs)).toBe(historicItem.modifiedAt);
    await expect(catalogue.resolve(historicItem.id)).rejects.toMatchObject({ code: 'media_not_found' });
  });
});
