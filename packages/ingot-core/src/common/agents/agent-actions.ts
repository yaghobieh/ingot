/**
 * IDEA-109: agent actions that need the user's approval (git writes, terminal commands, web search / fetch,
 * MCP tool calls, file deletes) and Ingot's built-in agent tools (`<<<TOOL ingot/<tool>` blocks).
 */
import type { GitOperation } from '../git/git-ops';
import type { AgentToolCall } from './agent-protocol';
import { describeTarget, toTarget } from '../browser-tool/browser-tool.utils';
import { CODE_TOOLS, CODE_TOOLS_HINT } from './code-tools.consts';
import { isCodeTool } from './code-tools';

export const BUILTIN_TOOL_SERVER = 'ingot';

export type ApprovalKind = 'git' | 'terminal' | 'web' | 'browser' | 'mcp' | 'delete';
export type ApprovalDecision = 'run' | 'skip' | 'always';

export const APPROVAL_KINDS: readonly ApprovalKind[] = ['git', 'terminal', 'web', 'browser', 'mcp', 'delete'];
export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
    git: 'Git actions', terminal: 'Terminal commands', web: 'Web search and fetch', browser: 'Browser actions', mcp: 'MCP tool calls', delete: 'File deletes'
};

export const APPROVAL_PREFS = {
    /** Git writes (commit, push, reset, rebase, tag…) wait for Run. Off: they run without the card. */
    gitRequireApproval: 'ingot.agent.git.requireApproval',
    /** "Always Run" choices: project root path → action kinds that run without asking. */
    alwaysRun: 'ingot.agent.approvals.alwaysRun',
    /** IDEA-131: "Always Run" for terminal commands is per command: project root path → exact commands. */
    alwaysRunCommands: 'ingot.agent.approvals.alwaysRunCommands'
} as const;

export type AlwaysRunMap = Record<string, readonly ApprovalKind[]>;
export type AlwaysRunCommands = Record<string, readonly string[]>;

/** What the approval card shows: "<label>: <detail>". */
export interface AgentAction {
    readonly kind: ApprovalKind;
    readonly label: string;
    readonly detail: string;
    /** IDEA-131: terminal commands are remembered one by one for "Always Run". */
    readonly command?: string;
}

export interface PendingApproval extends AgentAction {
    readonly id: string;
}

export const BUILTIN_TOOLS = [
    { name: 'git', description: 'Run a git action in the project. Arguments: {"op": "status" | "diff" | "log" | "add" | "commit" | "push" | "reset" | "rebase" | "tag" | "branch" | "checkout", "message"?, "paths"?, "remote"?, "branch"?, "ref"?, "mode"?: "soft" | "mixed" | "hard", "onto"?, "name"?}. Reads run at once; writes wait for the user\'s approval.' },
    { name: 'run', description: 'Run a shell command in the project root (compilers, tests, builds, package scripts). Arguments: {"command": "npm test", "background"?: true}. Foreground (default) waits for the exit code and output; a command still running after the timeout keeps running in the background. Use "background": true for dev servers and watchers: you get a process id. Waits for the user\'s approval.' },
    { name: 'scripts', description: 'List the project\'s package.json scripts and its package manager (npm, pnpm, yarn or bun). No arguments. Runs at once.' },
    { name: 'run_script', description: 'Run a package.json script with the project\'s package manager. Arguments: {"script": "dev", "background"?: true}. Waits for the user\'s approval.' },
    { name: 'processes', description: 'List running and recent processes (id, status, command, uptime, port). No arguments. Runs at once.' },
    { name: 'process_output', description: 'Read the latest output of a process. Arguments: {"id": "p3"}. Runs at once.' },
    { name: 'process_stop', description: 'Stop a running process and its children. Arguments: {"id": "p3"}. Processes the user started wait for approval.' },
    { name: 'web_search', description: 'Search the web. Arguments: {"query": "…"}. Waits for the user\'s approval.' },
    { name: 'web_fetch', description: 'Fetch a web page as text. Arguments: {"url": "https://…"}. Waits for the user\'s approval.' },
    { name: 'browser_open', description: 'Open a URL in Ingot\'s browser panel (the user sees it) and get the page: title, interactive elements with refs, and text. Arguments: {"url": "http://localhost:5173"}. Waits for the user\'s approval.' },
    { name: 'browser_read', description: 'Read the current page again: interactive elements with refs and the visible text. No arguments.' },
    { name: 'browser_click', description: 'Click an element. Arguments: {"ref": 3} from the last read, or {"selector": "#submit"}, or {"text": "Sign in"}. Waits for the user\'s approval.' },
    { name: 'browser_type', description: 'Type into a field. Arguments: {"ref": 2} or {"selector": "#email"} or {"label": "Email"}, plus {"text": "…", "submit"?: true} (submit presses Enter). Waits for the user\'s approval.' },
    { name: 'browser_scroll', description: 'Scroll the page. Arguments: {"direction": "down" | "up" | "top" | "bottom"}.' },
    { name: 'browser_back', description: 'Go back one page. No arguments.' },
    { name: 'browser_screenshot', description: 'Take a screenshot of the browser panel (shown to the user; sent to you when the model reads images). No arguments.' },
    { name: 'delete', description: 'Delete a file in the project. Arguments: {"path": "relative/path"}. Waits for the user\'s approval.' },
    ...CODE_TOOLS,
    { name: 'ask_user', description: 'Ask the user a clarifying question and wait for the answer before continuing. Arguments: {"question": "…", "options"?: ["a", "b"]}. The user can also type their own answer. Runs at once and pauses the run.' },
    { name: 'create_library', description: 'Create a new React + Vite client and Node + Express server for a library (books, authors, members, loans, borrow and return) in a new empty folder. Arguments: {"path": "/absolute/or/relative", "react": "feature-folders" | "atomic", "node": "layered" | "modular", "reactExample"?: "/path/to/example", "nodeExample"?: "/path/to/example"}. Named presets or an example folder. If the layout is unclear, call ask_user first. Runs at once; each file shows up for Accept or Reject.' },
    { name: 'open_workspace', description: 'Open a folder as the Ingot workspace. Arguments: {"path": "/absolute/path"}. Waits for the user\'s approval. Call it last, after install, tests and git.' }
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
    // IDEA-259: language-server reads run at once; rename and organize imports land as reviewable edits.
    if (isCodeTool(call.tool)) {
        return undefined;
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
        case 'run': {
            const command = str(a.command).trim();
            const cwd = str(a.cwd).trim();
            return { kind: 'terminal', label: a.background === true ? 'Run in background' : 'Run command', detail: cwd ? `${command} (${cwd})` : command, command };
        }
        case 'scripts': case 'processes': case 'process_output': return undefined;
        // IDEA-186: read-only project tools run at once.
        case 'read_file': case 'list_dir': case 'glob': case 'grep': case 'ask_user': case 'create_library': return undefined;
        case 'open_workspace': return { kind: 'terminal', label: 'Open folder', detail: str(a.path), command: str(a.path) };
        case 'process_stop': return { kind: 'terminal', label: 'Stop process', detail: str(a.id) };
        case 'web_search': return { kind: 'web', label: 'Search web', detail: str(a.query) };
        case 'web_fetch': return { kind: 'web', label: 'Fetch', detail: str(a.url) };
        case 'delete': return { kind: 'delete', label: 'Delete file', detail: str(a.path) };
        case 'browser_open': return { kind: 'browser', label: 'Open page', detail: str(a.url) };
        case 'browser_read': return { kind: 'browser', label: 'Read page', detail: '' };
        case 'browser_click': return { kind: 'browser', label: 'Click', detail: describeTarget(toTarget(a, 'click')) };
        case 'browser_type': return { kind: 'browser', label: 'Type', detail: `"${str(a.text)}" into ${describeTarget(toTarget(a, 'type'))}${a.submit === true ? ' and submit' : ''}` };
        case 'browser_scroll': return { kind: 'browser', label: 'Scroll', detail: str(a.direction) || 'down' };
        case 'browser_back': return { kind: 'browser', label: 'Go back', detail: '' };
        case 'browser_screenshot': return { kind: 'browser', label: 'Screenshot', detail: '' };
        default: return { kind: 'mcp', label: capitalize(call.tool), detail: '' };
    }
};

/** Whether an action waits for the card, given the settings. */
export const needsApproval = (action: AgentAction, project: string, alwaysRun: AlwaysRunMap, gitRequireApproval: boolean, commands: AlwaysRunCommands = {}): boolean => {
    if (action.kind === 'git' && !gitRequireApproval) {
        return false;
    }
    if (action.command && (commands[project] ?? []).includes(action.command)) {
        return false;
    }
    return !(alwaysRun[project] ?? []).includes(action.kind);
};

/** IDEA-131: adds (or revokes) one command in the per-command "Always Run" list. */
export const updateAlwaysRunCommands = (map: AlwaysRunCommands | undefined, project: string, command: string, remove = false): AlwaysRunCommands => {
    const current = (map?.[project] ?? []).filter(c => c !== command);
    const list = remove ? current : [...current, command];
    const next: Record<string, readonly string[]> = { ...(map ?? {}) };
    if (list.length) {
        next[project] = list;
    } else {
        delete next[project];
    }
    return next;
};

export const toAlwaysRunCommands = (value: unknown): AlwaysRunCommands => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const out: Record<string, readonly string[]> = {};
    for (const [project, commands] of Object.entries(value as Record<string, unknown>)) {
        const valid = list(commands).map(c => c.trim()).filter(Boolean);
        if (valid.length) {
            out[project] = valid;
        }
    }
    return out;
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

/** IDEA-133: which built-in tools Settings › Tools › Agent tools turns on. */
export interface BuiltinToolSwitches {
    readonly terminal: boolean;
    readonly browser: boolean;
}

/** Tools that start commands (listing scripts and reading processes stay available). */
export const COMMAND_TOOLS: readonly string[] = ['run', 'run_script'];

export const builtinToolEnabled = (name: string, on: BuiltinToolSwitches): boolean =>
    COMMAND_TOOLS.includes(name) ? on.terminal : name.startsWith('browser_') ? on.browser : true;

/** The system-prompt section for Ingot's built-in tools. */
export const builtinToolProtocol = (on: BuiltinToolSwitches = { terminal: true, browser: true }): string => [
    'Ingot tools (same block format, server "ingot"):',
    ...BUILTIN_TOOLS.filter(t => builtinToolEnabled(t.name, on)).map(t => `- ${BUILTIN_TOOL_SERVER}/${t.name}: ${t.description}`),
    'If the user skips an action you get its reason as the tool result; adapt instead of retrying.',
    CODE_TOOLS_HINT,
    'New React and Node library: if the user asks to create one, call ingot/ask_user when the React structure (feature-folders or atomic) or the Node structure (layered or modular) or the folder path is unclear. An example folder can be passed as reactExample or nodeExample.',
    'Then ingot/create_library. Then ingot/run npm install, npm test and npm run build with {"cwd": "<that path>"}. If tests fail, fix the files and rerun npm test, up to 3 times.',
    'Then ingot/ask_user whether to git init on branch feature/library and make the first commit. If they agree, ingot/run those git commands with that cwd.',
    'Last, ingot/open_workspace with the same path. Do not hand-write the project when create_library can do it.'
].join('\n');
