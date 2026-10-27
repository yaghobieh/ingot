import { matchGlob } from '../project-config/project-config.utils';

/**
 * IDEA-180 Harmony mode: while the Ingot agent works on a heavy task, Zaprex offers to take ONE exact, well-scoped
 * piece of it (the tests, the docs or the styling) and does it in parallel. The piece has its own file scope: Zaprex
 * may only change files inside it and the main agent may not touch them while Zaprex works (a file lock). Zaprex's
 * edits go through the same review as the agent's.
 */
export const HARMONY_PREFS = {
    enabled: 'ingot.zaprex.harmony.enabled',
    maxPieces: 'ingot.zaprex.harmony.maxPieces',
    askFirst: 'ingot.zaprex.harmony.askFirst'
} as const;

export const HARMONY_DEFAULTS = { enabled: true, maxPieces: 1, askFirst: true } as const;
export const HARMONY_MAX_PIECES = 3;
/** A run counts as heavy from this many plan steps or changed files. */
export const HEAVY_PLAN_STEPS = 4;
export const HEAVY_FILES = 5;

export type HarmonyPieceKind = 'tests' | 'docs' | 'styles';

export interface HarmonyPiece {
    readonly kind: HarmonyPieceKind;
    /** What Zaprex is asked to do, e.g. "Write the tests for: add CSV export". */
    readonly task: string;
    /** Project-relative globs Zaprex may change (and the main agent may not, while Zaprex works). */
    readonly scope: readonly string[];
    /** The bubble text under the T-rex. */
    readonly offer: string;
    /** Short label for the chat reference line and the subagents strip. */
    readonly label: string;
}

interface PieceSpec {
    readonly kind: HarmonyPieceKind;
    readonly match: RegExp;
    readonly scope: readonly string[];
    readonly offer: string;
    readonly label: string;
    readonly verb: string;
}

const PIECES: readonly PieceSpec[] = [
    {
        kind: 'tests', match: /\b(tests?|specs?|unit[- ]tests?|e2e|coverage|testing)\b/i,
        scope: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', 'test/**', 'tests/**', 'e2e/**'],
        offer: 'I can write the tests for this. Hand it to me?', label: 'Tests', verb: 'Write the tests for'
    },
    {
        kind: 'docs', match: /\b(docs?|documentation|readme|changelog|guide)\b/i,
        scope: ['**/*.md', '**/*.mdx', 'docs/**'],
        offer: 'I can update the docs for this. Hand it to me?', label: 'Docs', verb: 'Update the docs for'
    },
    {
        kind: 'styles', match: /\b(css|scss|styles?|styling|theme)\b/i,
        scope: ['**/*.css', '**/*.scss', '**/*.less'],
        offer: 'I can do the styling for this. Hand it to me?', label: 'Styling', verb: 'Do the styling for'
    }
];

export const isHeavyRun = (planSteps: number, files: number): boolean => planSteps >= HEAVY_PLAN_STEPS || files >= HEAVY_FILES;

const clean = (text: string): string => text.replace(/\s+/g, ' ').replace(/[.:\s]+$/, '').trim();

/**
 * Picks ONE piece Zaprex can safely take: the first plan step that is clearly tests, docs or styling; otherwise the
 * tests for the whole goal. Kinds already taken for this run are skipped; undefined when nothing is left.
 */
export const pickHarmonyPiece = (plan: readonly string[], goal: string, taken: readonly HarmonyPieceKind[] = []): HarmonyPiece | undefined => {
    const free = PIECES.filter(p => !taken.includes(p.kind));
    for (const step of plan) {
        const spec = free.find(p => p.match.test(step));
        if (spec) {
            return { kind: spec.kind, task: clean(step), scope: spec.scope, offer: spec.offer, label: spec.label };
        }
    }
    const fallback = free.find(p => p.kind === 'tests');
    const what = clean(goal).slice(0, 120) || 'this change';
    return fallback && { kind: fallback.kind, task: `${fallback.verb}: ${what}`, scope: fallback.scope, offer: fallback.offer, label: fallback.label };
};

export const inScope = (scope: readonly string[], path: string): boolean => scope.some(glob => matchGlob(glob, path));

/** The instruction Zaprex gets for its piece (it sees the goal, its task and the files it may change). */
export const harmonyPrompt = (piece: HarmonyPiece, goal: string): string => [
    `You are Zaprex, working in Harmony mode next to the Ingot agent on: ${clean(goal)}`,
    `Your piece: ${piece.task}.`,
    `Only change files matching: ${piece.scope.join(', ')}. The Ingot agent owns every other file; do not edit them.`,
    'Keep it small and focused. Your edits are reviewed like the agent\'s.'
].join('\n');

/** Why an edit was refused by the Harmony file lock, or undefined when it may go ahead. */
export const harmonyLock = (path: string, editor: 'agent' | 'zaprex', scope: readonly string[] | undefined): string | undefined => {
    if (!scope?.length) {
        return undefined;
    }
    const inside = inScope(scope, path);
    if (editor === 'zaprex' && !inside) {
        return `Skipped "${path}": outside Zaprex's piece (${scope.slice(0, 3).join(', ')}${scope.length > 3 ? ', …' : ''}).`;
    }
    if (editor === 'agent' && inside) {
        return `Left "${path}" to Zaprex (Harmony mode is working on it).`;
    }
    return undefined;
};

export const clampPieces = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(HARMONY_MAX_PIECES, Math.max(1, Math.round(value))) : HARMONY_DEFAULTS.maxPieces;
