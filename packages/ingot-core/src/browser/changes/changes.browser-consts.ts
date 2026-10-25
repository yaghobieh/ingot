export const ACCEPT_EDIT_KEY_LABEL = 'Ctrl+Y';
export const REJECT_EDIT_KEY_LABEL = 'Ctrl+N';
export const NEXT_CHANGE_KEY = 'alt+down';
export const PREV_CHANGE_KEY = 'alt+up';

export const CHANGE_COMMANDS = {
    next: { id: 'ingot.changes.next', label: 'Next Agent Change', category: 'Agents' },
    prev: { id: 'ingot.changes.prev', label: 'Previous Agent Change', category: 'Agents' },
    acceptAll: { id: 'ingot.changes.acceptAll', label: 'Accept All Agent Changes', category: 'Agents' },
    rejectAll: { id: 'ingot.changes.rejectAll', label: 'Reject All Agent Changes', category: 'Agents' }
};

export const CHANGE_STATUS_LABELS = {
    streaming: 'Writing…',
    applied: 'Review',
    accepted: 'Accepted',
    rejected: 'Rejected',
    partial: 'Partly accepted'
} as const;
