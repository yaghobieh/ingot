/** IDEA-267: suggested follow-up actions under each agent reply. */
export const FOLLOW_UPS_PREFIX = 'NEXT:';
export const FOLLOW_UPS_SEPARATOR = '|';
export const MAX_FOLLOW_UPS = 3;
export const MIN_FOLLOW_UP_CHARS = 3;
export const MAX_FOLLOW_UP_CHARS = 80;

export const FOLLOW_UPS_PROTOCOL = [
    `Finish every reply with one last line "${FOLLOW_UPS_PREFIX} <action> ${FOLLOW_UPS_SEPARATOR} <action> ${FOLLOW_UPS_SEPARATOR} <action>":`,
    'two or three short follow-ups the user is likely to want next, each an imperative they could send as their next message',
    '(at most eight words, specific to this task, e.g. "Add a test for the empty cart"). The line is shown as buttons, not as text.'
].join(' ');

/** Shown when the model gave none, picked from what the turn did. */
export const FALLBACK_FOLLOW_UPS = {
    checksFailed: ['Fix the failing checks', 'Show me the failing output', 'Explain why the checks fail'],
    checksPassed: ['Commit the changes', 'Add a test for an edge case', 'Explain the change'],
    edited: ['Run the tests', 'Review the changes with me', 'Add a test for this change'],
    answered: ['Add tests for this code', 'Suggest improvements', 'Find where this is used']
} as const;
