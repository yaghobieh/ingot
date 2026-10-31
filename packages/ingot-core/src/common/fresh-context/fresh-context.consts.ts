import type { FreshContextMode } from './fresh-context.types';

export const FRESH_PREFS = {
    mode: 'ingot.agent.freshContext.mode',
    turns: 'ingot.agent.freshContext.turns',
    failures: 'ingot.agent.freshContext.failures',
    tokenRatio: 'ingot.agent.freshContext.tokenRatio'
} as const;
export const FRESH_MODES: readonly FreshContextMode[] = ['off', 'offer', 'auto'];
export const DEFAULT_FRESH_MODE: FreshContextMode = 'offer';
export const DEFAULT_ROT_TURNS = 12;
export const DEFAULT_ROT_FAILURES = 3;
export const DEFAULT_ROT_RATIO = 0.6;
export const MIN_ROT_FAILURES = 1;
export const MIN_ROT_RATIO = 0.1;
export const MAX_ROT_RATIO = 1;
/** After "Not now" the offer comes back this many turns later (or on a new failure streak). */
export const REOFFER_TURNS = 4;

export const HANDOFFS_DIR = '.ingot/handoffs';
export const DECISIONS_FILE = '.ingot/decisions.md';
export const MAX_DECISIONS_CHARS = 4_000;
export const MAX_DIFF_CHARS = 6_000;
export const MAX_BRIEF_TEXT_CHARS = 1_200;
export const MAX_BRIEF_FAILURES = 3;
export const MAX_SLUG_CHARS = 40;

export const FRESH_HANDOFF_COMMAND = { id: 'ingot.agents.freshHandoff', label: 'Hand Off to a Fresh Chat', category: 'Agents' } as const;
export const FRESH_HANDOFF_KEY = 'ctrlcmd+alt+shift+h';

/** Added to the title of the chat a handoff starts (once, however often it is handed off). */
export const FRESH_TITLE_SUFFIX = ' (fresh)';
export const CONTINUE_PROMPT = 'Continue from the handoff brief.';
export const BRIEF_INTRO = 'You are taking over from an earlier agent chat that had grown too long. Start from this brief instead of the old history. Re-read files before you change them; the brief may be out of date.';
