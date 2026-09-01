export type MediaCapability = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video';
export type MediaKind = 'image' | 'video';
export type ParameterValue = string | number | boolean;

export interface ParameterSchema {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  options?: readonly ParameterValue[];
  min?: number;
  max?: number;
  default?: ParameterValue;
}

export interface AdapterInput {
  prompt: string;
  references: string[];
  parameters: Record<string, ParameterValue>;
}

export interface AdapterRequest {
  endpoint: string;
  body: Record<string, unknown>;
  outputKind: MediaKind;
}

export interface ModellixAdapter {
  id: string;
  label: string;
  family: 'seedance' | 'kling' | 'minimax' | 'wan' | 'gemini';
  capability: MediaCapability;
  outputKind: MediaKind;
  available: boolean;
  unavailableReason?: string;
  endpoint?: string;
  promptMax: number;
  references: { min: number; max: number };
  parameters: readonly ParameterSchema[];
  mapReferences?: (references: string[]) => Record<string, unknown>;
}

export type AdapterValidation =
  | { ok: true; request: AdapterRequest }
  | { ok: false; code: 'unknown_adapter' | 'adapter_unavailable' | 'invalid_prompt' | 'invalid_references' | 'invalid_parameter'; message: string };
