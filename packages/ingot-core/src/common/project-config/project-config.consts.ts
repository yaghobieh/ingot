/**
 * Project configuration locations (IDEA-30). `.ingot` is Ingot's own folder. Existing rule folders
 * (`.cursor`), the legacy `.alloy` folder and AGENTS.md are also read so projects work unchanged.
 */
export const CONFIG_DIRS = {
    ingot: '.ingot',
    legacy: '.alloy',
    external: '.cursor'
} as const;

/** Badge shown next to rules/commands/servers in the UI, per source. */
export const SOURCE_LABELS = {
    ingot: '.ingot',
    legacy: 'legacy',
    external: 'imported',
    agents: 'AGENTS.md',
    user: 'global',
    global: 'global',
    'global-imported': 'imported'
} as const;

/** Env var that points imported global folders somewhere else (e2e isolation); defaults to the home folder. */
export const IMPORT_HOME_ENV = 'INGOT_IMPORT_HOME';
export const SUBAGENTS_DIR = 'agents';
export const HOOKS_DIR = 'hooks';

export const RULES_DIR = 'rules';
export const COMMANDS_DIR = 'commands';
/**
 * IDEA-249: other editors' command / prompt folders, read in the project and in the home folder so `/` lists them
 * (lowest priority first; `.ingot/commands` always wins on a name clash).
 */
export const EXTRA_COMMAND_DIRS = ['.github/prompts', '.windsurf/workflows', '.claude/commands'] as const;
export const SKILLS_DIR = 'skills';
export const SKILL_FILE = 'SKILL.md';
export const MCP_FILE = 'mcp.json';
export const AGENTS_FILES = ['AGENTS.md', '.cursorrules'] as const;
export const RULE_EXTENSIONS = ['.md', '.mdc'] as const;

/** IDEA-287: nested rule files found anywhere in the project (`packages/web/.ingot/rules/x.md`, `packages/web/AGENTS.md`). */
export const NESTED_RULE_GLOBS = ['**/AGENTS.md', '**/.ingot/rules/**/*.md', '**/.ingot/rules/**/*.mdc', '**/.cursor/rules/**/*.md', '**/.cursor/rules/**/*.mdc'] as const;
export const NESTED_RULES_TTL_MS = 10_000;
/** Folder depth the nested-rule walk goes when ripgrep is not available. */
export const NESTED_RULES_MAX_DEPTH = 6;
export const NESTED_RULES_MAX_FILES = 200;
export const AGENTS_FILE = 'AGENTS.md';
/** IDEA-287: the agent tool that returns an Agent Requested rule's body. */
export const FETCH_RULE_TOOL = 'fetch_rule';

/** IDEA-295: rule files the User Rules page writes. */
export const RULE_FILE_EXT = '.md';
export const RULE_KIND_LABELS: Readonly<Record<'always' | 'auto' | 'agent' | 'manual', string>> = {
    always: 'Always',
    auto: 'Auto attached (globs)',
    agent: 'Agent requested (description)',
    manual: 'Manual (@-mention only)'
};

/** IDEA-287: `@` menu entries that attach a rule rather than a file. */
export const RULE_MENTION_PREFIX = 'rule:';
export const MAX_RULE_MENTIONS = 6;

/** IDEA-294: hidden from agents, search, the @ picker and the index (gitignore syntax). `.ingot*` first, then Cursor's. */
export const AGENT_IGNORE_FILES = ['.ingotignore', '.cursorignore'] as const;
/** IDEA-294: kept out of the codebase index only. */
export const INDEX_IGNORE_FILES = ['.ingotindexingignore', '.cursorindexingignore'] as const;

export const MCP_SERVICE_PATH = '/services/ingot/mcp';
export const MCP_REQUEST_TIMEOUT_MS = 15_000;
export const MCP_PROTOCOL_VERSION = '2025-06-18';
/** Most tool round trips per agent turn, so a looping model cannot run forever. Raised so a real task can read, edit, check and fix. */
export const MAX_TOOL_ROUNDS = 12;
export const MAX_TOOL_RESULT_CHARS = 16_000;
