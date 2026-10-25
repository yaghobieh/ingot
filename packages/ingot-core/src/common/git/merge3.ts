import { changeHunks } from './changes';

/** Three-way merge (IDEA-33): regions where Yours and/or Theirs changed the common base. */
export type MergeChunkKind = 'ours' | 'theirs' | 'same' | 'conflict';

export interface MergeChunk {
    readonly index: number;
    /** 0-based base line range [baseStart, baseEnd). */
    readonly baseStart: number;
    readonly baseEnd: number;
    readonly base: readonly string[];
    readonly ours: readonly string[];
    readonly theirs: readonly string[];
    readonly kind: MergeChunkKind;
}

interface SideHunk { readonly start: number; readonly end: number; readonly lines: readonly string[]; readonly side: 'ours' | 'theirs' }

export const splitText = (text: string): string[] => text.split(/\r?\n/);

const sideHunks = (base: string, other: string, side: SideHunk['side']): SideHunk[] => {
    const w = splitText(other);
    return changeHunks(base, other).map(h => ({ start: h.baseStart - 1, end: h.baseStart - 1 + h.baseCount, lines: w.slice(h.workStart - 1, h.workStart - 1 + h.workCount), side }));
};

const rebuild = (base: readonly string[], from: number, to: number, hunks: readonly SideHunk[]): string[] => {
    const out: string[] = [];
    let pos = from;
    for (const h of hunks) {
        out.push(...base.slice(pos, h.start), ...h.lines);
        pos = h.end;
    }
    out.push(...base.slice(pos, to));
    return out;
};

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((l, i) => l === b[i]);

/** Splits a three-way merge into chunks; touching or overlapping changes from both sides are conflicts. */
export const merge3 = (base: string, ours: string, theirs: string): MergeChunk[] => {
    const b = splitText(base);
    const all = [...sideHunks(base, ours, 'ours'), ...sideHunks(base, theirs, 'theirs')].sort((x, y) => x.start - y.start || x.end - y.end);
    const chunks: MergeChunk[] = [];
    let i = 0;
    while (i < all.length) {
        const group = [all[i]];
        let end = all[i].end;
        const start = all[i].start;
        i++;
        while (i < all.length && all[i].start <= end && (all[i].start < end || group.some(g => g.side !== all[i].side) || all[i].start === start)) {
            group.push(all[i]);
            end = Math.max(end, all[i].end);
            i++;
        }
        const o = group.filter(g => g.side === 'ours');
        const t = group.filter(g => g.side === 'theirs');
        const oursLines = rebuild(b, start, end, o);
        const theirsLines = rebuild(b, start, end, t);
        const kind: MergeChunkKind = !t.length ? 'ours' : !o.length ? 'theirs' : same(oursLines, theirsLines) ? 'same' : 'conflict';
        chunks.push({ index: chunks.length, baseStart: start, baseEnd: end, base: b.slice(start, end), ours: oursLines, theirs: theirsLines, kind });
    }
    return chunks;
};

export type ChunkChoice = 'base' | 'ours' | 'theirs' | 'both';

export const chunkLines = (c: MergeChunk, choice: ChunkChoice): readonly string[] =>
    choice === 'ours' ? c.ours : choice === 'theirs' ? c.theirs : choice === 'both' ? [...c.ours, ...c.theirs] : c.base;

/** The merged text for a choice per chunk (default: base). */
export const buildMerged = (base: string, chunks: readonly MergeChunk[], choose: (c: MergeChunk) => ChunkChoice): string => {
    const b = splitText(base);
    const out: string[] = [];
    let pos = 0;
    for (const c of chunks) {
        out.push(...b.slice(pos, c.baseStart), ...chunkLines(c, choose(c)));
        pos = c.baseEnd;
    }
    out.push(...b.slice(pos));
    return out.join(/\r\n/.test(base) ? '\r\n' : '\n');
};

/** Non-conflicting changes applied, conflicts left at base. */
export const nonConflictingChoice = (c: MergeChunk): ChunkChoice => c.kind === 'ours' || c.kind === 'same' ? 'ours' : c.kind === 'theirs' ? 'theirs' : 'base';

export const MERGE_AI_SYSTEM = 'You resolve git merge conflicts. Combine both sides so that the intent of each change is kept. Reply with ONLY the complete merged file in one fenced code block, no explanation.';

export const mergeAiPrompt = (path: string, base: string, ours: string, theirs: string): string =>
    [`File: ${path}`, 'BASE (common ancestor):', '```', base, '```', 'YOURS (current branch):', '```', ours, '```', 'THEIRS (incoming):', '```', theirs, '```'].join('\n');

/** The merged file from a model reply: the first fenced block, or the whole reply. */
export const extractMergedFile = (reply: string): string => {
    const match = /```[^\n]*\n([\s\S]*?)\n?```/.exec(reply);
    return (match ? match[1] : reply).replace(/\s+$/, '') + '\n';
};
