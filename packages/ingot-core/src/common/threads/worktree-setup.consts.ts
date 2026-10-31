/** IDEA-287: worktree setup as Cursor's `.cursor/worktrees.json`, looked up in the new worktree first, then the project. */
export const WORKTREES_FILE = 'worktrees.json';
export const WORKTREE_CONFIG_DIRS = { ingot: '.ingot', cursor: '.cursor' } as const;
export const WORKTREE_SETUP_KEYS = { unix: 'setup-worktree-unix', windows: 'setup-worktree-windows', any: 'setup-worktree' } as const;
/** Env var the setup commands get: the main checkout the worktree was made from. */
export const ROOT_WORKTREE_ENV = 'ROOT_WORKTREE_PATH';
export const WINDOWS_PLATFORM = 'win32';
export const POWERSHELL_EXT = '.ps1';
export const WORKTREE_SETUP_TIMEOUT_MS = 10 * 60_000;
export const WORKTREE_SETUP_MAX_BUFFER = 8 * 1024 * 1024;
/** Output kept for the toast and the subagent's chat (the end of it, where errors are). */
export const WORKTREE_SETUP_OUTPUT_CHARS = 4_000;
/** A converted script path points back at the untouched `.cursor` folder (relative to `.ingot/worktrees.json`). */
export const CONVERTED_SCRIPT_PREFIX = '../.cursor/';

export const WORKTREE_SETUP_TEXT = {
    ran: 'Worktree setup ran',
    failed: 'Worktree setup failed',
    command: 'command',
    commands: 'commands',
    script: 'script'
} as const;
