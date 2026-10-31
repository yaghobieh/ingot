import type { LearnedKind } from './learned.types';

/** Next to habits.json, git-ignored the same way; nothing leaves the machine. */
export const LEARNED_FILE = '.ingot/habits-learned.json';
export const LEARNED_GITIGNORE_ENTRY = 'habits-learned.json';
export const LEARNED_FILE_VERSION = 1;
export const MAX_LEARNED_SAMPLES = 20;

/** Habits page focus id of a learned preference (handoff point, plan template, model). */
export const LEARNED_PREF_FOCUS_PREFIX = 'preference:';

export const LEARNED_KIND_LABELS: Readonly<Record<LearnedKind, string>> = {
    'handoff-turns': 'Fresh context', 'plan-template': 'Plan template', 'model-choice': 'Model'
};

/** Bounds for a learned handoff turn threshold. */
export const MIN_HANDOFF_TURNS = 3;
export const MAX_HANDOFF_TURNS = 200;
