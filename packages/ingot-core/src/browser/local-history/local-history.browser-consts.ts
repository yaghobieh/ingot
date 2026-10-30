export const LOCAL_HISTORY_WIDGET_ID = 'ingot-local-history';

export const LOCAL_HISTORY_TEXT = {
    title: 'Local History',
    current: 'Current',
    restore: 'Restore',
    restoreHint: 'Put this version back into the file (the current text stays in history)',
    refresh: 'Refresh',
    empty: 'No versions yet. Ingot keeps a version on every save and every agent edit.',
    pick: 'Select a version to compare it with the current file.',
    noEditor: 'Open a file in the editor to see its local history.',
    noWorkspaceFile: 'Local history is kept for files inside the open project only.'
} as const;
