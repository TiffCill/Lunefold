export interface MediaGenerationProposal {
  action: 'generate_media';
  adapter_id: string;
  prompt: string;
  reference_asset_ids: string[];
  parameters: Record<string, string | number | boolean>;
}

export interface ParsedAssistantReply {
  text: string;
  proposal: MediaGenerationProposal | null;
}

export interface ProposalValidationContext {
  currentReferenceIds: ReadonlySet<string>;
  enabledAdapterIds: ReadonlySet<string>;
}

export type ProposalValidation =
  | { ok: true; proposal: MediaGenerationProposal }
  | { ok: false; code: 'adapter_disabled' | 'reference_not_authorized'; message: string };

const TOOL_BLOCK = /```modellix_tool\s*\n([\s\S]*?)\n```/g;
const TOP_LEVEL_FIELDS = new Set(['action', 'adapter_id', 'prompt', 'reference_asset_ids', 'parameters']);

function parseProposal(source: string): MediaGenerationProposal {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Media action is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Media action must be an object');
  const record = value as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if (!TOP_LEVEL_FIELDS.has(field)) throw new Error(`Unknown media action field: ${field}`);
  }
  if (record.action !== 'generate_media') throw new Error('Unsupported media action');
  if (typeof record.adapter_id !== 'string' || !record.adapter_id.trim()) throw new Error('Media action adapter is required');
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) throw new Error('Media action prompt is required');
  if (!Array.isArray(record.reference_asset_ids) || record.reference_asset_ids.some((item) => typeof item !== 'string')) throw new Error('Media action references must be asset IDs');
  if (!record.parameters || typeof record.parameters !== 'object' || Array.isArray(record.parameters)) throw new Error('Media action parameters must be an object');
  const parameters = record.parameters as Record<string, unknown>;
  if (Object.values(parameters).some((item) => !['string', 'number', 'boolean'].includes(typeof item))) throw new Error('Media action parameters contain an unsupported value');
  return {
    action: 'generate_media',
    adapter_id: record.adapter_id,
    prompt: record.prompt.trim(),
    reference_asset_ids: [...record.reference_asset_ids],
    parameters: parameters as Record<string, string | number | boolean>,
  };
}

export function parseAssistantReply(source: string): ParsedAssistantReply {
  const matches = [...source.matchAll(TOOL_BLOCK)];
  if (matches.length > 1) throw new Error('Only one media action is allowed');
  if (matches.length === 0) return { text: source, proposal: null };
  const match = matches[0];
  return {
    text: `${source.slice(0, match.index)}${source.slice((match.index ?? 0) + match[0].length)}`.trim(),
    proposal: parseProposal(match[1]),
  };
}

export function validateProposal(
  proposal: MediaGenerationProposal,
  context: ProposalValidationContext,
): ProposalValidation {
  if (!context.enabledAdapterIds.has(proposal.adapter_id)) {
    return { ok: false, code: 'adapter_disabled', message: '所选媒体模型未启用' };
  }
  const unauthorized = proposal.reference_asset_ids.find((id) => !context.currentReferenceIds.has(id));
  if (unauthorized) {
    return { ok: false, code: 'reference_not_authorized', message: '生成指令引用了本轮未附加的素材' };
  }
  return { ok: true, proposal };
}
