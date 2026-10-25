import { FILE_SCHEME_PREFIX, HOME_TILDE, MAX_INITIALS, MAX_RECENT_PROJECTS } from './welcome.consts';
import type { RecentProject } from './welcome.types';

const stripScheme = (uri: string): string => decodeURIComponent(uri.startsWith(FILE_SCHEME_PREFIX) ? uri.slice(FILE_SCHEME_PREFIX.length) : uri);

export const projectInitials = (name: string): string => {
    const words = name.split(/[\s_.-]+/).filter(Boolean);
    const letters = words.length > 1 ? words.map(w => w[0]) : [...(words[0] ?? '')];
    return letters.slice(0, MAX_INITIALS).join('').toUpperCase();
};

export const toRecentProject = (uri: string, home?: string): RecentProject => {
    const fsPath = stripScheme(uri).replace(/\/+$/, '');
    const name = fsPath.split('/').pop() || fsPath;
    const path = home && fsPath.startsWith(home) ? `${HOME_TILDE}${fsPath.slice(home.length)}` : fsPath;
    return { uri, name, path, initials: projectInitials(name) };
};

export const toRecentProjects = (uris: readonly string[], home?: string, filter = ''): RecentProject[] => {
    const query = filter.trim().toLowerCase();
    return [...new Set(uris)]
        .map(uri => toRecentProject(uri, home))
        .filter(p => !query || p.name.toLowerCase().includes(query) || p.path.toLowerCase().includes(query))
        .slice(0, MAX_RECENT_PROJECTS);
};

/** Derives the target folder name from a Git clone URL. */
export const repoNameFromUrl = (url: string): string => url.trim().replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() ?? '';
