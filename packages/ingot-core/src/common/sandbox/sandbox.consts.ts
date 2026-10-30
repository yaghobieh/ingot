import type { ApprovalMode, SandboxMode, SandboxPreset } from './sandbox.types';

export const POLICY_FILE = '.ingot/policy.json';
/** Key in `.ingot/policy.json` for the preset; the file's other keys (IDEA-263 rules) are kept as they are. */
export const PRESET_KEY = 'preset';

export const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'full-access'];
export const APPROVAL_MODES: readonly ApprovalMode[] = ['on-request', 'never', 'auto-review'];

export const DEFAULT_PRESET: SandboxPreset = { sandbox: 'workspace-write', approvals: 'on-request', network: false };

export const SANDBOX_INFO: Record<SandboxMode, { readonly label: string; readonly short: string; readonly icon: string; readonly description: string }> = {
    'read-only': { label: 'Read-only', short: 'Read-only', icon: 'lock', description: 'Reads the project. Edits, commands and the network leave the sandbox.' },
    'workspace-write': { label: 'Workspace write', short: 'Workspace', icon: 'shield', description: 'Edits and runs commands in the project. Writes outside it and the network leave the sandbox.' },
    'full-access': { label: 'Full access', short: 'Full access', icon: 'unlock', description: 'No sandbox: any file, any command, the network.' }
};

export const APPROVAL_INFO: Record<ApprovalMode, { readonly label: string; readonly short: string; readonly description: string }> = {
    'on-request': { label: 'Ask', short: 'Ask', description: 'Anything outside the sandbox waits for Run on the approval card.' },
    never: { label: 'Never ask', short: 'Never', description: 'Anything outside the sandbox is refused; the agent is told why.' },
    'auto-review': { label: 'Auto-review', short: 'Auto', description: 'A cheap model checks the risk first. Low risk runs; the rest asks you.' }
};

export const NETWORK_LABEL = 'Network access';
export const NETWORK_DESCRIPTION = 'Commands may download and call remote hosts without asking.';

export const SANDBOX_REASON = {
    readOnly: 'changes files in a read-only sandbox',
    outside: 'writes outside the project',
    network: 'uses the network',
    policy: 'changes the sandbox policy'
} as const;

/** Programs whose run needs the network whatever their arguments. */
export const NETWORK_PROGRAMS: readonly string[] = ['curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet', 'nc', 'gh', 'brew', 'apt', 'apt-get', 'npx', 'pnpx', 'bunx'];

/** `<program> <subcommand>` pairs that need the network. */
export const NETWORK_SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
    git: ['push', 'pull', 'fetch', 'clone', 'ls-remote', 'submodule'],
    npm: ['install', 'i', 'ci', 'add', 'update', 'publish', 'view', 'info', 'exec', 'create', 'init'],
    pnpm: ['install', 'i', 'add', 'update', 'publish', 'dlx', 'create'],
    yarn: ['install', 'add', 'upgrade', 'publish', 'dlx', 'create'],
    bun: ['install', 'i', 'add', 'update', 'publish', 'create', 'x'],
    pip: ['install', 'download'],
    pip3: ['install', 'download'],
    cargo: ['install', 'fetch', 'publish', 'update'],
    go: ['get', 'install', 'mod'],
    docker: ['pull', 'push', 'login', 'build', 'run']
};

/** `yarn` alone installs. */
export const NETWORK_BARE_PROGRAMS: readonly string[] = ['yarn'];

/** Programs that only read: the only commands a read-only sandbox runs without asking. */
export const READ_ONLY_PROGRAMS: readonly string[] = [
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'pwd', 'echo', 'printf', 'which', 'whoami', 'date', 'stat', 'file', 'tree', 'du', 'df', 'env', 'uname', 'diff', 'sort', 'uniq', 'less', 'more'
];
/** Read-only `git` subcommands. */
export const READ_ONLY_GIT: readonly string[] = ['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'blame', 'ls-files', 'remote'];
/** `find` flags that write. */
export const FIND_WRITE_FLAGS: readonly string[] = ['-delete', '-exec', '-execdir', '-ok', '-okdir'];

/** Programs that write the paths they are given. */
export const WRITE_PROGRAMS: readonly string[] = ['cp', 'mv', 'rm', 'rmdir', 'mkdir', 'touch', 'ln', 'chmod', 'chown', 'tee', 'install', 'dd', 'truncate', 'unzip', 'tar'];

/** Paths outside the project a command may write without leaving the sandbox. */
export const SAFE_OUTSIDE_PREFIXES: readonly string[] = ['/dev/null', '/dev/stdout', '/dev/stderr', '/tmp/', '/private/tmp/'];

/** Shell operators that split a command line into parts checked one by one. */
export const COMMAND_SEPARATOR = /&&|\|\||;|\||\n/;

/**
 * Proxy settings that make a command's HTTP(S) calls fail fast (port 9 is "discard") while the network is off.
 * Local hosts stay reachable for dev servers and tests.
 */
export const NETWORK_OFF_ENV: Readonly<Record<string, string>> = {
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9',
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    all_proxy: 'http://127.0.0.1:9',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
    npm_config_offline: 'true',
    INGOT_SANDBOX_NETWORK: 'off'
};

export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];

/** Auto-review stays cheap: a few hundred tokens per check and a cap per chat. */
export const AUTO_REVIEW_BUDGET = {
    maxChecksPerChat: 20,
    maxTokens: 160,
    maxActionChars: 600
} as const;

export const AUTO_REVIEW_SYSTEM = [
    'You are a security reviewer for a coding agent. You decide if one action is low or high risk for the user.',
    'High risk: deletes or overwrites data outside the project, leaks secrets or code to remote hosts, installs unknown software, changes system settings, force-pushes, or is hard to undo.',
    'Low risk: reads, builds, tests, installs well-known packages for the project, or writes inside the project.',
    'Reply with JSON only: {"risk":"low"|"high","reason":"<one short sentence>"}.'
].join('\n');

export const AUTO_REVIEW_TEXT = {
    budget: 'Auto-review budget for this chat is used up',
    error: 'Auto-review could not reach a model',
    unparsed: 'Auto-review gave no clear answer',
    approved: 'Auto-review: low risk',
    flagged: 'Auto-review: high risk'
} as const;

export const SANDBOX_PREFS = {
    /** Model for auto-review and AI code review; empty picks a cheap connected one, else the chat's model. */
    reviewModel: 'ingot.agent.reviewModel'
} as const;

/** Cheap models first for auto-review and code review. */
export const CHEAP_MODEL_ORDER: readonly string[] = ['ingot:ingot-fast', 'gpt-5-mini', 'deepseek-v3', 'gemini-2-5-pro', 'claude-sonnet-4-5'];
