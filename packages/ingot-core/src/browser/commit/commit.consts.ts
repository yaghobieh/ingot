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
    toggle: c('toggleView', 'Commit tool window')
} as const;

export const LOCAL_CHANGES_WIDGET_ID = 'ingot-local-changes';
export const LOCAL_CHANGES_LABEL = 'Local Changes';
export const DIFF_WIDGET_ID = 'ingot-diff';
export const LOCAL_CHANGES_CONTEXT_MENU: MenuPath = ['ingot-local-changes-context'];
/** Context key while the Local Changes tool window has focus (⌘D, F4, ⌘↩). */
export const LOCAL_CHANGES_FOCUS = 'ingotLocalChangesFocus';
export const DEFAULT_CHANGELIST = 'Default Changelist';
export const UNVERSIONED_GROUP = 'Unversioned Files';
