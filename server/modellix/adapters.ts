import type { AdapterInput, AdapterValidation, ModellixAdapter, ParameterSchema, ParameterValue } from './types.ts';

const enumParam = (key: string, options: readonly ParameterValue[], defaultValue?: ParameterValue): ParameterSchema =>
  ({ key, type: 'enum', options, default: defaultValue });
const boolParam = (key: string, defaultValue?: boolean): ParameterSchema => ({ key, type: 'boolean', default: defaultValue });
const numberParam = (key: string, min: number, max: number, defaultValue?: number): ParameterSchema =>
  ({ key, type: 'number', min, max, default: defaultValue });
const unavailable = (id: string, label: string, family: ModellixAdapter['family'], capability: ModellixAdapter['capability'], outputKind: ModellixAdapter['outputKind']): ModellixAdapter => ({
  id, label, family, capability, outputKind, available: false,
  unavailableReason: '尚未从 Modellix 官方模型页确认完整请求契约',
  promptMax: 1, references: { min: 0, max: 0 }, parameters: [],
});

export const adapterRegistry: readonly ModellixAdapter[] = [
  {
    id: 'seedance-1.5-pro-t2v', label: 'Seedance 1.5 Pro T2V', family: 'seedance', capability: 'text-to-video', outputKind: 'video', available: true,
    endpoint: '/api/v1/bytedance/seedance-1.5-pro-t2v', promptMax: 10_000, references: { min: 0, max: 0 },
    parameters: [enumParam('ratio', ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], 'adaptive'), enumParam('resolution', ['480p', '720p', '1080p'], '720p'), enumParam('duration', [4, 5, 6, 7, 8, 9, 10, 11, 12], 5), numberParam('seed', -1, 2147483647, -1), boolParam('camera_fixed', false), boolParam('generate_audio', true), enumParam('service_tier', ['default', 'flex'], 'default'), boolParam('return_last_frame', false)],
  },
  unavailable('seedance-2.0-i2v', 'Seedance 2.0 I2V', 'seedance', 'image-to-video', 'video'),
  {
    id: 'kling-image-o1', label: 'Kling Image O1', family: 'kling', capability: 'image-to-image', outputKind: 'image', available: true,
    endpoint: '/api/v1/image-to-image/kling/kling-image-o1/async', promptMax: 2500, references: { min: 1, max: 10 },
    parameters: [enumParam('resolution', ['1k', '2k'], '1k'), enumParam('aspect_ratio', ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']), numberParam('n', 1, 9, 1)],
    mapReferences: (references) => ({ image_list: references.map((image) => ({ image })) }),
  },
  unavailable('kling-v3-t2v', 'Kling V3 T2V', 'kling', 'text-to-video', 'video'),
  unavailable('kling-v3-i2v', 'Kling V3 I2V', 'kling', 'image-to-video', 'video'),
  unavailable('hailuo-2.3-t2v', 'Hailuo 2.3 T2V', 'minimax', 'text-to-video', 'video'),
  {
    id: 'hailuo-2.3-fast-i2v', label: 'Hailuo 2.3 Fast I2V', family: 'minimax', capability: 'image-to-video', outputKind: 'video', available: true,
    endpoint: '/api/v1/minimax/hailuo-2.3-fast-i2v/async', promptMax: 2000, references: { min: 1, max: 1 },
    parameters: [boolParam('prompt_optimizer', true), boolParam('fast_pretreatment', false), enumParam('duration', [6, 10], 6), enumParam('resolution', ['768P', '1080P'], '768P')],
    mapReferences: ([first_frame_image]) => ({ first_frame_image }),
  },
  unavailable('wan-2.7-image-pro', 'Wan 2.7 Image Pro', 'wan', 'text-to-image', 'image'),
  unavailable('wan-2.7-image-pro-edit', 'Wan 2.7 Image Pro Edit', 'wan', 'image-to-image', 'image'),
  unavailable('wan-3.0-t2v', 'Wan 3.0 T2V', 'wan', 'text-to-video', 'video'),
  unavailable('wan-3.0-i2v', 'Wan 3.0 I2V', 'wan', 'image-to-video', 'video'),
  unavailable('nano-banana-2', 'Nano Banana 2', 'gemini', 'text-to-image', 'image'),
  unavailable('nano-banana-2-edit', 'Nano Banana 2 Edit', 'gemini', 'image-to-image', 'image'),
  unavailable('veo-3.1-t2v', 'Veo 3.1 T2V', 'gemini', 'text-to-video', 'video'),
  unavailable('veo-3.1-i2v', 'Veo 3.1 I2V', 'gemini', 'image-to-video', 'video'),
];

const adaptersById = new Map(adapterRegistry.map((adapter) => [adapter.id, adapter]));

function parameterIsValid(schema: ParameterSchema, value: ParameterValue): boolean {
  if (schema.type === 'enum') return schema.options?.includes(value) ?? false;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') return typeof value === 'string';
  return typeof value === 'number' && Number.isFinite(value) && value >= (schema.min ?? -Infinity) && value <= (schema.max ?? Infinity);
}

export function validateAdapterInput(adapterId: string, input: AdapterInput): AdapterValidation {
  const adapter = adaptersById.get(adapterId);
  if (!adapter) return { ok: false, code: 'unknown_adapter', message: '未知的媒体模型' };
  if (!adapter.available || !adapter.endpoint) return { ok: false, code: 'adapter_unavailable', message: adapter.unavailableReason ?? '媒体模型暂不可用' };
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > adapter.promptMax) return { ok: false, code: 'invalid_prompt', message: '提示词为空或超过模型限制' };
  if (input.references.length < adapter.references.min || input.references.length > adapter.references.max) return { ok: false, code: 'invalid_references', message: '参考素材数量不符合模型要求' };
  const schemas = new Map(adapter.parameters.map((schema) => [schema.key, schema]));
  for (const [key, value] of Object.entries(input.parameters)) {
    const schema = schemas.get(key);
    if (!schema || !parameterIsValid(schema, value)) return { ok: false, code: 'invalid_parameter', message: `无效参数：${key}` };
  }
  const defaults = Object.fromEntries(adapter.parameters.filter((schema) => schema.default !== undefined).map((schema) => [schema.key, schema.default]));
  return { ok: true, request: { endpoint: adapter.endpoint, outputKind: adapter.outputKind, body: { prompt, ...adapter.mapReferences?.(input.references), ...defaults, ...input.parameters } } };
}
