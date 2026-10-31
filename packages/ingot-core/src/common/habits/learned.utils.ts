import type { TaskType } from '../router/router.types';
import { TASK_TYPE_LABELS } from '../router/router.consts';
import { LEARNED_FILE_VERSION, LEARNED_PREF_FOCUS_PREFIX, MAX_HANDOFF_TURNS, MAX_LEARNED_SAMPLES, MIN_HANDOFF_TURNS } from './learned.consts';
import type { LearnedEvidence, LearnedFile, LearnedHabit, LearnedKind, LearnedSample, LearnOutcome } from './learned.types';

export const learnedId = (kind: LearnedKind, taskType?: TaskType): string => taskType && kind !== 'handoff-turns' ? `${kind}:${taskType}` : kind;

/** Habits page focus of a learned preference, for its "Saved to Habits" note. */
export const learnedPrefFocus = (id: string): string => `${LEARNED_PREF_FOCUS_PREFIX}${id}`;

const median = (values: readonly number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const numbers = (samples: readonly LearnedSample[], positive: boolean): number[] =>
    samples.filter(s => s.positive === positive).map(s => Number(s.value)).filter(n => Number.isFinite(n) && n > 0);

/**
 * The value a habit applies, from its samples:
 * - handoff turns: the median turn count of accepted handoffs, raised above any later "Not now";
 * - model choice: the model accepted most often (more accepted than turned down);
 * - plan template: the latest approved plan's generalized steps.
 */
export const learnedValue = (kind: LearnedKind, samples: readonly LearnedSample[]): string | undefined => {
    if (kind === 'handoff-turns') {
        const accepted = numbers(samples, true);
        if (!accepted.length) {
            return undefined;
        }
        const lastAccepted = Math.max(...samples.filter(s => s.positive).map(s => s.at));
        const later = numbers(samples.filter(s => s.at >= lastAccepted), false);
        let turns = median(accepted);
        const above = later.filter(n => n >= turns);
        if (above.length) {
            turns = Math.max(...above) + 1;
        }
        return String(Math.min(MAX_HANDOFF_TURNS, Math.max(MIN_HANDOFF_TURNS, turns)));
    }
    if (kind === 'model-choice') {
        const score = new Map<string, { yes: number; no: number }>();
        for (const s of samples) {
            const entry = score.get(s.value) ?? { yes: 0, no: 0 };
            score.set(s.value, s.positive ? { ...entry, yes: entry.yes + 1 } : { ...entry, no: entry.no + 1 });
        }
        const best = [...score.entries()].filter(([, v]) => v.yes > v.no).sort((a, b) => b[1].yes - a[1].yes || a[1].no - b[1].no)[0];
        return best?.[0];
    }
    return [...samples].reverse().find(s => s.positive)?.value;
};

/** How many accepted samples back the current value (what the Habits threshold counts). */
export const supportOf = (kind: LearnedKind, samples: readonly LearnedSample[], value: string | undefined): number =>
    kind === 'model-choice' ? samples.filter(s => s.positive && s.value === value).length : samples.filter(s => s.positive).length;

/**
 * Counts one observation. The habit is saved once `threshold` accepted samples back a value; the outcome's `saved` is
 * set only on that first save (the chat shows "Saved to Habits" once). Habits turned off are left alone.
 */
export const recordLearned = (list: readonly LearnedHabit[], evidence: LearnedEvidence, now: number, threshold: number): LearnOutcome => {
    const id = learnedId(evidence.kind, evidence.taskType);
    const existing = list.find(h => h.id === id);
    if (existing && !existing.enabled) {
        return { learned: [...list] };
    }
    const base: LearnedHabit = existing ?? {
        id, kind: evidence.kind, ...(evidence.taskType && evidence.kind !== 'handoff-turns' ? { taskType: evidence.taskType } : {}),
        samples: [], status: 'learning', enabled: true, firstSeen: now, lastSeen: now
    };
    const samples = [...base.samples, { value: evidence.value, positive: evidence.positive, at: now }].slice(-MAX_LEARNED_SAMPLES);
    const value = learnedValue(base.kind, samples);
    const saves = base.status === 'learning' && value !== undefined && supportOf(base.kind, samples, value) >= threshold;
    const next: LearnedHabit = {
        ...base, samples, lastSeen: now, status: saves ? 'saved' : base.status,
        ...(value !== undefined && (saves || base.status === 'saved') ? { value } : {})
    };
    const learned = existing ? list.map(h => h === existing ? next : h) : [...list, next];
    return { learned, ...(saves ? { saved: next } : {}) };
};

/** The applied value of a saved, enabled habit. */
export const savedValue = (list: readonly LearnedHabit[], id: string): string | undefined => {
    const habit = list.find(h => h.id === id);
    return habit && habit.enabled && habit.status === 'saved' ? habit.value : undefined;
};

/** "Hand off after 12 turns", "Plan template for bug fix tasks", "Ingot Fast for explain tasks". */
export const learnedLabel = (habit: Pick<LearnedHabit, 'kind' | 'taskType' | 'value' | 'status'>, modelLabel: (id: string) => string = id => id): string => {
    const task = habit.taskType ? TASK_TYPE_LABELS[habit.taskType] : 'all';
    if (habit.kind === 'handoff-turns') {
        return habit.value ? `Hand off to a fresh chat after ${habit.value} turns` : 'Learning when a chat goes stale';
    }
    if (habit.kind === 'model-choice') {
        return habit.value ? `${modelLabel(habit.value)} for ${task} tasks` : `Learning a model for ${task} tasks`;
    }
    return `Plan template for ${task} tasks`;
};

export const parseLearned = (text: string | undefined): LearnedHabit[] => {
    if (!text?.trim()) {
        return [];
    }
    try {
        const json = JSON.parse(text) as Partial<LearnedFile>;
        return Array.isArray(json.learned)
            ? json.learned.filter((h): h is LearnedHabit => !!h && typeof h.id === 'string' && typeof h.kind === 'string' && Array.isArray(h.samples))
            : [];
    } catch {
        return [];
    }
};

export const serializeLearned = (learned: readonly LearnedHabit[]): string => `${JSON.stringify({ version: LEARNED_FILE_VERSION, learned }, undefined, 2)}\n`;
