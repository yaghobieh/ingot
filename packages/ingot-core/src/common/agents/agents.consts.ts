import type { AgentMode, AgentStatus, ModelOption } from './agents.types';
import { MODEL_CATALOG } from '../models/models.consts';

export const AGENT_MODES: readonly { readonly id: AgentMode; readonly label: string }[] = [
    { id: 'agent', label: 'Agent' },
    { id: 'ask', label: 'Ask' },
    { id: 'plan', label: 'Plan' }
];

/** Model picker labels (the only place provider names appear in the UI); backed by the BYOK catalog (IDEA-26). */
export const MODEL_OPTIONS: readonly ModelOption[] = MODEL_CATALOG.map(({ id, label }) => ({ id, label }));

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

export const NO_MODEL_MESSAGE = 'This model is not connected yet. Open Settings › Models (gear ▸ Models, or “Ingot: Models”) to add its API key — keys are stored in your OS keychain — or pick a connected model below.';
export const NEW_AGENT_TITLE = 'New agent';
export const COMPOSER_PLACEHOLDER = 'Tell an agent what to do… @ to add context';
export const MAX_TITLE_LENGTH = 48;
