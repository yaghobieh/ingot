/** Recent projects for the Dock menu / jump list (IDEA-75), read from the config dir's recentworkspace.json. */
export interface RecentProject {
    /** Absolute file-system path of the folder or .ingot-workspace file. */
    readonly path: string;
    /** Short name shown in menus. */
    readonly label: string;
}

export const MAX_RECENT_PROJECTS = 10;
export const RECENT_WORKSPACE_FILE = 'recentworkspace.json';

const fileUriToPath = (uri: string): string | undefined => {
    if (!uri.startsWith('file://')) {
        return undefined;
    }
    try {
        const pathname = decodeURIComponent(new URL(uri).pathname);
        // file:///c%3A/foo -> c:/foo on Windows
        return /^\/[a-zA-Z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
        return undefined;
    }
};

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

/** Parses recentworkspace.json (`{ recentRoots: string[] }`); tolerant of bad input, de-duplicated, capped. */
export const parseRecentProjects = (json: string, max = MAX_RECENT_PROJECTS): RecentProject[] => {
    let roots: unknown;
    try {
        roots = (JSON.parse(json) as { recentRoots?: unknown }).recentRoots;
    } catch {
        return [];
    }
    if (!Array.isArray(roots)) {
        return [];
    }
    const seen = new Set<string>();
    const out: RecentProject[] = [];
    for (const root of roots) {
        const p = typeof root === 'string' ? fileUriToPath(root) : undefined;
        if (!p || seen.has(p)) {
            continue;
        }
        seen.add(p);
        out.push({ path: p, label: baseName(p).replace(/\.ingot-(workspace|group)$/, '') });
        if (out.length >= max) {
            break;
        }
    }
    return out;
};
