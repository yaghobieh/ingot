/** Context key: at least one agent hunk waits for Accept / Reject. */
export const CHANGES_PENDING_KEY = 'ingotChangesPending';
/** Lines of context shown around each hunk in the chat block's mini diff. */
export const MINI_DIFF_CONTEXT = 2;
/** Max diff lines rendered per block before "Show all". */
export const MINI_DIFF_MAX_LINES = 40;
/** How often a streaming edit is pushed into the editor (typing animation). */
export const STREAM_APPLY_MS = 60;
/** IDEA-268: quiet time after a user edit before the pending hunks of that file are diffed again. */
export const REBASE_DEBOUNCE_MS = 120;
