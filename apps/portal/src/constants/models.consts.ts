import type { KeyFamily, ModelDefinition } from '@/types/domain.types';

/** Model labels shown in the UI. Provider/company names are never shown on their own. */
export const MODELS: ModelDefinition[] = [
    { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', kind: 'chat', defaultEnabled: true },
    { id: 'claude-opus-4.1', label: 'Claude Opus 4.1', kind: 'chat', defaultEnabled: false },
    { id: 'gpt-5', label: 'GPT-5', kind: 'chat', defaultEnabled: true },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', kind: 'chat', defaultEnabled: true },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', kind: 'chat', defaultEnabled: true },
    { id: 'deepseek-v3.2', label: 'DeepSeek V3.2', kind: 'chat', defaultEnabled: true },
    { id: 'qwen3-coder', label: 'Qwen3 Coder', kind: 'chat', defaultEnabled: false },
    { id: 'llama-4-maverick', label: 'Llama 4 Maverick', kind: 'chat', defaultEnabled: false },
    { id: 'codestral', label: 'Codestral', kind: 'autocomplete', defaultEnabled: true }
];

export const DEFAULT_MODEL_ID = 'claude-sonnet-4.5';

export const KEY_FAMILIES: KeyFamily[] = ['claude', 'gpt', 'gemini', 'deepseek', 'custom'];

export const KEY_FAMILY_LABELS: Record<KeyFamily, string> = {
    claude: 'Claude models',
    gpt: 'GPT models',
    gemini: 'Gemini models',
    deepseek: 'DeepSeek models',
    custom: 'Custom endpoint'
};

export function modelLabel(id: string): string {
    return MODELS.find(model => model.id === id)?.label ?? id;
}
