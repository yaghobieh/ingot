import type { HabitNoteKind, LearnedKind } from './learned.types';

/** Next to habits.json, git-ignored the same way; nothing leaves the machine. */
export const LEARNED_FILE = '.ingot/habits-learned.json';
export const LEARNED_GITIGNORE_ENTRY = 'habits-learned.json';
export const LEARNED_FILE_VERSION = 1;
export const MAX_LEARNED_SAMPLES = 20;

/** The silver note texts (IDEA-305/306/307). */
export const HABIT_NOTE_TEXT: Readonly<Record<HabitNoteKind, string>> = {
    handoff: 'Fresh context - handed off',
    plan: 'Checked against plan',
    route: 'Routed to cheaper model',
    habit: 'Saved to Habits'
};
export const HABIT_NOTE_ICONS: Readonly<Record<HabitNoteKind, string>> = {
    handoff: 'debug-restart', plan: 'checklist', route: 'arrow-swap', habit: 'bookmark'
};

export const LEARNED_KIND_LABELS: Readonly<Record<LearnedKind, string>> = {
    'handoff-turns': 'Fresh context', 'plan-template': 'Plan template', 'model-choice': 'Model'
};

/** Bounds for a learned handoff turn threshold. */
export const MIN_HANDOFF_TURNS = 3;
export const MAX_HANDOFF_TURNS = 200;
