import type { KeymapEntry } from './keymap.types';

/** Ingot tool window shortcuts (IDEA-14). */
export const TOOL_WINDOW_KEYMAP: readonly KeymapEntry[] = [
    { action: 'Project tool window', command: 'fileNavigator:toggle', mac: 'ctrlcmd+1', other: 'alt+1' },
    { action: 'Bookmarks / Search tool window', command: 'search-in-workspace.toggle', mac: 'ctrlcmd+2', other: 'alt+2' },
    { action: 'Run tool window', command: 'output:toggle', mac: 'ctrlcmd+4', other: 'alt+4' },
    { action: 'Debug tool window', command: 'debug:toggle', mac: 'ctrlcmd+5', other: 'alt+5' },
    { action: 'Problems tool window', command: 'problemsView:toggle', mac: 'ctrlcmd+6', other: 'alt+6' },
    { action: 'Structure tool window', command: 'outlineView:toggle', mac: 'ctrlcmd+7', other: 'alt+7' },
    { action: 'Git tool window', command: 'scmView:toggle', mac: 'ctrlcmd+9', other: 'alt+9' },
    { action: 'Commit tool window', command: 'scmView:toggle', mac: 'ctrlcmd+0', other: 'alt+0' },
    { action: 'Terminal tool window', command: 'workbench.action.terminal.toggleTerminal', mac: 'alt+f12', other: 'alt+f12' },
    { action: 'Hide all tool windows', command: 'ingot.hideAllToolWindows', mac: 'ctrlcmd+shift+f12', other: 'ctrl+shift+f12' },
    { action: 'Jump to editor', command: 'ingot.focusEditor', mac: 'escape', other: 'escape', when: 'sideBarFocus || panelFocus' }
];
