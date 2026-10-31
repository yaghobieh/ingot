/** IDEA-290: the Artifacts viewer. */
export const ARTIFACTS_WIDGET_ID = 'ingot-artifacts';
export const ARTIFACTS_WIDGET_LABEL = 'Artifacts';
export const ARTIFACTS_COMMANDS = {
    open: { id: 'ingot.artifacts.open', label: 'Artifacts', category: 'Agents' },
    refresh: { id: 'ingot.artifacts.refresh', label: 'Refresh Artifacts', category: 'Agents' }
} as const;
/** Coalesces bursts of writes (plan + screenshot + walkthrough) into one reload. */
export const ARTIFACTS_RELOAD_MS = 150;
export const COMMENT_PLACEHOLDER = 'Comment for the agent… (Enter to send, Esc to cancel)';
