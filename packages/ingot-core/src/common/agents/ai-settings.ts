import type { AgentMode } from './agents.types';

/** IDEA-182: preferences of Settings › Tools › AI & Zaprex that are not owned by another feature. */
export const AI_SETTINGS_PREFS = {
    defaultMode: 'ingot.agent.defaultMode',
    defaultModel: 'ingot.agent.defaultModel',
    zaprexButton: 'ingot.zaprex.showButton',
    aiCommit: 'ingot.commit.ai.enabled',
    attachActiveFile: 'ingot.chat.attachActiveFile'
} as const;

/** Off by default: the open editor file is not attached to chat messages unless the user turns this on. */
export const ATTACH_ACTIVE_FILE_DEFAULT = false;

export const attachActiveFileOn = (value: unknown): boolean => typeof value === 'boolean' ? value : ATTACH_ACTIVE_FILE_DEFAULT;

export const DEFAULT_AGENT_MODES: readonly AgentMode[] = ['agent', 'ask', 'plan', 'debug', 'multi'];

/** A valid mode from the setting, else `fallback` (a typo in settings.json never breaks new chats). */
export const defaultAgentMode = (value: unknown, fallback: AgentMode): AgentMode =>
    typeof value === 'string' && (DEFAULT_AGENT_MODES as readonly string[]).includes(value) ? value as AgentMode : fallback;

/** The model id from the setting; empty means "the last model you picked". */
export const defaultAgentModel = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;
