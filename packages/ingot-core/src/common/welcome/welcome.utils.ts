import {
    FILE_SCHEME_PREFIX, HOME_TILDE, KIND_LABELS, MAX_INITIALS, MAX_RECENT_PROJECTS, PLAN_FREE, PLAN_SIGNED_OUT, SSH_MAX_PORT, SSH_PORT_FLAG, SSH_URL_PREFIX
} from './welcome.consts';
import type { RecentProject, SshTarget } from './welcome.types';
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

/** IDEA-266: a recent row reads "alloy (Workspace)" on the left and the folder it lives in on the right. */
export const recentProjectLabel = (project: Pick<RecentProject, 'name' | 'kind'>): string =>
    KIND_LABELS[project.kind] ? `${project.name} (${KIND_LABELS[project.kind]})` : project.name;

export const recentProjectLocation = (project: Pick<RecentProject, 'path'>): string => {
    const slash = project.path.lastIndexOf('/');
    return slash > 0 ? project.path.slice(0, slash) : project.path;
};

/** IDEA-266: the plan under the logo ("Pro · Settings"). */
export const welcomePlanLabel = (account: { readonly signedIn: boolean; readonly user?: { readonly plan?: string } }): string => {
    if (!account.signedIn) {
        return PLAN_SIGNED_OUT;
    }
    const plan = account.user?.plan?.trim();
    return plan ? plan[0].toUpperCase() + plan.slice(1) : PLAN_FREE;
};

/** IDEA-266: Connect via SSH accepts `host`, `user@host`, `user@host:port` or `ssh://user@host:port`; nothing that ssh could read as an option. */
export const parseSshTarget = (input: string): SshTarget | undefined => {
    const trimmed = input.trim();
    const value = trimmed.startsWith(SSH_URL_PREFIX) ? trimmed.slice(SSH_URL_PREFIX.length) : trimmed;
    const m = /^((?:[\w.-]+@)?[A-Za-z0-9][\w.-]*)(?::(\d{1,5}))?$/.exec(value);
    if (!m || value.startsWith('-')) {
        return undefined;
    }
    const port = m[2] ? Number(m[2]) : undefined;
    if (port !== undefined && (port < 1 || port > SSH_MAX_PORT)) {
        return undefined;
    }
    return port ? { destination: m[1], port } : { destination: m[1] };
};

export const sshArgs = (target: SshTarget): string[] => target.port ? [SSH_PORT_FLAG, String(target.port), target.destination] : [target.destination];
