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
    user: 'user'
} as const;

export const RULES_DIR = 'rules';
export const COMMANDS_DIR = 'commands';
export const SKILLS_DIR = 'skills';
export const SKILL_FILE = 'SKILL.md';
export const MCP_FILE = 'mcp.json';
export const AGENTS_FILES = ['AGENTS.md', '.cursorrules'] as const;
export const RULE_EXTENSIONS = ['.md', '.mdc'] as const;

export const MCP_SERVICE_PATH = '/services/ingot/mcp';
export const MCP_REQUEST_TIMEOUT_MS = 15_000;
export const MCP_PROTOCOL_VERSION = '2025-06-18';
/** Most tool round trips per agent turn, so a looping model cannot run forever. */
export const MAX_TOOL_ROUNDS = 5;
export const MAX_TOOL_RESULT_CHARS = 8_000;
