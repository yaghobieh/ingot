import { lineDiff } from '../diff/diff.utils';
import type { DiffHunk } from '../diff/diff.types';

/** Local Changes (IDEA-74): one changed file from `git status --porcelain=v1 -z`. */
export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflicted' | 'untracked';

export interface ChangeEntry {
    readonly path: string;
    readonly oldPath?: string;
    readonly status: ChangeStatus;
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

const statusOf = (code: string): ChangeStatus => {
    if (code === '??') {
        return 'untracked';
    }
    if (CONFLICT_CODES.has(code)) {
        return 'conflicted';
    }
    if (code.includes('R') || code.includes('C')) {
        return 'renamed';
    }
    if (code.includes('D')) {
        return 'deleted';
    }
    if (code[0] === 'A' || code === ' A') {
        return 'added';
    }
    return 'modified';
};

export const parseStatusEntries = (output: string): ChangeEntry[] => {
    const out: ChangeEntry[] = [];
    const parts = output.split('\0');
    for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (entry.length < 4 || entry.startsWith('!!')) {
            continue;
        }
        const code = entry.slice(0, 2);
        const status = statusOf(code);
        if (code[0] === 'R' || code[0] === 'C') {
            out.push({ path: entry.slice(3), oldPath: parts[++i], status });
        } else {
            out.push({ path: entry.slice(3), status });
        }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
};

export const STATUS_LABEL: Record<ChangeStatus, string> = {
    modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', conflicted: 'Merge conflict', untracked: 'Unversioned'
};

/** Path parts for the tree: directory (may be '') and file name. */
export const splitPath = (p: string): { dir: string; name: string } => {
    const i = p.lastIndexOf('/');
    return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
};

/** A change hunk with 1-based line ranges on both sides (for gutter checkboxes and navigation). */
export interface ChangeHunk {
    readonly index: number;
    /** 1-based first line in the base (HEAD) text; for pure additions, the line after which lines were added. */
    readonly baseStart: number;
    readonly baseCount: number;
    /** 1-based first line in the working text; for pure deletions, the line after which lines were removed. */
    readonly workStart: number;
    readonly workCount: number;
}

const lines = (text: string): string[] => text.split(/\r?\n/);

/** Hunks between base and working text, with line numbers on both sides. */
export const changeHunks = (base: string, working: string): ChangeHunk[] => {
    const hunks = lineDiff(base, working);
    let shift = 0; // base line = work line - shift (before the hunk)
    return hunks.map((h: DiffHunk, index) => {
        const workStart = h.newStart + 1;
        const baseStart = h.newStart - shift + 1;
        shift += h.added.length - h.removed.length;
        return { index, baseStart, baseCount: h.removed.length, workStart, workCount: h.added.length };
    });
};

/**
 * The text to put in the index when only the `selected` hunks are committed: the base with those hunks applied
 * (partial commit via gutter checkboxes). Unselected hunks stay only in the working tree.
 */
export const applySelectedHunks = (base: string, working: string, selected: ReadonlySet<number>): string => {
    const b = lines(base);
    const w = lines(working);
    const eol = /\r\n/.test(working) ? '\r\n' : '\n';
    const hunks = changeHunks(base, working);
    const out: string[] = [];
    let bi = 0; // next base line index (0-based)
    for (const h of hunks) {
        const baseFrom = h.baseCount ? h.baseStart - 1 : h.baseStart - 1;
        while (bi < baseFrom) {
            out.push(b[bi++]);
        }
        if (selected.has(h.index)) {
            out.push(...w.slice(h.workStart - 1, h.workStart - 1 + h.workCount));
        } else {
            out.push(...b.slice(bi, bi + h.baseCount));
        }
        bi += h.baseCount;
    }
    while (bi < b.length) {
        out.push(b[bi++]);
    }
    return out.join(eol);
};
