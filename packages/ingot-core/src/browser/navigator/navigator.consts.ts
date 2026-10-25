export const PROJECT_VIEW_LABEL = 'Project';
export const EXPLORER_CONTAINER_ID = 'explorer-view-container';
export const EXPLORER_COLLAPSED_KEY = 'ingot.explorer.collapsed';

/** Explorer header copy (IDEA-93). */
export const EXPLORER_HEADER_TEXT = {
    collapse: 'Collapse project tree',
    expand: 'Expand project tree'
} as const;

export const FILE_NAVIGATOR_WIDGET_ID = 'files';

/** Header actions, left to right (IDEA-93): Theia's navigator toolbar commands, run against the file tree. */
export const EXPLORER_ACTIONS = [
    { id: 'new-file', icon: 'new-file', title: 'New File…', command: 'file.newFile.toolbar' },
    { id: 'new-folder', icon: 'new-folder', title: 'New Folder…', command: 'file.newFolder.toolbar' },
    { id: 'refresh', icon: 'refresh', title: 'Refresh', command: 'navigator.refresh' },
    { id: 'collapse-all', icon: 'collapse-all', title: 'Collapse All', command: 'navigator.collapse.all' }
] as const;
