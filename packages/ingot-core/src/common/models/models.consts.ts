import type { CatalogModel, ProviderInfo } from './models.types';

export const MODEL_SERVICE_PATH = '/services/ingot/models';
/** Keychain service name (macOS Keychain, Windows Credential Manager, libsecret). Overridable for e2e. */
export const DEFAULT_KEYCHAIN_SERVICE = 'dev.ingot.ide';
export const REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export const PROVIDERS: readonly ProviderInfo[] = [
    { id: 'anthropic', label: 'Anthropic', needsKey: true, baseUrl: 'https://api.anthropic.com/v1', keyHint: 'sk-ant-…' },
    { id: 'openai', label: 'OpenAI', needsKey: true, baseUrl: 'https://api.openai.com/v1', keyHint: 'sk-…' },
    { id: 'gemini', label: 'Google Gemini', needsKey: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyHint: 'AIza…' },
    { id: 'deepseek', label: 'DeepSeek', needsKey: true, baseUrl: 'https://api.deepseek.com', keyHint: 'sk-…' },
    { id: 'openrouter', label: 'OpenRouter', needsKey: true, baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…' },
    { id: 'ollama', label: 'Ollama (local)', needsKey: false, baseUrl: DEFAULT_OLLAMA_URL, keyHint: '' }
];

/** Model picker entries; labels are the only place provider/model names appear outside Settings › Models. */
export const MODEL_CATALOG: readonly CatalogModel[] = [
    { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { id: 'claude-opus-4-1', label: 'Opus 4.1', provider: 'anthropic', model: 'claude-opus-4-1' },
    { id: 'gpt-5', label: 'GPT-5', provider: 'openai', model: 'gpt-5' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'openai', model: 'gpt-5-mini' },
    { id: 'gemini-2-5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', model: 'gemini-2.5-pro' },
    { id: 'deepseek-v3', label: 'DeepSeek V3', provider: 'deepseek', model: 'deepseek-chat' },
    { id: 'openrouter-auto', label: 'OpenRouter Auto', provider: 'openrouter', model: 'openrouter/auto' },
    { id: 'ollama-local', label: 'Ollama (local)', provider: 'ollama', model: 'qwen2.5-coder' }
];

export const MODEL_PREFERENCES = {
    ollamaUrl: 'ingot.models.ollamaUrl',
    overrides: 'ingot.models.overrides',
    autocompleteEnabled: 'ingot.autocomplete.enabled',
    autocompleteModel: 'ingot.autocomplete.model',
    autocompleteDebounce: 'ingot.autocomplete.debounceMs'
} as const;

export const AGENT_SYSTEM_PROMPTS = {
    agent: 'You are an expert coding agent inside the Ingot IDE. Be concise. When you propose code changes, show them as unified diffs or complete code blocks with the file path.',
    ask: 'You are an expert programming assistant inside the Ingot IDE. Answer questions about the user\'s code concisely. Do not propose edits unless asked.',
    plan: 'You are a senior engineer inside the Ingot IDE. Produce a short numbered implementation plan; do not write the code yet.'
} as const;

export const AUTOCOMPLETE_SYSTEM_PROMPT = 'You are a code completion engine. Continue the code at <CURSOR>. Reply with only the text to insert at the cursor: no explanations, no markdown fences, no repetition of the existing code.';
