import type { GitBlameLine } from './git.types';

/** Annotate with Git Blame (IDEA-83): gutter labels, age shading, commit details and line history. */
export const UNCOMMITTED_HASH = '0000000000000000000000000000000000000000';
export const AGE_BUCKETS = 5;
export const ANNOTATION_AUTHOR_CHARS = 12;

/** Age bucket per commit: 0 = newest … AGE_BUCKETS-1 = oldest, spread over the file's date range. */
export const ageBuckets = (lines: readonly GitBlameLine[], buckets = AGE_BUCKETS): Map<string, number> => {
    const times = new Map<string, number>();
    for (const l of lines) {
        times.set(l.hash, l.hash === UNCOMMITTED_HASH || !l.date ? Date.now() : Date.parse(l.date));
    }
    const values = [...times.values()];
    const newest = Math.max(...values);
    const oldest = Math.min(...values);
    const span = newest - oldest;
    const result = new Map<string, number>();
    for (const [hash, t] of times) {
        result.set(hash, span <= 0 ? 0 : Math.min(buckets - 1, Math.floor(((newest - t) / span) * buckets)));
    }
    return result;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Locale-neutral short date for the gutter (`2026-10-24`). */
export const shortDate = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Gutter text for one line: `2026-10-24 John Yaghob…   12`. */
export const annotationLabel = (line: GitBlameLine | undefined, lineNumber: number, digits = 4): string => {
    const num = String(lineNumber).padStart(digits, ' ');
    if (!line) {
        return `${''.padEnd(11 + ANNOTATION_AUTHOR_CHARS)} ${num}`;
    }
    const author = line.author.length > ANNOTATION_AUTHOR_CHARS ? `${line.author.slice(0, ANNOTATION_AUTHOR_CHARS - 1)}…` : line.author.padEnd(ANNOTATION_AUTHOR_CHARS);
    const date = line.hash === UNCOMMITTED_HASH ? 'Today'.padEnd(10) : shortDate(line.date).padEnd(10);
    return `${date} ${author} ${num}`;
};

export interface CommitInfo {
    readonly hash: string;
    readonly author: string;
    readonly email: string;
    readonly date: string;
    readonly message: string;
}

/** `git show --no-patch --format=%H%x1f%an%x1f%ae%x1f%cI%x1f%B` output. */
export const parseCommitInfo = (output: string): CommitInfo | undefined => {
    const [hash, author, email, date, ...rest] = output.split('\x1f');
    return hash?.trim() ? { hash: hash.trim(), author: author ?? '', email: email ?? '', date: date ?? '', message: rest.join('\x1f').trim() } : undefined;
};

export interface LineHistoryEntry {
    readonly hash: string;
    readonly short: string;
    readonly author: string;
    readonly date: string;
    readonly subject: string;
}

/** `git log -L` rows (`%H%x1f%h%x1f%an%x1f%cI%x1f%s`), newest first; the last entry is the commit that introduced the line. */
export const parseLineHistory = (output: string): LineHistoryEntry[] =>
    output.split('\n').filter(l => l.includes('\x1f')).map(l => {
        const [hash, short, author, date, subject] = l.split('\x1f');
        return { hash, short, author, date, subject: subject ?? '' };
    });

/** The revision before a commit, for "Annotate Previous Revision". */
export const previousRevision = (hash: string): string => `${hash}~1`;
