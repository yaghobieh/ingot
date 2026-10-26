import { FILE_SCHEME_PREFIX, HOME_TILDE, MAX_INITIALS, MAX_RECENT_PROJECTS } from './welcome.consts';
import type { RecentProject } from './welcome.types';
import { isWorkspaceFileName, projectDisplayName } from '../workspace/workspace.utils';
import { isGroupFileName } from '../groups/groups.utils';

const stripScheme = (uri: string): string => decodeURIComponent(uri.startsWith(FILE_SCHEME_PREFIX) ? uri.slice(FILE_SCHEME_PREFIX.length) : uri);

export const projectInitials = (name: string): string => {
    const words = name.split(/[\s_.-]+/).filter(Boolean);
    const letters = words.length > 1 ? words.map(w => w[0]) : [...(words[0] ?? '')];
    return letters.slice(0, MAX_INITIALS).join('').toUpperCase();
};

export const toRecentProject = (uri: string, home?: string): RecentProject => {
    const fsPath = stripScheme(uri).replace(/\/+$/, '');
    const name = projectDisplayName(fsPath);
    const path = home && fsPath.startsWith(home) ? `${HOME_TILDE}${fsPath.slice(home.length)}` : fsPath;
    return { uri, name, path, initials: projectInitials(name), kind: isGroupFileName(fsPath) ? 'group' : isWorkspaceFileName(fsPath) ? 'workspace' : 'folder' };
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

/** Git clone URLs we accept from the welcome page: https, ssh:// or scp-style `user@host:path`. */
export const isCloneUrl = (url: string): boolean => {
    const value = url.trim();
    if (!value || /\s/.test(value) || value.startsWith('-')) {
        return false;
    }
    return /^https:\/\/[^/]+\/.+/.test(value) || /^ssh:\/\/[^/]+\/.+/.test(value) || /^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(value);
};

/** The folder a clone lands in: `<parent>/<repo>`. */
export const cloneTarget = (parent: string, url: string): string => `${parent.replace(/\/+$/, '')}/${repoNameFromUrl(url)}`;

/** Workspaces shown on the welcome page: the first few, or all after "Show More...". */
export const visibleWorkspaces = <T>(items: readonly T[], expanded: boolean, limit: number): { readonly shown: readonly T[]; readonly more: boolean } =>
    ({ shown: expanded ? items : items.slice(0, limit), more: !expanded && items.length > limit });

/** Open VSX ids look like `namespace.name`; returns the API path parts. */
export const openVsxParts = (id: string): { readonly namespace: string; readonly name: string } => {
    const dot = id.indexOf('.');
    return { namespace: id.slice(0, dot), name: id.slice(dot + 1) };
};
