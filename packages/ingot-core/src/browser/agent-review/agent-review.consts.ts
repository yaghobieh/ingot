import type { Command } from '@theia/core/lib/common/command';

export const AGENT_REVIEW_WIDGET_ID = 'ingot-agent-review';

export const AGENT_REVIEW_COMMANDS = {
    open: { id: 'ingot.agents.reviewChanges', label: 'Review Agent Changes', category: 'Agents' }
} as const satisfies Record<string, Command>;

export const AGENT_REVIEW_TEXT = {
    title: 'Review',
    empty: 'No agent changes to review in this chat.',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    acceptFile: 'Accept file',
    rejectFile: 'Reject file',
    accept: 'Accept',
    reject: 'Reject',
    openFile: 'Open in editor',
    prev: 'Previous change',
    next: 'Next change',
    base: 'Before',
    current: 'Agent version (editable)'
} as const;

export const FILE_STATE_TEXT = {
    pending: 'Pending',
    accepted: 'Accepted',
    rejected: 'Rejected',
    partial: 'Partly accepted'
} as const;

/** Space kept above a change when the list scrolls to it. */
export const REVEAL_MARGIN_PX = 48;
/** Gap between a hunk's action row and the editor's right edge. */
export const HUNK_ACTIONS_INSET_PX = 12;
export const UNCHANGED_CONTEXT_LINES = 3;
