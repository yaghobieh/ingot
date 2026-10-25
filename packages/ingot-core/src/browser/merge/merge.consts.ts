const c = (id: string, label: string) => ({ id: `ingot.merge.${id}`, label, category: 'Git' });

/** Merge conflicts (IDEA-33): conflicts dialog and the three-pane merge tool. */
export const MERGE_COMMANDS = {
    conflicts: c('conflicts', 'Resolve Conflicts…'),
    open: c('open', 'Merge…'),
    acceptYours: c('acceptYours', 'Accept Yours'),
    acceptTheirs: c('acceptTheirs', 'Accept Theirs'),
    applyNonConflicting: c('applyNonConflicting', 'Apply All Non-Conflicting Changes'),
    nextConflict: c('nextConflict', 'Next Conflict'),
    previousConflict: c('previousConflict', 'Previous Conflict')
} as const;

export const MERGE_WIDGET_ID = 'ingot-merge';
export const MERGE_FOCUS = 'ingotMergeFocus';
