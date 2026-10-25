/** Pure helpers for the breadcrumbs bar (IDEA-76): hover info and the outline tree popup. */

export const formatSize = (bytes: number): string => {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const STATUS_LABELS: Record<string, string> = {
    'M': 'Modified', 'A': 'Added', 'D': 'Deleted', 'R': 'Renamed', 'C': 'Copied', 'U': 'Conflicted', '?': 'Unversioned', '!': 'Ignored'
};

/** Git status of one path from `git status --porcelain=v1 -z -- path` output; 'Unchanged' when empty. */
export const gitStatusLabel = (porcelain: string): string => {
    const entry = porcelain.split('\0').find(Boolean);
    if (!entry) { return 'Unchanged'; }
    const code = entry.slice(0, 2);
    if (code.includes('U') || code === 'AA' || code === 'DD') { return 'Conflicted'; }
    const ch = code.trim()[0] ?? '';
    return STATUS_LABELS[ch] ?? 'Changed';
};

export interface LastCommit { readonly hash: string; readonly author: string; readonly date: string; readonly subject: string }

/** `git log -1 --format=%H%x1f%an%x1f%cI%x1f%s` output. */
export const parseLastCommit = (output: string): LastCommit | undefined => {
    const [hash, author, date, subject] = output.trim().split('\x1f');
    return hash && author ? { hash, author, date: date ?? '', subject: subject ?? '' } : undefined;
};

/** First line of a symbol's declaration, trimmed and shortened. */
export const symbolSignature = (lines: readonly string[], startLine: number, max = 120): string => {
    const text = (lines[startLine] ?? '').trim().replace(/\s*\{\s*$/, '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The doc comment (`/** … *\/` or `//` lines) directly above a declaration, without comment markers. */
export const docComment = (lines: readonly string[], startLine: number): string => {
    let i = startLine - 1;
    while (i >= 0 && /^\s*@\w+/.test(lines[i])) { i--; } // decorators
    const out: string[] = [];
    if (i >= 0 && /\*\/\s*$/.test(lines[i])) {
        for (; i >= 0; i--) {
            out.unshift(lines[i]);
            if (/^\s*\/\*\*?/.test(lines[i])) { break; }
        }
        return out.map(l => l.replace(/\*\/\s*$/, '').replace(/^\s*\/\*\*?|^\s*\* ?/, '').trim()).filter(Boolean).join('\n');
    }
    for (; i >= 0 && /^\s*\/\//.test(lines[i]); i--) {
        out.unshift(lines[i].replace(/^\s*\/\/\s?/, ''));
    }
    return out.join('\n').trim();
};

export interface OutlineItem { readonly id: string; readonly name: string; readonly children: readonly OutlineItem[] }

/** Ids of every node on the path to `id` (inclusive), for auto-expansion. */
export const pathTo = (items: readonly OutlineItem[], id: string): string[] => {
    for (const item of items) {
        if (item.id === id) { return [id]; }
        const sub = pathTo(item.children, id);
        if (sub.length) { return [item.id, ...sub]; }
    }
    return [];
};

/** Ids visible under a filter: matches plus their ancestors. `undefined` when there is no filter. */
export const filterOutline = (items: readonly OutlineItem[], query: string): Set<string> | undefined => {
    const q = query.trim().toLowerCase();
    if (!q) { return undefined; }
    const visible = new Set<string>();
    const walk = (nodes: readonly OutlineItem[], ancestors: string[]): void => {
        for (const n of nodes) {
            if (n.name.toLowerCase().includes(q)) { [...ancestors, n.id].forEach(a => visible.add(a)); }
            walk(n.children, [...ancestors, n.id]);
        }
    };
    walk(items, []);
    return visible;
};

/** Rows of the tree as rendered: depth-first over expanded (or, when filtering, visible) nodes. */
export const visibleRows = <T extends OutlineItem>(items: readonly T[], expanded: ReadonlySet<string>, filter?: ReadonlySet<string>, depth = 0): { item: T; depth: number }[] =>
    items.filter(i => !filter || filter.has(i.id)).flatMap(item => [
        { item, depth },
        ...((filter || expanded.has(item.id)) ? visibleRows(item.children as readonly T[], expanded, filter, depth + 1) : [])
    ]);
