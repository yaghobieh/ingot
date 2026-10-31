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
    'global-imported': 'imported',
    team: 'team'
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
/** IDEA-287: shared skill folders other agents use (as Cursor reads them), project and home; lowest priority first. */
export const EXTRA_SKILL_DIRS = ['.codex/skills', '.claude/skills', '.agents/skills'] as const;
export const SKILLS_DIR = 'skills';
export const SKILL_FILE = 'SKILL.md';
export const MCP_FILE = 'mcp.json';
/** IDEA-287: plain-markdown instruction files read at the root and in subfolders in every mode (CLAUDE.md as Cursor reads it). */
export const AGENT_MD_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;
export const AGENTS_FILES = [...AGENT_MD_FILES, '.cursorrules'] as const;
export const RULE_EXTENSIONS = ['.md', '.mdc'] as const;

/** IDEA-287: nested rule files found anywhere in the project (`packages/web/.ingot/rules/x.md`, `packages/web/AGENTS.md`). */
export const NESTED_RULE_GLOBS = ['**/AGENTS.md', '**/CLAUDE.md', '**/.ingot/rules/**/*.md', '**/.ingot/rules/**/*.mdc', '**/.cursor/rules/**/*.md', '**/.cursor/rules/**/*.mdc'] as const;
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

/** IDEA-287: `@path` references in a rule body (Cursor's rule references): at most this many files, each cut at the limit. */
export const MAX_RULE_REFERENCES = 5;
export const MAX_RULE_REFERENCE_CHARS = 8_000;

/** IDEA-287: team rules come from the account's remote config (`config.teamRules`); the user may turn off the ones not enforced. */
export const TEAM_RULES_CONFIG_KEY = 'teamRules';
export const TEAM_RULES_DISABLED_PREF = 'ingot.rules.disabledTeamRules';
export const TEAM_RULE_PATH_PREFIX = 'team:';

/** IDEA-287: Bugbot review guidance (`.ingot/BUGBOT.md`, `.cursor/BUGBOT.md`, nested ones too), used by /bugbot and agent checks. */
export const BUGBOT_FILE = 'BUGBOT.md';
export const BUGBOT_COMMAND = 'bugbot';
export const BUGBOT_GLOBS = ['**/.ingot/BUGBOT.md', '**/.cursor/BUGBOT.md'] as const;
export const MAX_BUGBOT_CHARS = 12_000;

/** IDEA-287: project environment (install, start, terminals), as Cursor's `.cursor/environment.json`. */
export const ENVIRONMENT_FILE = 'environment.json';
export const ENVIRONMENT_COMMAND = { id: 'ingot.environment.start', label: 'Project Environment: Install and Start', category: 'Ingot' } as const;
/** The install step may take a while (dependencies); start and terminals keep running in the background. */
export const ENVIRONMENT_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
/** IDEA-287: builds environment.json's `build` image locally with Docker. */
export const ENVIRONMENT_BUILD_COMMAND = { id: 'ingot.environment.buildImage', label: 'Project Environment: Build Container Image', category: 'Ingot' } as const;
export const DOCKER_BIN = 'docker';
/** Overrides the docker binary (e2e uses a fake one). */
export const DOCKER_BIN_ENV = 'INGOT_DOCKER_BIN';
/** Local image tag: `ingot-env-<project folder>`. */
export const ENVIRONMENT_IMAGE_PREFIX = 'ingot-env-';
/** Paths that mean the project root in `build` (as in Cursor). */
export const ENVIRONMENT_ROOT_PATHS: readonly string[] = ['.', './', '..', '../'];
