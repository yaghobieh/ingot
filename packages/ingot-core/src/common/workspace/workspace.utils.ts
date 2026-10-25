import { WORKSPACE_FILE_TYPES } from './workspace.consts';

const extensionOf = (path: string): string => {
    const base = path.replace(/\/+$/, '').split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1) : '';
};

/** True for `.ingot-workspace`, `.code-workspace` and `.theia-workspace` files. */
export const isWorkspaceFileName = (path: string): boolean => WORKSPACE_FILE_TYPES.some(t => t.extension === extensionOf(path));

/** Display name of a project: folder name, or the workspace file name without its extension. */
export const projectDisplayName = (path: string): string => {
    const base = path.replace(/\/+$/, '').split('/').pop() || path;
    return isWorkspaceFileName(base) ? base.slice(0, base.lastIndexOf('.')) : base;
};

export interface WorkspaceFileContent {
    readonly folders: readonly { readonly path: string }[];
    readonly settings: Record<string, unknown>;
}

/** Content of a new multi-root workspace file; folder paths are kept as given (relative or absolute). */
export const createWorkspaceFile = (folders: readonly string[]): WorkspaceFileContent => ({
    folders: [...new Set(folders)].map(path => ({ path })),
    settings: {}
});
