/**
 * IDEA-294: Cursor-compatible agent hook events in `.ingot/hooks.json` (and `.cursor/hooks.json`) under `"hooks"`.
 * IDEA-287: every event Cursor documents: agent loop, Tab (inline completions) and the app's workspaceOpen.
 */
export const AGENT_HOOK_EVENTS = [
    'sessionStart', 'sessionEnd', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'subagentStart', 'subagentStop',
    'beforeShellExecution', 'afterShellExecution', 'beforeMCPExecution', 'afterMCPExecution', 'beforeReadFile', 'afterFileEdit',
    'beforeSubmitPrompt', 'preCompact', 'stop', 'afterAgentResponse', 'afterAgentThought',
    'beforeTabFileRead', 'afterTabFileEdit', 'workspaceOpen'
] as const;

/** Permission hooks: their answer can block the action (allow / deny / ask). The others observe or add context. */
export const GATING_HOOK_EVENTS: readonly string[] = ['beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile', 'beforeTabFileRead', 'preToolUse', 'subagentStart'];
/** Cursor accepts "ask" from these but does not enforce it (preToolUse) or treats it as "deny" (subagentStart). */
export const ASK_IGNORED_EVENTS: readonly string[] = ['preToolUse'];
export const ASK_DENIES_EVENTS: readonly string[] = ['subagentStart'];
/** Hooks whose `followup_message` sends the next user message (loop flows), capped by `loop_limit`. */
export const FOLLOWUP_HOOK_EVENTS: readonly string[] = ['stop', 'subagentStop'];

/** The fixed value a `matcher` is tested against, for events that do not match a command, tool or subagent type. */
export const HOOK_MATCH_VALUES: Readonly<Record<string, string>> = {
    beforeReadFile: 'Read',
    afterFileEdit: 'Write',
    beforeTabFileRead: 'TabRead',
    afterTabFileEdit: 'TabWrite',
    beforeSubmitPrompt: 'UserPromptSubmit',
    stop: 'Stop',
    afterAgentResponse: 'AgentResponse',
    afterAgentThought: 'AgentThought'
};
/** A matcher that matches everything. */
export const MATCH_ALL = '*';
/** Tool names a `preToolUse` / `postToolUse` matcher sees for Ingot's built-in tools (Cursor's names); MCP tools are `MCP:<tool>`. */
export const HOOK_TOOL_NAMES: Readonly<Record<string, string>> = {
    run: 'Shell', run_script: 'Shell', run_tests: 'Shell', read_file: 'Read', list_dir: 'Read', grep: 'Grep', glob: 'Grep', codebase_search: 'Grep',
    task: 'Task', delete: 'Delete', edit: 'Write', web_fetch: 'WebFetch', web_search: 'WebSearch'
};
/** Matcher value of an agent file edit (not a tool call in Ingot's loop). */
export const HOOK_EDIT_TOOL = 'edit';
export const MCP_TOOL_PREFIX = 'MCP:';

/** Read in order; commands from both files run (`.cursor/hooks.json` only while the workspace reads `.cursor` live, IDEA-287). */
export const AGENT_HOOK_FILES = ['.cursor/hooks.json', '.ingot/hooks.json'] as const;
/** IDEA-287: user-level hooks (`~/.cursor/hooks.json`, `~/.ingot/hooks.json`) run in every project, from their own folder. */
export const USER_HOOKS_FILE = 'hooks.json';
/**
 * IDEA-287: system-wide (enterprise, MDM-managed) hooks, Cursor's and Ingot's, per backend OS. They run from their folder.
 * `INGOT_SYSTEM_HOOKS_DIR` replaces them all with one folder (tests, custom MDM layouts).
 */
export const SYSTEM_HOOK_FILES = {
    osx: ['/Library/Application Support/Cursor/hooks.json', '/Library/Application Support/Ingot/hooks.json'],
    linux: ['/etc/cursor/hooks.json', '/etc/ingot/hooks.json'],
    windows: ['C:\\ProgramData\\Cursor\\hooks.json', 'C:\\ProgramData\\Ingot\\hooks.json']
} as const;
export const SYSTEM_HOOKS_DIR_ENV = 'INGOT_SYSTEM_HOOKS_DIR';
/** IDEA-287: team hooks from the account's remote config (`config.teamHooks`, the `"hooks"` object of a hooks.json). */
export const TEAM_HOOKS_CONFIG_KEY = 'teamHooks';
export const TEAM_HOOKS_SOURCE = 'team hooks (account)';
/** Hook files are re-read at most this often (Tab asks on every pause in typing). */
export const HOOK_FILES_TTL_MS = 2_000;

export const AGENT_HOOK_TIMEOUT_SECONDS = 30;
export const AGENT_HOOK_MAX_TIMEOUT_SECONDS = 600;
export const AGENT_HOOK_MAX_OUTPUT_CHARS = 20_000;
/** Default `loop_limit` of a stop / subagentStop hook: follow-ups it may send per chat (`null` = no limit). */
export const HOOK_MS_PER_SECOND = 1000;
export const DEFAULT_HOOK_LOOP_LIMIT = 5;
/** Exit code a command uses to deny without printing JSON (as in other agents' hooks). */
export const HOOK_DENY_EXIT_CODE = 2;
/** Set for every hook command: the project root. */
export const HOOK_PROJECT_ENV = 'INGOT_PROJECT_DIR';
export const HOOK_CURSOR_PROJECT_ENV = 'CURSOR_PROJECT_DIR';
export const HOOK_CLAUDE_PROJECT_ENV = 'CLAUDE_PROJECT_DIR';
export const HOOK_VERSION_ENV = 'CURSOR_VERSION';
export const HOOK_USER_EMAIL_ENV = 'CURSOR_USER_EMAIL';

/** subagentStart/Stop `subagent_type` (and matcher value) of an `ingot/task` subagent. */
export const TASK_SUBAGENT_TYPE = 'generalPurpose';

/** Agent-chat notes for hook outcomes that change a turn. */
export const HOOK_TEXT = {
    promptBlocked: 'Not sent: a beforeSubmitPrompt hook blocked this prompt',
    subagentBlocked: 'Blocked by a subagentStart hook',
    compactNote: 'preCompact hook'
} as const;

/** Prompt hooks (`"type": "prompt"`): the model answers `{ "ok": boolean, "reason"?: string }`. */
export const PROMPT_HOOK_ARGUMENTS = '$ARGUMENTS';
export const PROMPT_HOOK_SYSTEM = 'You check one step of a coding agent against a policy. Reply with JSON only: {"ok": true} when the step is fine, or {"ok": false, "reason": "<one short sentence>"}.';
export const PROMPT_HOOK_MAX_TOKENS = 200;
