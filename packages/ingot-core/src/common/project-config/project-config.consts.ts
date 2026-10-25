/** Project configuration locations (IDEA-30). `.alloy` is Ingot's own; `.cursor` and AGENTS.md are read for compatibility. */
export const CONFIG_DIRS = {
    alloy: '.alloy',
    cursor: '.cursor'
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
