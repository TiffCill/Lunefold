// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseAssistantReply, validateProposal } from './toolProtocol';

const block = `\`\`\`modellix_tool
{"action":"generate_media","adapter_id":"seedance-2.0-i2v","prompt":"move","reference_asset_ids":["asset-a"],"parameters":{}}
\`\`\``;

describe('GPTBots media tool protocol', () => {
  it('extracts one hidden tool block and preserves assistant text', () => {
    const result = parseAssistantReply(`I can animate this.\n${block}`);
    expect(result.text).toBe('I can animate this.');
    expect(result.proposal).toEqual({
      action: 'generate_media',
      adapter_id: 'seedance-2.0-i2v',
      prompt: 'move',
      reference_asset_ids: ['asset-a'],
      parameters: {},
    });
  });

  it('does not treat ordinary JSON fences as a media action', () => {
    const result = parseAssistantReply('Example:\n```json\n{"action":"generate_media"}\n```');
    expect(result.proposal).toBeNull();
    expect(result.text).toContain('```json');
  });

  it('rejects multiple tool blocks and unknown fields', () => {
    expect(() => parseAssistantReply(`${block}\n${block}`)).toThrow('Only one media action is allowed');
    expect(() => parseAssistantReply('```modellix_tool\n{"action":"generate_media","adapter_id":"x","prompt":"p","reference_asset_ids":[],"parameters":{},"surprise":true}\n```'))
      .toThrow('Unknown media action field: surprise');
  });

  it('rejects malformed JSON and an empty prompt', () => {
    expect(() => parseAssistantReply('```modellix_tool\n{broken}\n```')).toThrow('Media action is not valid JSON');
    expect(() => parseAssistantReply('```modellix_tool\n{"action":"generate_media","adapter_id":"x","prompt":" ","reference_asset_ids":[],"parameters":{}}\n```'))
      .toThrow('Media action prompt is required');
  });

  it('allows only adapters and references authorized for the triggering turn', () => {
    const proposal = parseAssistantReply(block).proposal!;
    expect(validateProposal(proposal, { currentReferenceIds: new Set(['asset-a']), enabledAdapterIds: new Set(['seedance-2.0-i2v']) }).ok).toBe(true);
    expect(validateProposal(proposal, { currentReferenceIds: new Set(), enabledAdapterIds: new Set(['seedance-2.0-i2v']) })).toMatchObject({ ok: false, code: 'reference_not_authorized' });
    expect(validateProposal(proposal, { currentReferenceIds: new Set(['asset-a']), enabledAdapterIds: new Set() })).toMatchObject({ ok: false, code: 'adapter_disabled' });
  });
});
