/** IDEA-287: what "Convert to .ingot" copies, with the label used in the summary ("3 rules, 1 command, mcp.json"). */
export const CURSOR_ITEM_LABELS = {
    rule: ['rule', 'rules'],
    command: ['command', 'commands'],
    skill: ['skill file', 'skill files'],
    mcp: ['mcp.json', 'mcp.json'],
    hooks: ['hooks.json', 'hooks.json'],
    hookScript: ['hook script', 'hook scripts'],
    ignore: ['ignore file', 'ignore files'],
    bugbot: ['BUGBOT.md', 'BUGBOT.md files'],
    environment: ['environment.json', 'environment.json'],
    environmentFile: ['Dockerfile', 'Dockerfiles'],
    habit: ['habit', 'habits']
} as const;

/** Cursor's legacy rules file and where it lands. */
export const CURSORRULES_TARGET = '.ingot/rules/cursorrules.md';
/** A converted AGENTS.md (root or nested) becomes `<folder>/.ingot/rules/agents.md`. */
export const AGENTS_RULE_NAME = 'agents';
export const CONVERTED_RULE_EXT = '.md';

export const MERGE_TARGETS = {
    mcp: '.ingot/mcp.json',
    hooks: '.ingot/hooks.json',
    '.cursorignore': '.ingotignore',
    '.cursorindexingignore': '.ingotindexingignore'
} as const;

export const CURSOR_DIR_PREFIX = '.cursor/';
export const INGOT_DIR_PREFIX = '.ingot/';
export const CURSOR_ENVIRONMENT_PATH = '.cursor/environment.json';

/** Hook commands that call scripts in `.cursor/hooks/` are pointed at the copies in `.ingot/hooks/`. */
export const CURSOR_HOOKS_PATH = '.cursor/hooks/';
export const INGOT_HOOKS_PATH = '.ingot/hooks/';

/** Root `.cursor` folder entries that are copied (anything else, like extensions, is left out). */
export const CURSOR_COPIED_DIRS = ['rules', 'commands', 'skills', 'hooks', 'habits'] as const;
export const CURSOR_COPIED_FILES = ['mcp.json', 'hooks.json', 'BUGBOT.md', 'environment.json'] as const;
export const CURSOR_ROOT_FILES = ['.cursorrules', '.cursorignore', '.cursorindexingignore', 'AGENTS.md'] as const;
/** Nested Cursor files found anywhere below the root. */
export const CURSOR_NESTED_GLOBS = ['**/AGENTS.md', '**/.cursor/rules/**/*.md', '**/.cursor/rules/**/*.mdc', '**/.cursor/BUGBOT.md'] as const;
export const CURSOR_WALK_MAX_FILES = 500;
