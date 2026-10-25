import { WORKSPACE_COMMANDS } from '../../common/workspace/workspace.consts';
import type { Command } from '@theia/core/lib/common/command';

export const INGOT_SHELL_COMMANDS = {
    hideAllToolWindows: { id: 'ingot.hideAllToolWindows', label: 'Hide All Tool Windows', category: 'View' },
    focusEditor: { id: 'ingot.focusEditor', label: 'Jump to Editor', category: 'View' },
    showWelcome: { id: 'ingot.showWelcome', label: 'Welcome to Ingot', category: 'Ingot' }
} as const satisfies Record<string, Command>;

export const MAIN_TOOLBAR_ID = 'ingot-main-toolbar';
export const MAIN_TOOLBAR_CLASS = 'ingot-main-toolbar';

/** Commands the main toolbar buttons run (resolved lazily so missing ones are disabled). */
export const TOOLBAR_COMMANDS = {
    openRecent: 'workspace:openRecent',
    openFolder: 'workspace:openFolder',
    git: 'scmView:toggle',
    branches: 'ingot.git.branches',
    runTask: 'ingot.services.toggle',
    run: 'ingot.run',
    debug: 'ingot.debug',
    stop: 'ingot.stop',
    debugStart: 'workbench.action.debug.start',
    debugStop: 'workbench.action.debug.stop',
    searchEverywhere: 'ingot.searchEverywhere',
    settings: 'ingot.settings.open',
    theme: 'ingot.appearance.pick',
    plugins: 'vsxExtensions.toggle'
} as const;

export const NO_PROJECT_LABEL = 'Open Project';
export const NO_VCS_LABEL = 'Version Control';
export const RUN_CONFIGURATION_LABEL = 'Current File';

/** Views opened in the default IDE-style layout on first start. */
export const DEFAULT_LAYOUT_COMMANDS = ['fileNavigator:toggle'] as const;

export const PROJECT_POPUP_RECENT_LIMIT = 8;

/** Actions at the bottom of the project ▾ popup (IDEA-51). */
export const PROJECT_POPUP_ACTIONS = [
    { id: 'open', label: 'Open…', command: WORKSPACE_COMMANDS.openFolder, requiresWorkspace: false },
    { id: 'open-workspace', label: 'Open Workspace…', command: WORKSPACE_COMMANDS.openWorkspace, requiresWorkspace: false },
    { id: 'add-folder', label: 'Add Folder to Workspace…', command: WORKSPACE_COMMANDS.addFolder, requiresWorkspace: true },
    { id: 'save-workspace', label: 'Save Workspace As…', command: WORKSPACE_COMMANDS.saveWorkspaceAs, requiresWorkspace: true },
    { id: 'new-group', label: 'New Project Group…', command: 'ingot.group.new', requiresWorkspace: true }
] as const;
