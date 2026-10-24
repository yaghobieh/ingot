export const GIT_LOG_WIDGET_ID = 'ingot-git-log';
export const GIT_LOG_WIDGET_LABEL = 'Git Log';
export const GIT_COMMANDS = {
    branches: { id: 'ingot.git.branches', label: 'Branches…', category: 'Git' },
    newBranch: { id: 'ingot.git.newBranch', label: 'New Branch…', category: 'Git' },
    log: { id: 'ingot.git.log', label: 'Show Log', category: 'Git' },
    fileHistory: { id: 'ingot.git.fileHistory', label: 'Show History for Current File', category: 'Git' }
} as const;
