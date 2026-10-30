export const CODE_REVIEW_WIDGET_ID = 'ingot-code-review';
export const CODE_REVIEW_WIDGET_LABEL = 'Review';

export const CODE_REVIEW_COMMANDS = {
    changes: { id: 'ingot.codeReview.changes', label: 'Review Changes', category: 'Ingot' },
    githubPr: { id: 'ingot.codeReview.githubPr', label: 'Review GitHub PR', category: 'Ingot' },
    toggle: { id: 'ingot.codeReview.toggle', label: 'Review', category: 'View' },
    fix: { id: 'ingot.codeReview.fix', label: 'Fix Review Finding with Agent', category: 'Ingot' },
    clear: { id: 'ingot.codeReview.clear', label: 'Clear Review Findings', category: 'Ingot' }
} as const;

export const PR_INPUT_PLACEHOLDER = '#123 or https://github.com/owner/repo/pull/123';
/** Diagnostics span the whole line; Monaco clamps the end column to the line length. */
export const LINE_END_COLUMN = 10_000;
export const FIX_ACTION_PREFIX = 'Fix with agent: ';
