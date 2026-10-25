import { lineDiff } from '../diff/diff.utils';
import type { ChangeHunk, ChangeStatus, Checkpoint, CodeChange, HunkState } from './changes.types';

const splitLines = (text: string): string[] => text.split(/\r?\n/);

export const buildHunks = (oldText: string, newText: string, idPrefix = 'h'): ChangeHunk[] =>
    lineDiff(oldText, newText).map((h, i) => ({ id: `${idPrefix}${i}`, oldStart: h.oldStart, newStart: h.newStart, removed: h.removed, added: h.added, state: 'pending' as HunkState }));

export const changeStats = (hunks: readonly ChangeHunk[]): { added: number; removed: number } => ({
    added: hunks.reduce((n, h) => n + h.added.length, 0),
    removed: hunks.reduce((n, h) => n + h.removed.length, 0)
});

/**
 * Text after the user's decisions: the old text with every hunk that is not rejected applied.
 * Pending hunks count as applied (they are live in the editor until decided).
 */
export const composeText = (oldText: string, hunks: readonly ChangeHunk[]): string => {
    const old = splitLines(oldText);
    const out: string[] = [];
    let cursor = 0;
    for (const hunk of [...hunks].sort((a, b) => a.oldStart - b.oldStart)) {
        out.push(...old.slice(cursor, hunk.oldStart));
        out.push(...(hunk.state === 'rejected' ? hunk.removed : hunk.added));
        cursor = hunk.oldStart + hunk.removed.length;
    }
    out.push(...old.slice(cursor));
    return out.join('\n');
};

/** Where each hunk starts in the composed (current) text, so the editor can decorate and scroll to it. */
export const hunkLines = (hunks: readonly ChangeHunk[]): Map<string, { start: number; length: number }> => {
    const lines = new Map<string, { start: number; length: number }>();
    let shift = 0;
    for (const hunk of [...hunks].sort((a, b) => a.oldStart - b.oldStart)) {
        const shown = hunk.state === 'rejected' ? hunk.removed : hunk.added;
        lines.set(hunk.id, { start: hunk.oldStart + shift, length: shown.length });
        shift += shown.length - hunk.removed.length;
    }
    return lines;
};

export const statusOf = (hunks: readonly ChangeHunk[]): ChangeStatus => {
    if (hunks.some(h => h.state === 'pending')) {
        return 'applied';
    }
    if (hunks.every(h => h.state === 'accepted')) {
        return 'accepted';
    }
    return hunks.every(h => h.state === 'rejected') ? 'rejected' : 'partial';
};

export const decide = (change: CodeChange, hunkIds: readonly string[] | 'all', state: HunkState): CodeChange => {
    const hunks = change.hunks.map(h => (hunkIds === 'all' || hunkIds.includes(h.id)) && h.state === 'pending' ? { ...h, state } : h);
    return { ...change, hunks, status: statusOf(hunks) };
};

export const isPending = (change: CodeChange): boolean => change.status === 'streaming' || change.hunks.some(h => h.state === 'pending');

/** Streaming preview: the lines typed so far replace the start of the old file; the rest of the old file follows. */
export const streamingPreview = (oldText: string, partial: string): string => {
    const typed = splitLines(partial);
    const old = splitLines(oldText);
    return [...typed, ...old.slice(typed.length)].join('\n');
};

/** Contents to restore for "Revert to here": the earliest snapshot of each file at or after `messageIndex`. */
export const restorePlan = (checkpoints: readonly Checkpoint[], sessionId: string, messageIndex: number): Map<string, string | undefined> => {
    const plan = new Map<string, string | undefined>();
    for (const checkpoint of checkpoints.filter(c => c.sessionId === sessionId && c.messageIndex >= messageIndex).sort((a, b) => a.messageIndex - b.messageIndex)) {
        for (const [uri, text] of Object.entries(checkpoint.files)) {
            if (!plan.has(uri)) {
                plan.set(uri, text);
            }
        }
    }
    return plan;
};

/** Mini diff rows for the chat block: context, removed and added lines around each hunk. */
export interface MiniDiffRow {
    readonly kind: 'context' | 'added' | 'removed' | 'gap';
    readonly text: string;
    readonly hunkId?: string;
    /** One-based line number in the new text (added / context rows). */
    readonly line?: number;
}

export const miniDiff = (change: Pick<CodeChange, 'newText' | 'hunks'>, context: number, maxRows: number): { rows: MiniDiffRow[]; truncated: boolean } => {
    const lines = splitLines(change.newText);
    const rows: MiniDiffRow[] = [];
    let shownUntil = 0;
    for (const hunk of change.hunks) {
        const from = Math.max(shownUntil, hunk.newStart - context);
        if (rows.length && from > shownUntil) {
            rows.push({ kind: 'gap', text: '…' });
        }
        for (let i = from; i < hunk.newStart; i++) {
            rows.push({ kind: 'context', text: lines[i] ?? '', line: i + 1 });
        }
        hunk.removed.forEach(text => rows.push({ kind: 'removed', text, hunkId: hunk.id }));
        hunk.added.forEach((text, i) => rows.push({ kind: 'added', text, hunkId: hunk.id, line: hunk.newStart + i + 1 }));
        const after = hunk.newStart + hunk.added.length;
        const until = Math.min(lines.length, after + context);
        for (let i = after; i < until; i++) {
            rows.push({ kind: 'context', text: lines[i] ?? '', line: i + 1 });
        }
        shownUntil = until;
    }
    return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
};
