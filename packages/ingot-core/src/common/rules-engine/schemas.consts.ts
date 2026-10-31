import { DOCTOR_CODES, DOCTOR_DEFAULTS } from './rules-engine.consts';
import type { IngotFileSchema, JsonSchema } from './rules-engine.types';

export const SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema#';
export const SCHEMA_BASE_URL = 'https://www.ingotide.com/schemas/';
export const SCHEMA_FILE_SUFFIX = '.schema.json';

const text = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, ...extra });
const bool = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'boolean', description, ...extra });
const textList = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'array', description, items: { type: 'string' }, ...extra });
/** Frontmatter lists may be written `[a, b]`, as `- a` lines, or as `a, b`. */
const listOrText = (description: string, format?: 'glob' | 'regex'): JsonSchema => ({
    type: ['array', 'string'], description, items: { type: 'string', ...(format ? { format } : {}) }, ...(format ? { format } : {})
});
const stringMap = (description: string): JsonSchema => ({ type: 'object', description, additionalProperties: { type: 'string' } });
const DOLLAR_SCHEMA: Readonly<Record<string, JsonSchema>> = { $schema: text('JSON schema of this file (for editors).') };

export const RULE_SCHEMA: JsonSchema = {
    title: 'Ingot rule',
    description: 'Frontmatter of a rule in .ingot/rules (also .cursor/rules and nested rule folders).',
    type: 'object',
    additionalProperties: false,
    properties: {
        description: text('When the rule is useful. With alwaysApply: false and no globs the agent reads it when relevant (agent requested).'),
        globs: listOrText('Files the rule attaches to (relative to the folder that holds .ingot): "src/**/*.ts", ["**/*.tsx", "**/*.css"].', 'glob'),
        alwaysApply: bool('true: loaded in every turn. false: loaded by globs, on request, or by @-mention.', { default: false }),
        pack: text('Store pack the rule came from (publisher.name@version); shown as its provenance.')
    }
};

export const COMMAND_SCHEMA: JsonSchema = {
    title: 'Ingot slash command',
    description: 'Frontmatter of a command in .ingot/commands, run as /<file name>.',
    type: 'object',
    additionalProperties: false,
    properties: {
        description: text('Shown next to the command in the / menu.'),
        args: listOrText('Argument hint shown after the name ("<file> [--fix]"); the text typed after the command replaces $ARGUMENTS.'),
        'argument-hint': text('Same as args (Claude Code name).'),
        model: text('Model to run the command with (defaults to the chat model).'),
        'allowed-tools': listOrText('Tools the command may use.')
    }
};

export const SKILL_SCHEMA: JsonSchema = {
    title: 'Ingot skill',
    description: 'Frontmatter of .ingot/skills/<name>/SKILL.md.',
    type: 'object',
    additionalProperties: false,
    required: ['description'],
    properties: {
        name: text('Skill name, lower-case words with dashes (defaults to the folder name).', { pattern: '^[a-z0-9][a-z0-9-]*$' }),
        description: text('What the skill does and when to use it; the agent picks skills by this text.', { minLength: 1 }),
        license: text('License of the skill.'),
        'allowed-tools': listOrText('Tools the skill may use.'),
        metadata: text('Free-form metadata.')
    }
};

export const SUBAGENT_SCHEMA: JsonSchema = {
    title: 'Ingot custom subagent',
    description: 'Frontmatter of .ingot/agents/<name>.md, started with ingot/task.',
    type: 'object',
    additionalProperties: false,
    properties: {
        name: text('Subagent name (defaults to the file name).', { pattern: '^[\\w.-]+$' }),
        description: text('When the lead agent should hand work to this subagent.'),
        model: text('Model id, or "inherit" for the lead chat\'s model.', { examples: ['inherit'] }),
        readonly: bool('true: the subagent may read but never edit or run commands.'),
        is_background: bool('true: runs in the background without blocking the chat.')
    }
};

export const HABIT_SCHEMA: JsonSchema = {
    title: 'Ingot habit',
    description: 'Frontmatter of a habit playbook in .ingot/habits.',
    type: 'object',
    additionalProperties: false,
    properties: {
        name: text('Habit name shown in the habit pill.'),
        when: text('One sentence: when the agent should follow this habit.'),
        globs: listOrText('Files that suggest this habit.', 'glob'),
        keywords: listOrText('Words in the prompt that suggest this habit.'),
        errorRegex: text('A terminal or diagnostic error matching this regular expression picks the habit.', { format: 'regex' }),
        steps: listOrText('Steps the agent ticks off in order.'),
        allowedTools: listOrText('Tools the agent may use while the habit is on (read_file, ingot/run, github/*, *).'),
        doneCriteria: listOrText('What must be true before the habit is done.')
    }
};

const MCP_SERVER: JsonSchema = {
    type: 'object',
    description: 'A local (command) or remote (url) MCP server.',
    additionalProperties: false,
    anyOf: [{ required: ['command'] }, { required: ['url'] }],
    properties: {
        command: text('Executable that starts the server (npx, node, uvx, docker…).', { minLength: 1 }),
        args: textList('Arguments; ${VAR} is replaced with env values.'),
        env: stringMap('Environment variables. Write "${keychain}" to keep a secret in the OS keychain instead of the file.'),
        envFile: text('dotenv file (relative to the project) added to the server environment.'),
        url: text('URL of a remote (HTTP / SSE) server.', { pattern: '^https?://' }),
        headers: stringMap('HTTP headers; "${keychain}" keeps a value in the OS keychain.'),
        type: { type: 'string', description: 'Transport (detected when absent).', enum: ['stdio', 'http', 'sse', 'streamable-http'] },
        disabled: bool('Keep the server off.')
    }
};

export const MCP_SCHEMA: JsonSchema = {
    title: 'Ingot MCP servers',
    description: '.ingot/mcp.json: MCP servers the agent can use.',
    type: 'object',
    additionalProperties: false,
    required: ['mcpServers'],
    properties: { ...DOLLAR_SCHEMA, mcpServers: { type: 'object', description: 'Servers by name.', additionalProperties: MCP_SERVER } }
};

const AGENT_HOOK: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['command'],
    properties: {
        command: text('Shell command (or, for a prompt hook, the prompt). Gets the event as JSON on stdin.', { minLength: 1 }),
        type: { type: 'string', enum: ['command', 'prompt'], description: '"prompt" asks a model instead of running a command.' },
        model: text('Model of a prompt hook.'),
        matcher: text('Regular expression the command, tool or subagent must match.', { format: 'regex' }),
        timeout: { type: 'number', minimum: 1, description: 'Seconds before the hook is stopped.' },
        failClosed: bool('A crash or timeout blocks the action instead of letting it through.'),
        loop_limit: { type: ['integer', 'null'], minimum: 0, description: 'Follow-ups a stop hook may send per chat (null: no limit).' }
    }
};

const GIT_HOOK_STEP: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    anyOf: [{ required: ['run'] }, { required: ['agent'] }],
    properties: {
        name: text('Step name shown on the tool card.', { minLength: 1 }),
        run: text('Shell command; a non-zero exit blocks the commit or push.'),
        agent: text('A check the model answers with PASS or FAIL about the diff.'),
        timeoutSeconds: { type: 'number', minimum: 1, description: 'Seconds before the step is stopped.' }
    }
};

export const AGENT_HOOK_EVENTS = [
    'sessionStart', 'sessionEnd', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'subagentStart', 'subagentStop',
    'beforeShellExecution', 'afterShellExecution', 'beforeMCPExecution', 'afterMCPExecution', 'beforeReadFile', 'afterFileEdit',
    'beforeSubmitPrompt', 'preCompact', 'stop', 'afterAgentResponse', 'afterAgentThought', 'beforeTabFileRead', 'afterTabFileEdit', 'workspaceOpen'
] as const;

export const HOOKS_SCHEMA: JsonSchema = {
    title: 'Ingot hooks',
    description: '.ingot/hooks.json: git stages run before commit / push, and agent event hooks (Cursor format).',
    type: 'object',
    additionalProperties: false,
    properties: {
        ...DOLLAR_SCHEMA,
        version: { type: 'integer', minimum: 1, description: 'Format version of the agent hooks.', default: 1 },
        'pre-commit': { type: 'array', description: 'Steps before every commit.', items: GIT_HOOK_STEP },
        'pre-push': { type: 'array', description: 'Steps before every push.', items: GIT_HOOK_STEP },
        hooks: {
            type: 'object',
            description: 'Agent event hooks by event name.',
            additionalProperties: false,
            properties: Object.fromEntries(AGENT_HOOK_EVENTS.map(event => [event, { type: 'array', items: AGENT_HOOK, description: `Commands run on ${event}.` }]))
        }
    }
};

export const ENVIRONMENT_SCHEMA: JsonSchema = {
    title: 'Ingot project environment',
    description: '.ingot/environment.json: how to set the project up and run it.',
    type: 'object',
    additionalProperties: false,
    properties: {
        ...DOLLAR_SCHEMA,
        install: text('Command that installs dependencies.'),
        start: text('Command that starts the project.'),
        terminals: {
            type: 'array', description: 'Terminals opened with the project.',
            items: { type: 'object', additionalProperties: false, required: ['name', 'command'], properties: { name: text('Terminal title.'), command: text('Command run in it.'), description: text('What it is for.') } }
        },
        snapshot: text('Cloud snapshot id (cloud agents only).'),
        build: {
            type: 'object', description: 'Image to build.', additionalProperties: false, required: ['dockerfile'],
            properties: { dockerfile: text('Dockerfile, relative to this file.'), context: text('Build context, relative to this file.') }
        },
        image: text('Prebuilt image (node:22).'),
        name: text('Environment name.'),
        user: text('User the commands run as.'),
        ports: {
            type: 'array', description: 'Ports the environment exposes.',
            items: { type: 'object', additionalProperties: false, required: ['port'], properties: { port: { type: 'integer', minimum: 1, maximum: 65_535 }, name: text('Port label.') } }
        }
    }
};

const setupCommands = (description: string): JsonSchema => ({ type: ['array', 'string'], description, items: { type: 'string' } });

export const WORKTREES_SCHEMA: JsonSchema = {
    title: 'Ingot worktree setup',
    description: '.ingot/worktrees.json: commands run in every new agent worktree.',
    type: 'object',
    additionalProperties: false,
    properties: {
        ...DOLLAR_SCHEMA,
        'setup-worktree': setupCommands('Commands (or a script path) for every platform.'),
        'setup-worktree-unix': setupCommands('Commands for macOS and Linux.'),
        'setup-worktree-windows': setupCommands('Commands for Windows.')
    }
};

export const POLICY_SCHEMA: JsonSchema = {
    title: 'Ingot agent policy',
    description: '.ingot/policy.json: what the agent\'s tools may do.',
    type: 'object',
    additionalProperties: true,
    properties: {
        ...DOLLAR_SCHEMA,
        commands: { type: 'object', additionalProperties: false, properties: { allow: textList('Commands that run without approval.'), deny: textList('Commands refused at once (wins over allow).') } },
        paths: { type: 'object', additionalProperties: false, properties: { writable: listOrText('Globs the agent may write.', 'glob'), readOnly: listOrText('Globs the agent may never write.', 'glob') } },
        network: { type: 'object', additionalProperties: false, properties: { default: { type: 'string', enum: ['allow', 'deny'] }, allow: textList('Allowed hosts.'), deny: textList('Denied hosts.') } },
        sandbox: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', enum: ['restricted', 'off'] }, allowWrite: textList('Extra folders commands may write.') } }
    }
};

export const FROZEN_SCHEMA: JsonSchema = {
    title: 'Ingot frozen zones',
    description: '.ingot/frozen.json: files and symbols agents may not change without approval.',
    type: 'object',
    additionalProperties: true,
    properties: {
        ...DOLLAR_SCHEMA,
        version: { type: 'integer', minimum: 1 },
        zones: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: true, required: ['path'],
                properties: { id: text('Zone id.'), path: text('Project-relative path.'), symbol: text('Function, method or class.'), source: { type: 'string', enum: ['user', 'inferred', 'learned'] }, reason: text('Why it is frozen.'), at: { type: 'number' } }
            }
        }
    }
};

export const DOCTOR_SCHEMA: JsonSchema = {
    title: 'Ingot Rules Doctor settings',
    description: '.ingot/doctor.json: budgets and checks for `ingot doctor` and the Problems view.',
    type: 'object',
    additionalProperties: false,
    properties: {
        ...DOLLAR_SCHEMA,
        budget: { type: 'integer', minimum: 1, description: 'Always-on tokens per turn before the doctor warns.', default: DOCTOR_DEFAULTS.budget },
        maxRuleTokens: { type: 'integer', minimum: 1, description: 'A single rule above this many tokens is oversized.', default: DOCTOR_DEFAULTS.maxRuleTokens },
        ignore: {
            type: 'array', description: 'Checks to turn off.',
            items: { type: 'string', enum: DOCTOR_CODES }
        }
    }
};

const MD = 'mdc?';
const AT_ANY_DEPTH = '(?:^|/)';

/** Every user-written `.ingot` file Ingot validates, first match wins. */
export const INGOT_FILE_SCHEMAS: readonly IngotFileSchema[] = [
    { id: 'rule', title: 'Rule', format: 'frontmatter', pattern: new RegExp(`${AT_ANY_DEPTH}\\.(?:ingot|cursor|alloy)/rules/.+\\.${MD}$`, 'i'), schema: RULE_SCHEMA, template: '---\ndescription: \nglobs: \nalwaysApply: false\n---\n' },
    { id: 'command', title: 'Command', format: 'frontmatter', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/commands/.+\\.${MD}$`, 'i'), schema: COMMAND_SCHEMA, template: '---\ndescription: \n---\n' },
    { id: 'skill', title: 'Skill', format: 'frontmatter', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/skills/[^/]+/SKILL\\.md$`), schema: SKILL_SCHEMA, template: '---\nname: \ndescription: \n---\n' },
    { id: 'subagent', title: 'Subagent', format: 'frontmatter', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/agents/[^/]+\\.${MD}$`, 'i'), schema: SUBAGENT_SCHEMA, template: '---\nname: \ndescription: \nmodel: inherit\n---\n' },
    { id: 'habit', title: 'Habit', format: 'frontmatter', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/habits/[^/]+\\.${MD}$`, 'i'), schema: HABIT_SCHEMA, template: '---\nname: \nwhen: \nsteps:\n  - \n---\n' },
    { id: 'mcp', title: 'MCP servers', format: 'json', pattern: new RegExp(`${AT_ANY_DEPTH}\\.(?:ingot|cursor)/mcp\\.json$`), schema: MCP_SCHEMA, template: '{\n  "mcpServers": {}\n}\n' },
    { id: 'hooks', title: 'Hooks', format: 'json', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/hooks\\.json$`), schema: HOOKS_SCHEMA, template: '{\n  "version": 1,\n  "hooks": {}\n}\n' },
    { id: 'environment', title: 'Environment', format: 'json', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/environment\\.json$`), schema: ENVIRONMENT_SCHEMA, template: '{\n  "install": "",\n  "start": ""\n}\n' },
    { id: 'worktrees', title: 'Worktree setup', format: 'json', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/worktrees\\.json$`), schema: WORKTREES_SCHEMA, template: '{\n  "setup-worktree": []\n}\n' },
    { id: 'policy', title: 'Agent policy', format: 'json', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/policy\\.json$`), schema: POLICY_SCHEMA, template: '{\n  "commands": { "allow": [], "deny": [] }\n}\n' },
    { id: 'frozen', title: 'Frozen zones', format: 'json', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/frozen\\.json$`), schema: FROZEN_SCHEMA, template: '{\n  "version": 1,\n  "zones": []\n}\n' },
    { id: 'doctor', title: 'Rules Doctor', format: 'json', pattern: new RegExp(`${AT_ANY_DEPTH}\\.ingot/doctor\\.json$`), schema: DOCTOR_SCHEMA, template: '{\n  "budget": 4000,\n  "maxRuleTokens": 1500\n}\n' }
];
