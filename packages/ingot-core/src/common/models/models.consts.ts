import type { CatalogModel, ModelFamily, ProviderId, ProviderInfo } from './models.types';

export const MODEL_SERVICE_PATH = '/services/ingot/models';
/** Keychain service name (macOS Keychain, Windows Credential Manager, libsecret). Overridable for e2e. */
export const DEFAULT_KEYCHAIN_SERVICE = 'dev.ingot.ide';
export const REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export const PROVIDERS: readonly ProviderInfo[] = [
    { id: 'ingot', label: 'Ingot', needsKey: false, baseUrl: 'http://127.0.0.1:3300/v1', keyHint: '' },
    { id: 'anthropic', label: 'Anthropic', needsKey: true, baseUrl: 'https://api.anthropic.com/v1', keyHint: 'sk-ant-…' },
    { id: 'openai', label: 'OpenAI', needsKey: true, baseUrl: 'https://api.openai.com/v1', keyHint: 'sk-…' },
    { id: 'gemini', label: 'Google Gemini', needsKey: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyHint: 'AIza…' },
    { id: 'deepseek', label: 'DeepSeek', needsKey: true, baseUrl: 'https://api.deepseek.com', keyHint: 'sk-…' },
    { id: 'openrouter', label: 'OpenRouter', needsKey: true, baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…' },
    { id: 'ollama', label: 'Ollama (local)', needsKey: false, baseUrl: DEFAULT_OLLAMA_URL, keyHint: '' }
];

/** Model picker entries; labels are the only place provider/model names appear outside Settings › Models. */
export const MODEL_CATALOG: readonly CatalogModel[] = [
    { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', provider: 'anthropic', model: 'claude-sonnet-4-5', speed: 'balanced', cost: '$$', contextWindow: 200_000, thinking: true, recommended: true },
    { id: 'claude-opus-4-1', label: 'Opus 4.1', provider: 'anthropic', model: 'claude-opus-4-1', speed: 'slow', cost: '$$$', contextWindow: 200_000, thinking: true, recommended: false },
    { id: 'gpt-5', label: 'GPT-5', provider: 'openai', model: 'gpt-5', speed: 'balanced', cost: '$$', contextWindow: 400_000, thinking: true, recommended: true },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'openai', model: 'gpt-5-mini', speed: 'fast', cost: '$', contextWindow: 400_000, thinking: true, recommended: false },
    { id: 'gemini-2-5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', model: 'gemini-2.5-pro', speed: 'balanced', cost: '$$', contextWindow: 1_000_000, thinking: true, recommended: true },
    { id: 'deepseek-v3', label: 'DeepSeek V3', provider: 'deepseek', model: 'deepseek-chat', speed: 'fast', cost: '$', contextWindow: 128_000, thinking: false, recommended: false },
    { id: 'openrouter-auto', label: 'Routed (best available)', provider: 'openrouter', model: 'openrouter/auto', speed: 'balanced', cost: '$$', contextWindow: 128_000, thinking: false, recommended: false },
    { id: 'openrouter-haiku', label: 'Claude Haiku 5.5 (routed)', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', speed: 'fast', cost: '$', contextWindow: 1_000_000, thinking: false, recommended: false },
    { id: 'ollama-local', label: 'Qwen2.5 Coder (local)', provider: 'ollama', model: 'qwen2.5-coder', speed: 'fast', cost: 'free', contextWindow: 32_000, thinking: false, recommended: false }
];

/** Picker families, top to bottom (IDEA-91). Labels are model family names. */
export const MODEL_FAMILIES: readonly ModelFamily[] = [
    { provider: 'ingot', label: 'Ingot', icon: 'sparkle-filled' },
    { provider: 'anthropic', label: 'Claude', icon: 'sparkle' },
    { provider: 'openai', label: 'GPT', icon: 'sparkle' },
    { provider: 'gemini', label: 'Gemini', icon: 'sparkle' },
    { provider: 'deepseek', label: 'DeepSeek', icon: 'sparkle' },
    { provider: 'openrouter', label: 'Routed', icon: 'arrow-swap' },
    { provider: 'ollama', label: 'Local', icon: 'device-desktop' }
];

/** Picker entry that resolves to the first connected recommended model, then any connected model. */
export const AUTO_MODEL_ID = 'auto';
export const AUTO_MODEL_LABEL = 'Auto';
export const FAVORITE_MODELS_KEY = 'ingot.models.favorites';
export const DEFAULT_CONTEXT_WINDOW = 128_000;

export const MODEL_PREFERENCES = {
    ollamaUrl: 'ingot.models.ollamaUrl',
    overrides: 'ingot.models.overrides',
    autocompleteEnabled: 'ingot.autocomplete.enabled',
    autocompleteModel: 'ingot.autocomplete.model',
    autocompleteDebounce: 'ingot.autocomplete.debounceMs',
    /** Use my own API keys (BYOK) / Local (Ollama). Off by default: signed-in users use Ingot models (IDEA-101). */
    byok: 'ingot.models.byok'
} as const;

/** Providers that need the user's own key or a local server; hidden unless BYOK is on. */
export const BYOK_PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'gemini', 'deepseek', 'openrouter', 'ollama'];
export const SIGN_IN_FOR_MODELS = 'Sign in to use Ingot models';

/** How replies are laid out (IDEA-100): rendered as Markdown in the chat panel. */
export const REPLY_STYLE = 'Format every reply as GitHub Markdown: start with a short "### " title, then a 1-2 line summary. Add "#### " sections, bullet lists or a table only when they make the answer clearer; put code, paths and identifiers in backticks and code in fenced blocks with a language. Put every list item and every block on its own line, with a blank line between blocks. Show a sequence of steps as one line like "A → B → C". Be concise: no filler, no repeating the question.';

export const AGENT_SYSTEM_PROMPTS = {
    agent: `You are an expert coding agent inside the Ingot IDE. Be concise. When you propose code changes, show them as unified diffs or complete code blocks with the file path. ${REPLY_STYLE}`,
    ask: `You are an expert programming assistant inside the Ingot IDE. Answer questions about the user's code concisely. Do not propose edits unless asked. ${REPLY_STYLE}`,
    plan: 'You are a senior engineer inside the Ingot IDE. Produce a short implementation plan as a "PLAN:" list of "- step" lines, then a sentence on risks; do not write the code yet. Do not change files.',
    multi: 'You are the lead of a team of coding agents inside the Ingot IDE. Split the task into 2-4 independent subtasks that can run in parallel. Answer with a "PLAN:" list of "- subtask" lines (each one self-contained, naming the files it touches) and one sentence on how the results fit together. Do not change files yourself.',
    debug: 'You are an expert debugger inside the Ingot IDE. Use the terminal output, stack traces and files you are given to find the root cause. Explain the cause first, then propose the smallest fix. If you need more output, say exactly which command to run. ' + REPLY_STYLE
} as const;

export const AUTOCOMPLETE_SYSTEM_PROMPT = 'You are a code completion engine. Continue the code at <CURSOR>. Reply with only the text to insert at the cursor: no explanations, no markdown fences, no repetition of the existing code.';

/** Speech-to-text for composer dictation (IDEA-98): OpenAI-compatible transcription endpoint and model. */
export const TRANSCRIBE_PATH = '/audio/transcriptions';
export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
export const MAX_DICTATION_BYTES = 20 * 1024 * 1024;
