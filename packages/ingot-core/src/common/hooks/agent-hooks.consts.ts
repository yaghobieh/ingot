/** IDEA-294: Cursor-compatible agent hook events in `.ingot/hooks.json` (and `.cursor/hooks.json`) under `"hooks"`. */
export const AGENT_HOOK_EVENTS = ['beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile', 'afterFileEdit', 'stop'] as const;

/** Events whose answer can block the action (allow / deny / ask). The others are notifications. */
export const GATING_HOOK_EVENTS: readonly string[] = ['beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile'];

/** Read in order; commands from both files run. */
export const AGENT_HOOK_FILES = ['.cursor/hooks.json', '.ingot/hooks.json'] as const;

export const AGENT_HOOK_TIMEOUT_SECONDS = 30;
export const AGENT_HOOK_MAX_TIMEOUT_SECONDS = 600;
export const AGENT_HOOK_MAX_OUTPUT_CHARS = 20_000;
/** Exit code a command uses to deny without printing JSON (as in other agents' hooks). */
export const HOOK_DENY_EXIT_CODE = 2;
/** Set for every hook command: the project root. */
export const HOOK_PROJECT_ENV = 'INGOT_PROJECT_DIR';
export const HOOK_CURSOR_PROJECT_ENV = 'CURSOR_PROJECT_DIR';
