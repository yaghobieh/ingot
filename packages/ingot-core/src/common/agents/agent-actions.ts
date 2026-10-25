/**
 * IDEA-109: agent actions that need the user's approval (git writes, terminal commands, web search / fetch,
 * MCP tool calls, file deletes) and Ingot's built-in agent tools (`<<<TOOL ingot/<tool>` blocks).
 */
import type { GitOperation } from '../git/git-ops';
import type { AgentToolCall } from './agent-protocol';

export const BUILTIN_TOOL_SERVER = 'ingot';

export type ApprovalKind = 'git' | 'terminal' | 'web' | 'mcp' | 'delete';
export type ApprovalDecision = 'run' | 'skip' | 'always';

export const APPROVAL_KINDS: readonly ApprovalKind[] = ['git', 'terminal', 'web', 'mcp', 'delete'];
export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
    git: 'Git actions', terminal: 'Terminal commands', web: 'Web search and fetch', mcp: 'MCP tool calls', delete: 'File deletes'
};

export const APPROVAL_PREFS = {
    /** Git writes (commit, push, reset, rebase, tag…) wait for Run. Off: they run without the card. */
    gitRequireApproval: 'ingot.agent.git.requireApproval',
    /** "Always Run" choices: project root path → action kinds that run without asking. */
    alwaysRun: 'ingot.agent.approvals.alwaysRun'
} as const;

export type AlwaysRunMap = Record<string, readonly ApprovalKind[]>;

/** What the approval card shows: "<label>: <detail>". */
export interface AgentAction {
    readonly kind: ApprovalKind;
    readonly label: string;
    readonly detail: string;
}

export interface PendingApproval extends AgentAction {
    readonly id: string;
}

export const BUILTIN_TOOLS = [
    { name: 'git', description: 'Run a git action in the project. Arguments: {"op": "status" | "diff" | "log" | "add" | "commit" | "push" | "reset" | "rebase" | "tag" | "branch" | "checkout", "message"?, "paths"?, "remote"?, "branch"?, "ref"?, "mode"?: "soft" | "mixed" | "hard", "onto"?, "name"?}. Reads run at once; writes wait for the user\'s approval.' },
    { name: 'run', description: 'Run a shell command in the project root and get its output. Arguments: {"command": "npm test"}. Waits for the user\'s approval.' },
    { name: 'web_search', description: 'Search the web. Arguments: {"query": "…"}. Waits for the user\'s approval.' },
    { name: 'web_fetch', description: 'Fetch a web page as text. Arguments: {"url": "https://…"}. Waits for the user\'s approval.' },
    { name: 'delete', description: 'Delete a file in the project. Arguments: {"path": "relative/path"}. Waits for the user\'s approval.' }
] as const;

const str = (value: unknown): string => typeof value === 'string' ? value : '';
const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : typeof value === 'string' && value ? [value] : [];
const firstLine = (text: string): string => text.trim().split('\n')[0].trim();

const GIT_READS = new Set(['status', 'diff', 'log']);

/** Maps an `ingot/git` call to a validated-by-construction GitOperation (the service validates refs and paths). */
export const gitOperationFor = (args: Record<string, unknown>): GitOperation => {
    const op = str(args.op);
    switch (op) {
        case 'status': return { kind: 'status' };
        case 'diff': return { kind: 'diff', ...(str(args.ref) ? { ref: str(args.ref) } : {}), ...(list(args.paths).length ? { paths: list(args.paths) } : {}) };
        case 'add': return { kind: 'add', paths: list(args.paths).length ? list(args.paths) : ['.'] };
        case 'commit': return { kind: 'commit', message: str(args.message), ...(list(args.paths).length ? { paths: list(args.paths) } : {}), amend: args.amend === true, signoff: false, noVerify: false };
        case 'push': {
            const branch = str(args.branch);
            return branch
                ? { kind: 'pushTo', remote: str(args.remote) || 'origin', localBranch: branch, remoteBranch: branch, tags: 'none', force: false, setUpstream: args.setUpstream === true }
                : { kind: 'push', setUpstream: args.setUpstream === true };
        }
        case 'reset': return { kind: 'reset', ref: str(args.ref) || 'HEAD', mode: args.mode === 'soft' || args.mode === 'hard' ? args.mode : 'mixed' };
        case 'rebase': return { kind: 'rebase', onto: str(args.onto) || str(args.ref) };
        case 'tag': return { kind: 'createTag', name: str(args.name), commit: str(args.ref) || 'HEAD', ...(str(args.message) ? { message: str(args.message) } : {}) };
        case 'branch': return { kind: 'createBranchAt', name: str(args.name) || str(args.branch), commit: str(args.ref) || 'HEAD', checkout: args.checkout === true };
        case 'checkout': return { kind: 'checkoutRevision', commit: str(args.ref) || str(args.branch) };
        default: throw new Error(`Unknown git op "${op}". Use status, diff, log, add, commit, push, reset, rebase, tag, branch or checkout.`);
    }
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The approval card text for a tool call, or undefined when it runs without asking (git reads, `log`).
 * `currentBranch` fills "Git push: <branch> → <remote>" when the call does not name a branch.
 */
export const describeAction = (call: AgentToolCall, currentBranch?: string): AgentAction | undefined => {
    if (call.server !== BUILTIN_TOOL_SERVER) {
        const args = Object.values(call.args).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
        return { kind: 'mcp', label: `${call.server}: ${call.tool}`, detail: args };
    }
    const a = call.args;
    switch (call.tool) {
        case 'git': {
            const op = str(a.op);
            if (GIT_READS.has(op)) {
                return undefined;
            }
            switch (op) {
                case 'commit': return { kind: 'git', label: 'Git commit', detail: firstLine(str(a.message)) };
                case 'push': return { kind: 'git', label: 'Git push', detail: `${str(a.branch) || currentBranch || 'HEAD'} → ${str(a.remote) || 'origin'}` };
                case 'reset': return { kind: 'git', label: 'Git reset', detail: `--${a.mode === 'soft' || a.mode === 'hard' ? a.mode : 'mixed'} ${str(a.ref) || 'HEAD'}` };
                case 'rebase': return { kind: 'git', label: 'Git rebase', detail: `onto ${str(a.onto) || str(a.ref)}` };
                case 'tag': return { kind: 'git', label: 'Git tag', detail: `${str(a.name)}${str(a.ref) ? ` at ${str(a.ref)}` : ''}` };
                case 'add': return { kind: 'git', label: 'Git add', detail: list(a.paths).join(' ') || '.' };
                default: return { kind: 'git', label: `Git ${op || 'action'}`, detail: [str(a.name), str(a.branch), str(a.ref)].filter(Boolean).join(' ') };
            }
        }
        case 'run': return { kind: 'terminal', label: 'Run command', detail: str(a.command) };
        case 'web_search': return { kind: 'web', label: 'Search web', detail: str(a.query) };
        case 'web_fetch': return { kind: 'web', label: 'Fetch', detail: str(a.url) };
        case 'delete': return { kind: 'delete', label: 'Delete file', detail: str(a.path) };
        default: return { kind: 'mcp', label: capitalize(call.tool), detail: '' };
    }
};

/** Whether an action waits for the card, given the settings. */
export const needsApproval = (action: AgentAction, project: string, alwaysRun: AlwaysRunMap, gitRequireApproval: boolean): boolean => {
    if (action.kind === 'git' && !gitRequireApproval) {
        return false;
    }
    return !(alwaysRun[project] ?? []).includes(action.kind);
};

/** Adds (or with `remove`, revokes) an "Always Run" choice; returns a new map without empty projects. */
export const updateAlwaysRun = (map: AlwaysRunMap | undefined, project: string, kind: ApprovalKind, remove = false): AlwaysRunMap => {
    const current = new Set(map?.[project] ?? []);
    if (remove) {
        current.delete(kind);
    } else {
        current.add(kind);
    }
    const next: Record<string, readonly ApprovalKind[]> = { ...(map ?? {}) };
    if (current.size) {
        next[project] = APPROVAL_KINDS.filter(k => current.has(k));
    } else {
        delete next[project];
    }
    return next;
};

/** Safe read of the preference value (settings files are user-edited). */
export const toAlwaysRunMap = (value: unknown): AlwaysRunMap => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const out: Record<string, readonly ApprovalKind[]> = {};
    for (const [project, kinds] of Object.entries(value as Record<string, unknown>)) {
        const valid = list(kinds).filter((k): k is ApprovalKind => (APPROVAL_KINDS as readonly string[]).includes(k));
        if (valid.length) {
            out[project] = valid;
        }
    }
    return out;
};

/** One-line card text, truncated with an ellipsis. */
export const actionLine = (action: AgentAction, max = 96): string => {
    const text = action.detail ? `${action.label}: ${action.detail.replace(/\s+/g, ' ').trim()}` : action.label;
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** The muted activity line above the card, e.g. "Exploring 6 files, 8 searches". */
export const activityLine = (steps: readonly { kind: string; target: string }[]): string | undefined => {
    const files = new Set<string>();
    let searches = 0;
    for (const step of steps) {
        if (step.kind === 'read' && !step.target.startsWith('rules:')) {
            step.target.split(',').map(s => s.trim()).filter(Boolean).forEach(f => files.add(f));
        } else if (step.kind === 'search' || (step.kind === 'run' && /\/(?:web_search|search)/.test(step.target))) {
            searches++;
        }
    }
    const parts = [
        files.size ? `${files.size} ${files.size === 1 ? 'file' : 'files'}` : '',
        searches ? `${searches} ${searches === 1 ? 'search' : 'searches'}` : ''
    ].filter(Boolean);
    return parts.length ? `Exploring ${parts.join(', ')}` : undefined;
};

/** Tool result the agent gets when the user skips an action. */
export const skippedResult = (action: AgentAction, reason?: string): string =>
    `The user skipped this action (${actionLine(action, 200)}). Do not retry it unless the user asks.${reason?.trim() ? ` Reason: ${reason.trim()}` : ''}`;

/** The system-prompt section for Ingot's built-in tools. */
export const builtinToolProtocol = (): string => [
    'Ingot tools (same block format, server "ingot"):',
    ...BUILTIN_TOOLS.map(t => `- ${BUILTIN_TOOL_SERVER}/${t.name}: ${t.description}`),
    'If the user skips an action you get its reason as the tool result; adapt instead of retrying.'
].join('\n');
