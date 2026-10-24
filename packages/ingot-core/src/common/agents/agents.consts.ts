import type { AgentMode, AgentStatus, ModelOption } from './agents.types';

export const AGENT_MODES: readonly { readonly id: AgentMode; readonly label: string }[] = [
    { id: 'agent', label: 'Agent' },
    { id: 'ask', label: 'Ask' },
    { id: 'plan', label: 'Plan' }
];

/** Model picker labels (the only place provider names appear in the UI). Wired to BYOK in IDEA-25/26. */
export const MODEL_OPTIONS: readonly ModelOption[] = [
    { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
    { id: 'claude-opus-4-1', label: 'Opus 4.1' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini' },
    { id: 'gemini-2-5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'deepseek-v3', label: 'DeepSeek V3' },
    { id: 'openrouter-auto', label: 'OpenRouter Auto' },
    { id: 'ollama-local', label: 'Ollama (local)' }
];

export const DEFAULT_MODEL = MODEL_OPTIONS[0].id;

export const STATUS_LABELS: Record<AgentStatus, string> = {
    idle: 'Waiting for instructions',
    thinking: 'Thinking',
    editing: 'Editing',
    review: 'Ready for review',
    done: 'Done',
    error: 'Needs attention'
};

/** Statuses counted as "active" in the toolbar and status bar. */
export const ACTIVE_STATUSES: readonly AgentStatus[] = ['thinking', 'editing', 'review'];

export const NO_MODEL_MESSAGE = 'No model is connected yet. Add an API key in Settings › Models to run agents (stored in your OS keychain).';
export const NEW_AGENT_TITLE = 'New agent';
export const COMPOSER_PLACEHOLDER = 'Tell an agent what to do… @ to add context';
export const MAX_TITLE_LENGTH = 48;
