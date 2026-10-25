import type { MenuPath } from '@theia/core/lib/common/menu';

const c = (id: string, label: string) => ({ id: `ingot.git.${id}`, label, category: 'Git' });

/** File / repository Git actions shared by the editor, project tree and editor tab menus (IDEA-70, IDEA-58). */
export const GIT_FILE_COMMANDS = {
    commitFile: c('file.commit', 'Commit File…'),
    add: c('file.add', 'Add'),
    rollback: c('file.rollback', 'Rollback…'),
    revert: c('file.revert', 'Revert…'),
    cherryPick: c('file.cherryPick', 'Cherry-pick…'),
    showDiff: c('file.showDiff', 'Show Diff'),
    compareWithRevision: c('file.compareWithRevision', 'Compare with Revision…'),
    compareWithBranch: c('file.compareWithBranch', 'Compare with Branch…'),
    compareWithLocal: c('file.compareWithLocal', 'Compare with Local'),
    showHistory: c('file.showHistory', 'Show History'),
    showHistoryForSelection: c('file.showHistoryForSelection', 'Show History for Selection'),
    annotate: c('file.annotate', 'Annotate with Git Blame'),
    showCurrentRevision: c('file.showCurrentRevision', 'Show Current Revision'),
    createPatch: c('file.createPatch', 'Create Patch…'),
    applyPatch: c('applyPatch', 'Apply Patch…'),
    addToGitignore: c('file.addToGitignore', 'Add to .gitignore'),
    stash: c('stash', 'Stash Changes…'),
    unstash: c('unstash', 'Unstash…'),
    shelve: c('shelve', 'Shelve Changes'),
    unshelve: c('unshelve', 'Unshelve…'),
    branchNew: c('branch.new', 'New Branch…'),
    branchCheckout: c('branch.checkout', 'Checkout…'),
    branchMerge: c('branch.merge', 'Merge into Current…'),
    branchRebase: c('branch.rebase', 'Rebase Current onto…'),
    branchCompare: c('branch.compare', 'Compare…'),
    branchRename: c('branch.rename', 'Rename…'),
    branchDelete: c('branch.delete', 'Delete…'),
    pull: c('pull', 'Pull…'),
    fetch: c('fetch', 'Fetch'),
    push: c('push', 'Push…'),
    resetHead: c('resetHead', 'Reset HEAD…'),
    manageRemotes: c('manageRemotes', 'Manage Remotes…'),
    openOnRemote: c('file.openOnRemote', 'Open on Remote'),
    copyRevision: c('copyRevision', 'Copy Revision Number')
} as const;

/** Git Log › commit right-click. Commands take the commit hash as their argument. */
export const GIT_COMMIT_COMMANDS = {
    copyRevision: c('commit.copyRevision', 'Copy Revision Number'),
    createPatch: c('commit.createPatch', 'Create Patch…'),
    cherryPick: c('commit.cherryPick', 'Cherry-Pick'),
    checkout: c('commit.checkout', 'Checkout Revision'),
    showRepository: c('commit.showRepository', 'Show Repository at Revision'),
    compareWithLocal: c('commit.compareWithLocal', 'Compare with Local'),
    resetToHere: c('commit.resetToHere', 'Reset Current Branch to Here…'),
    revert: c('commit.revert', 'Revert Commit'),
    undo: c('commit.undo', 'Undo Commit'),
    editMessage: c('commit.editMessage', 'Edit Commit Message…'),
    fixup: c('commit.fixup', 'Fixup…'),
    squash: c('commit.squash', 'Squash Into…'),
    drop: c('commit.drop', 'Drop Commit'),
    interactiveRebase: c('commit.interactiveRebase', 'Interactively Rebase from Here…'),
    newBranch: c('commit.newBranch', 'New Branch…'),
    newTag: c('commit.newTag', 'New Tag…'),
    goToChild: c('commit.goToChild', 'Go to Child Commit'),
    goToParent: c('commit.goToParent', 'Go to Parent Commit')
} as const;

export const GIT_LOG_COMMIT_MENU: MenuPath = ['ingot-git-log-commit'];
export const GIT_SHELF_DIR = 'ingot-shelf';
