/** IDEA-131/132 process runner limits and defaults. */
export const PROCESS_SERVICE_PATH = '/services/ingot-processes';
/** Output kept in memory per process (tail). */
export const PROCESS_BUFFER_CHARS = 200_000;
/** Output handed to the agent per tool call. */
export const PROCESS_AGENT_OUTPUT_CHARS = 16_000;
export const FOREGROUND_TIMEOUT_MS = 120_000;
/** A background start waits this long so the agent sees the first output (and a port). */
export const BACKGROUND_SETTLE_MS = 2_000;
export const STOP_GRACE_MS = 3_000;
/** Finished processes kept in the list. */
export const MAX_FINISHED_PROCESSES = 20;
export const PROCESS_LIST_DEBOUNCE_MS = 150;
export const LOCKFILES: readonly { readonly file: string; readonly manager: 'pnpm' | 'yarn' | 'bun' | 'npm' }[] = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'bun.lock', manager: 'bun' },
    { file: 'package-lock.json', manager: 'npm' }
];
