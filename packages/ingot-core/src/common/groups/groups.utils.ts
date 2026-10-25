import { INGOT_GROUP_EXT } from './groups.consts';

const trimSlash = (value: string): string => value.replace(/\/+$/, '');

/** True when `uri` is `root` or inside it (string URIs or paths). */
export const isUnder = (uri: string, root: string): boolean => {
    const base = trimSlash(root);
    return uri === base || uri.startsWith(`${base}/`);
};

export const isGroupFileName = (path: string): boolean => trimSlash(path).endsWith(`.${INGOT_GROUP_EXT}`);

/** File name for a new group; keeps letters, digits, dot, dash and underscore. */
export const groupFileName = (name: string): string => {
    const safe = name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return `${safe || 'group'}.${INGOT_GROUP_EXT}`;
};

/** Folder entry for a group file: relative when the project sits below the group file's folder. */
export const groupFolderPath = (groupDir: string, projectPath: string): string => {
    const dir = trimSlash(groupDir);
    const project = trimSlash(projectPath);
    return project.startsWith(`${dir}/`) ? project.slice(dir.length + 1) : project;
};

/** Cycles through project tabs like classic IDEs "Next/Previous Project Window". */
export const cycleProject = (projects: readonly string[], current: string | undefined, delta: 1 | -1): string | undefined => {
    if (projects.length === 0) {
        return undefined;
    }
    const index = current ? projects.indexOf(current) : -1;
    return projects[(index + delta + projects.length) % projects.length];
};
