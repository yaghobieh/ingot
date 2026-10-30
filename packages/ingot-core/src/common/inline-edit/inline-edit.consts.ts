/** Inline edit (IDEA-262): select code, Cmd+K, describe the change, review the proposed diff in place. */
export const INLINE_EDIT_COMMANDS = {
    start: { id: 'ingot.inlineEdit.start', label: 'Edit Selection with Agent…', category: 'Agents' }
} as const;

/** ChangeTracker session ids of inline edits start with this, so history and review can tell them apart. */
export const INLINE_EDIT_SESSION_PREFIX = 'inline-edit-';
/** Usage feature tag sent with the model request. */
export const INLINE_EDIT_FEATURE = 'inline-edit';
/** Lines of surrounding code sent above and below the selection. */
export const INLINE_EDIT_CONTEXT_LINES = 30;
export const INLINE_EDIT_MAX_TOKENS = 4096;
export const INLINE_EDIT_TEMPERATURE = 0.2;

/** First line of the system prompt; also lets e2e fakes recognize an inline edit request. */
export const INLINE_EDIT_SYSTEM_MARKER = 'You are Ingot inline edit.';
export const INLINE_EDIT_SYSTEM_PROMPT = [
    INLINE_EDIT_SYSTEM_MARKER,
    'Rewrite the SELECTED CODE so it follows the INSTRUCTION.',
    'Reply with the replacement code only: no explanations, no Markdown fences, nothing before or after it.',
    'Keep the indentation, style and language of the surrounding code. Do not repeat the code before or after the selection.'
].join('\n');

export const INLINE_EDIT_TEXT = {
    placeholder: 'Edit selected code… (Enter to generate, Esc to cancel)',
    generating: 'Generating edit…',
    noSelection: 'Select some code in the editor first, then run Edit Selection with Agent.',
    noModel: 'No model connected. Sign in or connect a model in Models, then try again.',
    unchanged: 'The model proposed no changes.',
    failed: 'Inline edit failed'
} as const;
