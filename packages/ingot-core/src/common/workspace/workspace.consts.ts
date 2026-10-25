export const INGOT_WORKSPACE_EXT = 'ingot-workspace';
export const VSCODE_WORKSPACE_EXT = 'code-workspace';
export const THEIA_WORKSPACE_EXT = 'theia-workspace';

/** Order matters: the first entry is the default for "Save Workspace As…". */
export const WORKSPACE_FILE_TYPES = [
    { name: 'Ingot', extension: INGOT_WORKSPACE_EXT },
    { name: 'Visual Studio Code', extension: VSCODE_WORKSPACE_EXT },
    { name: 'Theia', extension: THEIA_WORKSPACE_EXT },
    { name: 'Ingot project group', extension: 'ingot-group' }
] as const;

export const WORKSPACE_COMMANDS = {
    openFolder: 'workspace:openFolder',
    openWorkspace: 'workspace:openWorkspace',
    saveWorkspaceAs: 'workspace:saveAs',
    addFolder: 'workspace:addFolder'
} as const;
