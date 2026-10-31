import type { AgentPolicy } from './agent-policy.types';

export const POLICY_FILE = '.ingot/policy.json';

/** Never writable by the agent, whatever the policy says: the policy itself and git internals. */
export const BUILTIN_READ_ONLY: readonly string[] = [POLICY_FILE, '.git/**'];

export const DEFAULT_POLICY: AgentPolicy = {
    commands: { allow: [], deny: [] },
    paths: { writable: [], readOnly: [] },
    network: { default: 'allow', allow: [], deny: [] },
    sandbox: { mode: 'restricted', allowWrite: [] }
};

/** Hosts that stay reachable when the network default is `deny` (dev servers, the browser panel). */
export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];

/** Folders outside the project a command may read or name without asking (binaries, devices, temp). */
export const SAFE_OUTSIDE_PREFIXES: readonly string[] = [
    '/dev/null', '/dev/stdout', '/dev/stderr', '/dev/stdin', '/tmp/', '/private/tmp/',
    '/bin/', '/usr/bin/', '/usr/local/bin/', '/opt/homebrew/bin/', '/usr/sbin/', '/sbin/'
];

/** Package-manager caches commands may write in restricted mode (relative to the home folder). */
export const SANDBOX_HOME_CACHES: readonly string[] = ['.npm', '.cache', '.yarn', '.pnpm-store', 'Library/Caches', 'Library/pnpm', '.bun'];

/** Temp folders commands may write in restricted mode. */
export const SANDBOX_TEMP_DIRS: readonly string[] = ['/private/tmp', '/private/var/folders', '/dev'];

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** The host `ingot/web_search` calls (see the agent actions backend). */
export const WEB_SEARCH_HOST = 'html.duckduckgo.com';

/** Output that shows the sandbox refused a write (macOS `sandbox-exec`). */
export const SANDBOX_DENIED_PATTERN = /operation not permitted|EPERM\b/i;

/** Shell operators that split one command line into parts checked one by one. */
export const COMMAND_SEPARATORS = ['&&', '||', ';', '|', '\n'] as const;

export const POLICY_REASON = {
    invalid: 'has errors, so the agent can only read until it is fixed',
    deniedCommand: 'denies the command',
    notWritable: 'does not let the agent write',
    readOnly: 'keeps this path read-only',
    deniedHost: 'blocks the host',
    outside: 'reaches outside the project',
    mcpAllowed: 'permissions.json mcpAllowlist allows'
} as const;
/** IDEA-287: the separator of a permissions.json `mcpAllowlist` entry (`server:tool`). */
export const MCP_ALLOW_SEPARATOR = ':';
export const REGEX_SPECIAL_CHARS = /[.+?^${}()|[\]\\]/g;

/** Approval card labels for the restricted mode (these cards have no "Always Run"). */
export const SANDBOX_CARD = {
    outside: 'Run outside the project',
    retry: 'Sandbox blocked it, run unrestricted'
} as const;

export const SANDBOX_TEXT = {
    blocked: 'The sandbox refused a write outside the project.',
    notApproved: 'Blocked by the Ingot sandbox: the command tried to write outside the project and the user did not approve running it unrestricted. Do not retry it; keep the work inside the project.'
} as const;

export const POLICY_TEMPLATE: AgentPolicy = {
    commands: {
        allow: ['npm test', 'npm run lint', 'npm run build', 'git status', 'git diff'],
        deny: ['sudo', 'rm -rf /', 'rm -rf ~', 'git push --force', 'curl * | sh', 'chmod -R 777']
    },
    paths: { writable: ['src/**', 'tests/**', 'docs/**', 'package.json'], readOnly: ['.env', '.env.*'] },
    network: { default: 'allow', allow: [], deny: ['pastebin.com', '*.ngrok.io'] },
    sandbox: { mode: 'restricted', allowWrite: [] }
};
