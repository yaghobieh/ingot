/**
 * IDEA-287: how a workspace uses its Cursor config, chosen once on first open and remembered per workspace.
 * `convert`: copied and translated into `.ingot` (the Cursor files stay untouched, Ingot stops reading them).
 * `keep`: `.cursor` (and `.cursorrules`, `.cursorignore`, `.cursorindexingignore`) are read live; nothing is copied.
 * `off`: the user said no; Cursor files are not read. AGENTS.md (and CLAUDE.md) are plain instructions and always read.
 * A workspace that was never asked behaves like `keep`.
 */
export const CURSOR_MODES = ['convert', 'keep', 'off'] as const;
export const DEFAULT_CURSOR_MODE = 'keep';

/** Per-workspace answers, in the user config folder so the backend (search, index) can read them too. */
export const CURSOR_MODE_FILE = 'cursor-workspaces.json';
export const CURSOR_MODE_FILE_VERSION = 1;

export const CURSOR_MODE_LABELS = {
    convert: 'Convert to .ingot',
    keep: 'Keep .cursor',
    off: 'Do not use Cursor config'
} as const;

export const CURSOR_MODE_DETAILS = {
    convert: 'Copy and translate rules, commands, MCP, ignore files and hooks into .ingot. .cursor stays untouched.',
    keep: 'Read .cursor live as the source. Nothing is copied.',
    off: 'Ingot ignores .cursor, .cursorrules and .cursorignore in this workspace. AGENTS.md and CLAUDE.md are still read.'
} as const;

/** Files and folders that make Ingot ask on first open (project root). */
export const CURSOR_SIGNALS = [
    '.cursor/rules', '.cursor/commands', '.cursor/skills', '.cursor/mcp.json', '.cursor/hooks.json', '.cursor/BUGBOT.md', '.cursor/environment.json',
    '.cursor/agents', '.cursor/worktrees.json', '.cursor/cli.json', '.cursor/sandbox.json', '.cursor/permissions.json', '.cursorrules', '.cursorignore',
    '.cursorindexingignore', 'AGENTS.md'
] as const;

export const CURSOR_PROMPT = {
    ask: 'Cursor config found in this workspace',
    yes: 'Import',
    no: 'Don\'t import',
    how: 'How should Ingot use the Cursor config?',
    convert: CURSOR_MODE_LABELS.convert,
    keep: CURSOR_MODE_LABELS.keep
} as const;

export const CURSOR_MODE_COMMAND = { id: 'ingot.import.cursorMode', label: 'Cursor Config: Change Import Mode…', category: 'Ingot' } as const;
export const CURSOR_CONVERT_COMMAND = { id: 'ingot.import.cursorRules', label: 'Cursor Config: Convert to .ingot', category: 'Ingot' } as const;
export const CURSOR_MODE_RESET_LABEL = 'Ask again next time';
