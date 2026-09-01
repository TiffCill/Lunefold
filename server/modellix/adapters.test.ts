// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { adapterRegistry, validateAdapterInput } from './adapters';

describe('Modellix fixed adapter registry', () => {
  it('contains the 15 approved adapters without invented endpoints', () => {
    expect(adapterRegistry).toHaveLength(15);
    expect(new Set(adapterRegistry.map((adapter) => adapter.id)).size).toBe(15);
    for (const adapter of adapterRegistry) {
      if (adapter.available) expect(adapter.endpoint).toMatch(/^\/api\/v1\//);
      else expect(adapter.unavailableReason).toBeTruthy();
    }
  });

  it('maps Kling Image O1 references to the documented image_list shape', () => {
    const result = validateAdapterInput('kling-image-o1', {
      prompt: 'keep the person and change the background',
      references: ['https://files.example/a.png', 'https://files.example/b.png'],
      parameters: { resolution: '2k', aspect_ratio: '16:9', n: 2 },
    });
    expect(result).toMatchObject({
      ok: true,
      request: {
        endpoint: '/api/v1/image-to-image/kling/kling-image-o1/async',
        body: {
          prompt: 'keep the person and change the background',
          image_list: [{ image: 'https://files.example/a.png' }, { image: 'https://files.example/b.png' }],
          resolution: '2k',
          aspect_ratio: '16:9',
          n: 2,
        },
      },
    });
  });

  it('maps Hailuo 2.3 Fast I2V and rejects invalid duration', () => {
    const valid = validateAdapterInput('hailuo-2.3-fast-i2v', {
      prompt: 'a subtle camera move', references: ['https://files.example/first.png'],
      parameters: { duration: 6, resolution: '1080P', prompt_optimizer: true },
    });
    expect(valid).toMatchObject({ ok: true, request: { body: {
      first_frame_image: 'https://files.example/first.png', duration: 6, resolution: '1080P', prompt_optimizer: true,
    } } });
    expect(validateAdapterInput('hailuo-2.3-fast-i2v', {
      prompt: 'move', references: ['https://files.example/first.png'], parameters: { duration: 8 },
    })).toMatchObject({ ok: false, code: 'invalid_parameter' });
  });

  it('rejects missing references, unknown parameters, and unavailable adapters', () => {
    expect(validateAdapterInput('kling-image-o1', { prompt: 'edit', references: [], parameters: {} }))
      .toMatchObject({ ok: false, code: 'invalid_references' });
    expect(validateAdapterInput('kling-image-o1', { prompt: 'edit', references: ['a'], parameters: { surprise: true } }))
      .toMatchObject({ ok: false, code: 'invalid_parameter' });
    const unavailable = adapterRegistry.find((adapter) => !adapter.available);
    if (unavailable) {
      expect(validateAdapterInput(unavailable.id, { prompt: 'x', references: [], parameters: {} }))
        .toMatchObject({ ok: false, code: 'adapter_unavailable' });
    }
  });
});
