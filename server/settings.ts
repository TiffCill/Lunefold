import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type GptBotsRegion = 'sg' | 'jp' | 'th';

export interface ProviderSettings {
  gptbotsApiKey: string;
  modellixApiKey: string;
  gptbotsRegion: GptBotsRegion;
  gptbotsUserId: string;
  enabledAdapterIds: string[];
  defaultImageAspectRatio: string;
  defaultVideoDuration: number;
  defaultVideoResolution: string;
  /** Private companion-only root for the local media catalogue. */
  mediaDirectory: string;
}

export interface SettingsUpdate extends Partial<Omit<ProviderSettings, 'mediaDirectory'>> {
  clearGptbotsKey?: boolean;
  clearModellixKey?: boolean;
}

export interface MaskedSecret {
  configured: boolean;
  lastFour: string | null;
}

export interface MaskedSettings extends Omit<ProviderSettings, 'gptbotsApiKey' | 'modellixApiKey' | 'mediaDirectory'> {
  gptbotsApiKey: MaskedSecret;
  modellixApiKey: MaskedSecret;
}

const DEFAULT_SETTINGS: ProviderSettings = {
  gptbotsApiKey: '',
  modellixApiKey: '',
  gptbotsRegion: 'sg',
  gptbotsUserId: 'lumina-editor-user',
  enabledAdapterIds: [],
  defaultImageAspectRatio: '16:9',
  defaultVideoDuration: 5,
  defaultVideoResolution: '1080p',
  mediaDirectory: '',
};

export const defaultSettingsFilename = join(
  homedir(),
  'Library',
  'Application Support',
  'Lumina AI Video Editor',
  'settings.json',
);

export function developmentSettingsFilename(projectRoot: string): string {
  return join(projectRoot, '.lumina-data', 'settings.json');
}

function maskSecret(value: string): MaskedSecret {
  return { configured: value.length > 0, lastFour: value ? value.slice(-4) : null };
}

export function maskSettings(settings: ProviderSettings): MaskedSettings {
  const { gptbotsApiKey, modellixApiKey, mediaDirectory: _mediaDirectory, ...visible } = settings;
  return {
    ...visible,
    gptbotsApiKey: maskSecret(gptbotsApiKey),
    modellixApiKey: maskSecret(modellixApiKey),
  };
}

export function redactSecrets(value: string, secrets: string[] = []): string {
  let redacted = value.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  for (const secret of secrets.filter(Boolean)) redacted = redacted.replaceAll(secret, '[REDACTED]');
  return redacted;
}

export class SettingsStore {
  constructor(private readonly filename = defaultSettingsFilename) {}

  async read(): Promise<ProviderSettings> {
    try {
      const saved = JSON.parse(await readFile(this.filename, 'utf8')) as Partial<ProviderSettings>;
      return { ...DEFAULT_SETTINGS, ...saved };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS };
      throw error;
    }
  }

  async readMasked(): Promise<MaskedSettings> {
    return maskSettings(await this.read());
  }

  async write(update: SettingsUpdate): Promise<ProviderSettings> {
    const current = await this.read();
    const next: ProviderSettings = {
      ...current,
      gptbotsApiKey: update.clearGptbotsKey ? '' : update.gptbotsApiKey || current.gptbotsApiKey,
      modellixApiKey: update.clearModellixKey ? '' : update.modellixApiKey || current.modellixApiKey,
      gptbotsRegion: update.gptbotsRegion ?? current.gptbotsRegion,
      gptbotsUserId: update.gptbotsUserId ?? current.gptbotsUserId,
      enabledAdapterIds: update.enabledAdapterIds ?? current.enabledAdapterIds,
      defaultImageAspectRatio: update.defaultImageAspectRatio ?? current.defaultImageAspectRatio,
      defaultVideoDuration: update.defaultVideoDuration ?? current.defaultVideoDuration,
      defaultVideoResolution: update.defaultVideoResolution ?? current.defaultVideoResolution,
    };
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filename);
    await chmod(this.filename, 0o600);
    return next;
  }

  async writeMediaDirectory(mediaDirectory: string): Promise<ProviderSettings> {
    const next: ProviderSettings = {
      ...await this.read(),
      mediaDirectory,
    };
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filename);
    await chmod(this.filename, 0o600);
    return next;
  }
}
