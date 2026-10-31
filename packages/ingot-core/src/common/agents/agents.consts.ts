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
    paused: 'Paused for review',
    approval: 'Waiting for approval',
    done: 'Done',
    error: 'Needs attention'
};

/** How often a streaming reply redraws the chat. Every token would freeze the window. */
export const STREAM_POKE_MS = 80;

/** Statuses counted as "active" in the toolbar and status bar. */
export const ACTIVE_STATUSES: readonly AgentStatus[] = ['thinking', 'editing', 'review', 'paused', 'approval'];

/** Signed out with no own keys (IDEA-101): Ingot models need an account, not API keys. */
export const SIGN_IN_MESSAGE = 'Sign in to use Ingot models — no API keys needed. Or turn on “Use my own API key (BYOK)” in Settings › Models.';
export const NO_MODEL_MESSAGE = 'No model is connected yet, so this request was not sent. Choose a model, or sign in for Ingot models. API keys stay in your OS keychain.';
export const NEW_AGENT_TITLE = 'New chat';
export const COMPOSER_PLACEHOLDER = 'Ask anything, @ to mention, / for actions';
export const AGENT_TITLE = 'Ingot Agent';
export const WORKED_FOR = 'worked for';
/** The shimmering status line at the end of a running chat. */
export const WORKING_LABEL = 'Getting it done…';
export const EDITING_LABEL = 'Editing';
export const EDITED_WORD = 'Edited';
export const REVIEW_WORD = 'Review';
export const REJECT_ALL = 'Reject all';
export const ACCEPT_ALL = 'Accept all';
export const FILE_BADGE_LABELS = {
    ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX', json: 'JSON', html: 'HTML', css: 'CSS', md: 'MD', file: 'FILE'
} as const;
export const MAX_TITLE_LENGTH = 48;
