import type { ApprovalKindName, AutoApproveLevel, ModelPrice, SpecDoc } from './ingot-kit.types';

export const INGOT_DIR = '.ingot';
export const RULES_DIR = '.ingot/rules';
export const COMMANDS_DIR = '.ingot/commands';

/* Rule packs (IDEA-322) */
export const LOCK_FILE = '.ingot/ingot-lock.json';
export const LOCKFILE_VERSION = 1;
/** Installed rules are named `<pack>--<file>`, the same as `ingot try` (so provenance can tell where a rule came from). */
export const PACK_RULE_SEPARATOR = '--';
export const LATEST_RANGE = 'latest';
export const INTEGRITY_PREFIX = 'sha256-';
export const PACK_SPEC_PATTERN = /^@?([a-z0-9]+(?:-[a-z0-9]+)*)[/.]([a-z0-9]+(?:-[a-z0-9]+)*)(?:@(.+))?$/;
export const PUBLISHER_MIN = 3;
export const PUBLISHER_MAX = 32;
export const PACK_NAME_MIN = 2;
export const PACK_NAME_MAX = 50;
/** Pack types `ingot add` installs into a project (themes are installed from the IDE store). */
export const INSTALLABLE_PACK_TYPES = ['rules'] as const;
export const STORE_PATHS = {
    /** GET `?range=^2` → versions and the one the range resolves to. */
    versions: (id: string): string => `/api/marketplace/${encodeURIComponent(id)}/versions`,
    download: (id: string, version: string): string => `/api/marketplace/${encodeURIComponent(id)}/download?version=${encodeURIComponent(version)}`,
    /** GET (members) / PUT (owners and admins): the team's packs. DELETE `/<id>` removes one. */
    teamPacks: '/api/store/team-packs'
} as const;

/* Specs (IDEA-324) */
export const SPECS_DIR = '.ingot/specs';
export const SPEC_DOCS: readonly SpecDoc[] = ['requirements', 'design', 'tasks'];
export const SPEC_DOC_FILES: Readonly<Record<SpecDoc, string>> = { requirements: 'requirements.md', design: 'design.md', tasks: 'tasks.md' };
export const SPEC_DOC_LABELS: Readonly<Record<SpecDoc, string>> = { requirements: 'Requirements', design: 'Design', tasks: 'Tasks' };
export const TASK_LINE = /^(\s*)[-*] \[( |x|X)\]\s+(?:(\d+(?:\.\d+)*)\.?\s+)?(.*)$/;
export const TASK_REQUIREMENTS_LINE = /^\s*[-*]?\s*_?Requirements?:\s*([^_]*)_?\s*$/i;
export const SPEC_SLUG_MAX = 60;
export const TASK_INDENT = 2;
/** The agent tool that ticks a task off when the work is done. */
export const SPEC_TASK_TOOL = 'spec_task';
/** The protocol line the agent sees for the spec tool. */
export const SPEC_TOOL_DESCRIPTION = `Tick a task of a spec in .ingot/specs/<spec>/tasks.md on or off. Arguments: {"spec": "checkout-flow", "task": "2.1", "done": true}. Call it after finishing a spec task. Runs at once.`;

/* Policy (IDEA-325, IDEA-326) */
export const POLICY_FILE_NAME = 'policy.yaml';
export const POLICY_FILE = '.ingot/policy.yaml';
export const POLICY_VERSION = 1;
export const AUTO_APPROVE_LEVELS: readonly AutoApproveLevel[] = ['none', 'read', 'commands', 'all'];
/** What each level runs without the approval card (each level includes the ones before it). */
export const AUTO_APPROVE_KINDS: Readonly<Record<AutoApproveLevel, readonly ApprovalKindName[]>> = {
    none: [],
    read: ['web', 'browser'],
    commands: ['web', 'browser', 'terminal', 'mcp'],
    all: ['web', 'browser', 'terminal', 'mcp', 'git', 'delete']
};
export const AUTO_APPROVE_LABELS: Readonly<Record<AutoApproveLevel, string>> = {
    none: 'Ask for everything',
    read: 'Web and browser reads',
    commands: 'Commands and MCP tools',
    all: 'Everything'
};
export const POLICY_KEYS = ['version', 'secrets', 'network', 'commands', 'audit', 'model', 'budget', 'autoApprove'] as const;
export const SECRETS_KEYS = ['denyRead', 'redact'] as const;
export const REDACT_KEYS = ['patterns', 'envFiles', 'envVars'] as const;
export const BUDGET_KEYS = ['maxCostPerRun', 'price'] as const;
export const PRICE_KEYS = ['input', 'output'] as const;
export const REDACTED = '[redacted]';
/** Env values shorter than this are not redacted as literals (they would hide ordinary words like `true`). */
export const MIN_SECRET_LITERAL = 6;
export const ENV_FILE_PATTERN = /^\.env(\..+)?$/;
export const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
export const COMMAND_SEPARATORS = /\s*(?:&&|\|\||;|\||\n)\s*/;
export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
/** The host the agent's web search calls. */
export const WEB_SEARCH_HOST = 'html.duckduckgo.com';
export const TOKENS_PER_MILLION = 1_000_000;
/** Estimated prices per model cost badge when the policy does not set `budget.price`. */
export const TIER_PRICES: Readonly<Record<string, ModelPrice>> = {
    free: { input: 0, output: 0 },
    $: { input: 0.5, output: 1.5 },
    $$: { input: 3, output: 15 },
    $$$: { input: 15, output: 75 }
};
export const USD_DECIMALS = 2;
export const SMALL_USD_DECIMALS = 4;

/** Secrets that never reach the model or a log, whatever the policy says (same list as the audit log). */
export const BUILTIN_SECRET_PATTERNS: readonly RegExp[] = [
    /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    /(\bBearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi,
    /\bingot_(?:pub|pat|at|rt)_[A-Za-z0-9_-]{8,}\b/g
];

export const POLICY_TEMPLATE = `# Ingot policy (Beta): https://www.ingotide.com/docs/secrets-policy
# Applies to this folder and everything under it. A nested .ingot/policy.yaml wins for model, budget and
# autoApprove; deny and redact lists add up from the root down.
version: 1
secrets:
  # Files the agent may never read, list or attach (globs, relative to this folder).
  denyRead:
    - .env
    - .env.*
    - "**/*.pem"
    - secrets/**
  redact:
    # Extra patterns replaced with [redacted] in the agent's context and in logs.
    patterns: []
    # Also redact every value found in .env files.
    envFiles: true
network:
  # Hosts the agent may fetch or open (subdomains included). Remove the list to allow any host.
  allowedDomains:
    - github.com
    - npmjs.com
commands:
  # Commands the agent may run (* is a wildcard). Remove the list to allow any command.
  allowed:
    - npm test
    - npm run *
    - git status
    - git diff*
# Record every policy violation in the agent audit log.
audit: true
# Model and budget for agent runs in this folder.
# model: ingot-fast
budget:
  maxCostPerRun: 0.5
# none | read | commands | all
autoApprove: read
`;
