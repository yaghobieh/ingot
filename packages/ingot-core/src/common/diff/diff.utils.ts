import type { DiffHunk, DiffStats } from './diff.types';

const splitLines = (text: string): string[] => text.split(/\r?\n/);

/** Line diff based on the longest common subsequence; good enough for agent edit review. */
export const lineDiff = (oldText: string, newText: string): DiffHunk[] => {
    const a = splitLines(oldText);
    const b = splitLines(newText);
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const hunks: DiffHunk[] = [];
    let i = 0;
    let j = 0;
    let current: { newStart: number; oldStart: number; removed: string[]; added: string[] } | undefined;
    const flush = (): void => {
        if (current && (current.removed.length || current.added.length)) {
            hunks.push(current);
        }
        current = undefined;
    };
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            flush();
            i++;
            j++;
        } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
            current ??= { newStart: j, oldStart: i, removed: [], added: [] };
            current.added.push(b[j++]);
        } else {
            current ??= { newStart: j, oldStart: i, removed: [], added: [] };
            current.removed.push(a[i++]);
        }
    }
    flush();
    return hunks;
};

export const diffStats = (hunks: readonly DiffHunk[]): DiffStats => ({
    added: hunks.reduce((n, h) => n + h.added.length, 0),
    removed: hunks.reduce((n, h) => n + h.removed.length, 0)
});
