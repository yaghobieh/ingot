/** IDEA-105 agent edit review: settings, checkpoint pause, countdown and inline review comments. */
export const REVIEW_PREFS = {
    enabled: 'ingot.agent.review.enabled',
    pauseThreshold: 'ingot.agent.reviewPauseThreshold',
    autoContinueSeconds: 'ingot.agent.reviewAutoContinueSeconds',
    autoAccept: 'ingot.agent.review.autoAccept',
    inlineComments: 'ingot.agent.review.inlineComments'
} as const;

export const REVIEW_DEFAULTS = {
    enabled: true,
    pauseThreshold: 10,
    autoContinueSeconds: 120,
    autoAccept: false,
    inlineComments: true
} as const;

export interface ReviewSettings {
    readonly enabled: boolean;
    /** Files per checkpoint; 0 = never pause. */
    readonly pauseThreshold: number;
    /** Seconds before a paused run continues by itself; 0 = never. */
    readonly autoContinueSeconds: number;
    readonly autoAccept: boolean;
    readonly inlineComments: boolean;
}

export const REVIEW_TOGGLE_COMMAND = { id: 'ingot.agent.review.toggle', label: 'Toggle Agent Review', category: 'Ingot' } as const;
export const REVIEW_SUBMIT_COMMAND = { id: 'ingot.agent.review.submit', label: 'Finish Review (Submit Comments)', category: 'Ingot' } as const;

const nonNegativeInt = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** Raw preference values → settings with defaults; review off means no pause and no countdown. */
export const reviewSettings = (get: (key: string) => unknown): ReviewSettings => {
    const enabled = get(REVIEW_PREFS.enabled) !== false;
    return {
        enabled,
        pauseThreshold: enabled ? nonNegativeInt(get(REVIEW_PREFS.pauseThreshold), REVIEW_DEFAULTS.pauseThreshold) : 0,
        autoContinueSeconds: enabled ? nonNegativeInt(get(REVIEW_PREFS.autoContinueSeconds), REVIEW_DEFAULTS.autoContinueSeconds) : 0,
        autoAccept: !enabled || get(REVIEW_PREFS.autoAccept) === true,
        inlineComments: enabled && get(REVIEW_PREFS.inlineComments) !== false
    };
};

/** Splits a run's edits into checkpoints of `threshold` files (one batch when 0 or not more than the threshold). */
export const checkpoints = <T>(edits: readonly T[], threshold: number): T[][] => {
    if (threshold <= 0 || edits.length <= threshold) {
        return edits.length ? [[...edits]] : [];
    }
    const batches: T[][] = [];
    for (let i = 0; i < edits.length; i += threshold) {
        batches.push(edits.slice(i, i + threshold));
    }
    return batches;
};

/** 102 → "1:42". */
export const formatCountdown = (seconds: number): string => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export type ReviewFileState = 'pending' | 'accepted' | 'rejected' | 'partial';
export const reviewFileState = (status: string): ReviewFileState =>
    status === 'accepted' ? 'accepted' : status === 'rejected' ? 'rejected' : status === 'partial' ? 'partial' : 'pending';

export interface ReviewComment {
    readonly id: string;
    readonly sessionId: string;
    /** Project-relative path. */
    readonly path: string;
    readonly uri: string;
    /** 1-based line in the current file. */
    readonly line: number;
    readonly excerpt: string;
    readonly text: string;
    readonly state: 'draft' | 'submitted' | 'resolved';
}

/** One structured message for the agent with every submitted comment (file, line, code, comment). */
export const formatReviewComments = (comments: readonly ReviewComment[]): string => {
    const byFile = new Map<string, ReviewComment[]>();
    for (const c of [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)) {
        byFile.set(c.path, [...(byFile.get(c.path) ?? []), c]);
    }
    const lines = [`Review comments (${comments.length}). Fix each one, then reply with the edits. Mention each comment id you resolved as [resolved: id].`, ''];
    for (const [file, items] of byFile) {
        lines.push(`### ${file}`);
        for (const c of items) {
            lines.push(`- [${c.id}] line ${c.line}:`, '  ```', ...c.excerpt.split('\n').map(l => `  ${l}`), '  ```', `  ${c.text.trim().replace(/\n/g, '\n  ')}`);
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd();
};

/** Ids the agent marked `[resolved: id]` in its reply. */
export const resolvedIds = (reply: string): string[] => [...reply.matchAll(/\[resolved:\s*([\w-]+)\]/gi)].map(m => m[1]);

/** The lines around `line` (1-based) for a comment's excerpt. */
export const excerptAt = (text: string, line: number, context = 1): string => {
    const rows = text.split('\n');
    const from = Math.max(0, line - 1 - context);
    return rows.slice(from, Math.min(rows.length, line + context)).join('\n');
};
