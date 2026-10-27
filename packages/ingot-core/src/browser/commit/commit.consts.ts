import type { MenuPath } from '@theia/core/lib/common/menu';

const c = (id: string, label: string) => ({ id: `ingot.commit.${id}`, label, category: 'Git' });

/** Local Changes / Commit tool window, diff viewer and Push dialog (IDEA-74). */
export const COMMIT_COMMANDS = {
    commit: c('open', 'Commit…'),
    commitAndPush: c('commitAndPush', 'Commit and Push…'),
    push: c('push', 'Push…'),
    refresh: c('refresh', 'Refresh Local Changes'),
    showDiff: c('showDiff', 'Show Diff'),
    rollback: c('rollback', 'Rollback…'),
    jumpToSource: c('jumpToSource', 'Jump to Source'),
    moveToChangelist: c('moveToChangelist', 'Move to Another Changelist…'),
    addToGitignore: c('addToGitignore', 'Add to .gitignore'),
    delete: c('delete', 'Delete'),
    toggle: c('toggleView', 'Commit tool window'),
    revertChunk: c('revertChunk', 'Revert Chunk'),
    diffUndo: c('diffUndo', 'Undo in Diff'),
    diffRedo: c('diffRedo', 'Redo in Diff'),
    ignoreChunk: c('ignoreChunk', 'Exclude Chunk from Commit'),
    revertFile: c('revertFile', 'Revert File…'),
    /** IDEA-176: floating Commit window (⌥⇧⌘K, status bar, Local Changes toolbar). */
    popOut: c('popOut', 'Open Commit Window'),
    aiMessage: c('aiMessage', 'Commit with AI: Write Commit Message')
} as const;

export const COMMIT_WINDOW_ID = 'ingot-commit-window';
export const COMMIT_WINDOW_STATUS_ID = 'ingot-status-commit-window';

export const LOCAL_CHANGES_WIDGET_ID = 'ingot-local-changes';
export const LOCAL_CHANGES_LABEL = 'Local Changes';
export const DIFF_WIDGET_ID = 'ingot-diff';
export const LOCAL_CHANGES_CONTEXT_MENU: MenuPath = ['ingot-local-changes-context'];
/** Context key while the Local Changes tool window has focus (⌘D, F4, ⌘↩). */
export const LOCAL_CHANGES_FOCUS = 'ingotLocalChangesFocus';
export const DEFAULT_CHANGELIST = 'Default Changelist';
export const UNVERSIONED_GROUP = 'Unversioned Files';
export const CONFLICTS_GROUP = 'Merge Conflicts';
/** Context key while a diff tab has focus (revert chunk ⌘⌥Z, F7 / ⇧F7). */
export const DIFF_FOCUS = 'ingotDiffFocus';

/** Above the focused-editor undo handler (10000), so ⌘Z / Ctrl+Z in the diff viewer reaches its own undo first. */
export const DIFF_UNDO_PRIORITY = 20000;
