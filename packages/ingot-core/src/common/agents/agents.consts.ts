import type { AgentMode, AgentStatus, ModelOption } from './agents.types';
import { AUTO_MODEL_ID, MODEL_CATALOG } from '../models/models.consts';
import { AGENT_MODE_INFO } from './agent-modes';

/** Mode ids and labels; icons, colors and permissions live in `agent-modes.ts`. */
export const AGENT_MODES: readonly { readonly id: AgentMode; readonly label: string }[] = AGENT_MODE_INFO.map(({ id, label }) => ({ id, label }));

/** Model picker labels (the only place provider names appear in the UI); backed by the BYOK catalog (IDEA-26). */
export const MODEL_OPTIONS: readonly ModelOption[] = MODEL_CATALOG.map(({ id, label }) => ({ id, label }));

/** New chats use Auto: the first connected recommended model (Ingot models when signed in, IDEA-101). */
export const DEFAULT_MODEL = AUTO_MODEL_ID;

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

/** Signed out with no own keys (IDEA-101): Ingot models need an account, not API keys. */
export const SIGN_IN_MESSAGE = 'Sign in to use Ingot models — no API keys needed. Or turn on “Use my own API key (BYOK)” in Settings › Models.';
export const NO_MODEL_MESSAGE = 'This model is not connected yet. Open Settings › Models (gear ▸ Models, or “Ingot: Models”) to add its API key — keys are stored in your OS keychain — or pick a connected model below.';
export const NEW_AGENT_TITLE = 'New chat';
export const COMPOSER_PLACEHOLDER = 'Tell an agent what to do… @ to add context';
export const MAX_TITLE_LENGTH = 48;
