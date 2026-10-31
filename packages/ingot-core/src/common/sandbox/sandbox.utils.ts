import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import {
    APPROVAL_INFO, APPROVAL_MODES, AUTO_REVIEW_SYSTEM, AUTO_REVIEW_TEXT, COMMAND_SEPARATOR, DEFAULT_PRESET, FIND_WRITE_FLAGS, LOCAL_HOSTS, NETWORK_BARE_PROGRAMS,
    NETWORK_PROGRAMS, NETWORK_SUBCOMMANDS, POLICY_FILE, PRESET_KEY, READ_ONLY_GIT, READ_ONLY_PROGRAMS, SAFE_OUTSIDE_PREFIXES, SANDBOX_INFO, SANDBOX_MODES, SANDBOX_REASON,
    WRITE_PROGRAMS
} from './sandbox.consts';
import type {
    ApprovalMode, GateDecision, RiskAssessment, RiskModel, SandboxCheck, SandboxMode, SandboxPreset, ToolCallLike, ToolIntent
} from './sandbox.types';

const NO_INTENT: ToolIntent = { writes: false, outsideWrite: false, network: false, protectedPath: false };
const JSON_INDENT = 2;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The preset in `.ingot/policy.json` text; a missing file, bad JSON or unknown values fall back to the default. */
export const parsePreset = (text: string | undefined): SandboxPreset => {
    if (!text?.trim()) {
        return DEFAULT_PRESET;
    }
    const errors: ParseError[] = [];
    const root: unknown = parse(text, errors, { allowTrailingComma: true });
    const raw = isObject(root) ? root[PRESET_KEY] : undefined;
    if (!isObject(raw)) {
        return DEFAULT_PRESET;
    }
    const sandbox = SANDBOX_MODES.find(mode => mode === raw.sandbox) ?? DEFAULT_PRESET.sandbox;
    const approvals = APPROVAL_MODES.find(mode => mode === raw.approvals) ?? DEFAULT_PRESET.approvals;
    return { sandbox, approvals, network: typeof raw.network === 'boolean' ? raw.network : DEFAULT_PRESET.network };
};

/** `.ingot/policy.json` text with the preset set; other keys and comments stay as they were. */
export const withPreset = (text: string | undefined, preset: SandboxPreset): string => {
    const value = { sandbox: preset.sandbox, approvals: preset.approvals, network: preset.network };
    const base = text?.trim() && isObject(parse(text, [], { allowTrailingComma: true })) ? text : '{}';
    const edits = modify(base, [PRESET_KEY], value, { formattingOptions: { insertSpaces: true, tabSize: JSON_INDENT, eol: '\n' } });
    const next = applyEdits(base, edits);
    return next.endsWith('\n') ? next : `${next}\n`;
};

export const presetLabel = (preset: SandboxPreset): string => `${SANDBOX_INFO[preset.sandbox].short} · ${APPROVAL_INFO[preset.approvals].short}`;

export const presetTitle = (preset: SandboxPreset): string => {
    const network = preset.sandbox === 'workspace-write' ? (preset.network ? ', network on' : ', network off') : '';
    return `Sandbox: ${SANDBOX_INFO[preset.sandbox].label}${network}. Approvals: ${APPROVAL_INFO[preset.approvals].label}.`;
};

const normalize = (path: string): string => {
    const parts: string[] = [];
    for (const segment of path.split('/')) {
        if (!segment || segment === '.') {
            continue;
        }
        if (segment === '..') {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    return `/${parts.join('/')}`;
};

const unquote = (raw: string): string => raw.replace(/^["']|["']$/g, '');

/** Absolute POSIX path of a command argument; `~` needs `home` (without it the path counts as outside). */
export const resolvePath = (raw: string, cwd: string, home?: string): string | undefined => {
    const path = unquote(raw.trim());
    if (path === '~' || path.startsWith('~/')) {
        return home ? normalize(`${home}/${path.slice(1)}`) : undefined;
    }
    return normalize(path.startsWith('/') ? path : `${cwd}/${path}`);
};

export const isInside = (path: string, root: string): boolean => {
    const base = normalize(root);
    return path === base || path.startsWith(`${base}/`);
};

const isSafeOutside = (path: string): boolean => SAFE_OUTSIDE_PREFIXES.some(prefix => path === prefix.replace(/\/$/, '') || path.startsWith(prefix));

const isPolicyPath = (path: string, root: string): boolean => normalize(path) === normalize(`${root}/${POLICY_FILE}`);

const tokenize = (part: string): string[] => part.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

const basename = (program: string): string => program.split('/').pop() ?? program;

/** Redirect targets in one command part (`> out.txt`, `2>> log`, `&> file`), ignoring quoted text and `>&1`. */
const redirectTargets = (part: string): string[] => {
    const bare = part.replace(/"[^"]*"|'[^']*'/g, '""');
    return [...bare.matchAll(/(?:\d?>>?|&>)\s*([^\s;&|]+)/g)].map(match => match[1]).filter(target => !target.startsWith('&'));
};

const isReadOnlyPart = (program: string, sub: string | undefined, args: readonly string[]): boolean => {
    if (program === 'git') {
        return !!sub && READ_ONLY_GIT.includes(sub) && !(sub === 'branch' && args.some(arg => /^-[dDmM]$|^--(delete|move)/.test(arg)));
    }
    if (program === 'find') {
        return !args.some(arg => FIND_WRITE_FLAGS.includes(arg));
    }
    return READ_ONLY_PROGRAMS.includes(program);
};

/** What a shell command line would do: each `&&` / `|` / `;` part is checked on its own. */
export const commandIntent = (command: string, root: string, cwd: string = root, home?: string): ToolIntent => {
    let writes = false;
    let outsideWrite = false;
    let network = false;
    let protectedPath = false;
    for (const part of command.split(COMMAND_SEPARATOR).map(p => p.trim()).filter(Boolean)) {
        const tokens = tokenize(part);
        while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
            tokens.shift();
        }
        if (tokens[0] === 'sudo') {
            outsideWrite = true;
            tokens.shift();
        }
        if (!tokens.length) {
            continue;
        }
        const program = basename(unquote(tokens[0]));
        const args = tokens.slice(1);
        const sub = args.find(arg => !arg.startsWith('-'));
        if (NETWORK_PROGRAMS.includes(program) || (sub !== undefined && (NETWORK_SUBCOMMANDS[program] ?? []).includes(sub)) || (NETWORK_BARE_PROGRAMS.includes(program) && sub === undefined)) {
            network = true;
        }
        const redirects = redirectTargets(part).map(target => resolvePath(target, cwd, home));
        const named = WRITE_PROGRAMS.includes(program) ? args.filter(arg => !arg.startsWith('-')).map(arg => resolvePath(arg, cwd, home)) : [];
        const targets = [...redirects, ...named];
        if (!isReadOnlyPart(program, sub, args) || redirects.some(target => !target || !isSafeOutside(target))) {
            writes = true;
        }
        for (const target of targets) {
            if (!target || (!isInside(target, root) && !isSafeOutside(target))) {
                outsideWrite = true;
            } else if (isPolicyPath(target, root)) {
                protectedPath = true;
            }
        }
    }
    if (!isInside(normalize(cwd), root) && writes) {
        outsideWrite = true;
    }
    return { writes, outsideWrite, network, protectedPath };
};

const str = (value: unknown): string => typeof value === 'string' ? value : '';

const isLocalUrl = (url: string): boolean => {
    const host = /^[a-z]+:\/\/([^/:?#]+|\[[^\]]+\])/i.exec(url.trim())?.[1]?.toLowerCase();
    return !!host && LOCAL_HOSTS.includes(host);
};

const NETWORK_GIT_OPS = ['push', 'pull', 'fetch', 'clone'];
const READ_GIT_OPS = ['status', 'diff', 'log'];

/** What a built-in tool call would do; undefined when the sandbox has no say (reads, MCP tools with their own approvals). */
export const toolIntent = (call: ToolCallLike, builtinServer: string, root: string, home?: string): ToolIntent | undefined => {
    if (call.server !== builtinServer) {
        return undefined;
    }
    const a = call.args;
    switch (call.tool) {
        case 'git': {
            const op = str(a.op);
            if (READ_GIT_OPS.includes(op)) {
                return undefined;
            }
            return { ...NO_INTENT, writes: true, network: NETWORK_GIT_OPS.includes(op) };
        }
        case 'run': {
            const cwd = str(a.cwd).trim() ? resolvePath(str(a.cwd), root, home) : root;
            return cwd ? commandIntent(str(a.command), root, cwd, home) : { ...commandIntent(str(a.command), root, root, home), outsideWrite: true };
        }
        case 'delete': return { ...NO_INTENT, writes: true, protectedPath: isPolicyPath(`${root}/${str(a.path)}`, root) };
        case 'process_stop': return { ...NO_INTENT, writes: true };
        case 'web_search': case 'web_fetch': return { ...NO_INTENT, network: true };
        case 'browser_open': return isLocalUrl(str(a.url)) ? undefined : { ...NO_INTENT, network: true };
        case 'create_library': {
            const target = resolvePath(str(a.path) || '.', root, home);
            return { ...NO_INTENT, writes: true, outsideWrite: !target || !isInside(target, root) };
        }
        default: return undefined;
    }
};

/** Agent file edits (always project-relative paths). */
export const editIntent = (paths: readonly string[], root: string): ToolIntent => ({
    ...NO_INTENT, writes: paths.length > 0, protectedPath: paths.some(path => isPolicyPath(`${root}/${path}`, root))
});

/** Whether an action stays in the preset's sandbox, and why not. */
export const checkSandbox = (preset: SandboxPreset, intent: ToolIntent): SandboxCheck => {
    const reasons: string[] = [];
    if (intent.protectedPath) {
        reasons.push(SANDBOX_REASON.policy);
    }
    if (preset.sandbox === 'read-only') {
        if (intent.outsideWrite) {
            reasons.push(SANDBOX_REASON.outside);
        } else if (intent.writes) {
            reasons.push(SANDBOX_REASON.readOnly);
        }
        if (intent.network) {
            reasons.push(SANDBOX_REASON.network);
        }
    } else if (preset.sandbox === 'workspace-write') {
        if (intent.outsideWrite) {
            reasons.push(SANDBOX_REASON.outside);
        }
        if (intent.network && !preset.network) {
            reasons.push(SANDBOX_REASON.network);
        }
    }
    return { verdict: reasons.length ? 'outside' : 'inside', reasons };
};

/**
 * What the agent does with an action. Inside the sandbox, `on-request` keeps the usual approval settings (`cardRequired`),
 * `never` runs it, `auto-review` runs it unless the settings want a card (then the reviewer decides). Outside the sandbox,
 * `on-request` always asks, `never` refuses, `auto-review` asks the reviewer.
 */
export const gateDecision = (approvals: ApprovalMode, check: SandboxCheck, cardRequired: boolean): GateDecision => {
    const outside = check.verdict === 'outside';
    switch (approvals) {
        case 'never': return outside ? 'refuse' : 'run';
        case 'auto-review': return outside || cardRequired ? 'review' : 'run';
        default: return outside || cardRequired ? 'ask' : 'run';
    }
};

/** Commands inside a sandbox without network get proxy settings that block remote hosts. */
export const blocksNetwork = (preset: SandboxPreset): boolean => preset.sandbox === 'read-only' || (preset.sandbox === 'workspace-write' && !preset.network);

export const sandboxNote = (check: SandboxCheck): string => `Outside the sandbox: ${check.reasons.join(', ')}`;

/** Tool result when `never` refuses an action. */
export const refusalText = (preset: SandboxPreset, check: SandboxCheck, action: string): string =>
    `Blocked by the Ingot sandbox (${presetTitle(preset)}): ${action} ${check.reasons.join(' and ')}. Approvals are set to Never ask, so it was not run. Do not retry it; do the work inside the sandbox or tell the user what you need.`;

/** `{"risk":"low","reason":"…"}` (or a bare low / high) from the reviewer's reply; undefined when unclear. */
export const parseRisk = (text: string): { risk: 'low' | 'high'; reason: string } | undefined => {
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (json) {
        try {
            const value: unknown = JSON.parse(json);
            if (isObject(value) && (value.risk === 'low' || value.risk === 'high')) {
                return { risk: value.risk, reason: str(value.reason).trim() };
            }
        } catch {
            // Not JSON: look for a bare word below.
        }
    }
    const word = /\b(low|high)\b/i.exec(text)?.[1]?.toLowerCase();
    return word === 'low' || word === 'high' ? { risk: word, reason: '' } : undefined;
};

export interface RiskBudget {
    /** Checks left for this chat; 0 means auto-review hands every action to the user. */
    readonly remaining: number;
    readonly maxTokens: number;
    readonly maxActionChars: number;
}

/** Asks the reviewer model about one action. No budget, no answer or an unclear one count as high risk. */
export const assessRisk = async (model: RiskModel, action: string, check: SandboxCheck, preset: SandboxPreset, budget: RiskBudget): Promise<RiskAssessment> => {
    if (budget.remaining <= 0) {
        return { risk: 'high', reason: AUTO_REVIEW_TEXT.budget, source: 'budget' };
    }
    const user = [
        `Action: ${action.slice(0, budget.maxActionChars)}`,
        `Sandbox: ${presetTitle(preset)}`,
        check.reasons.length ? `Why it was flagged: ${check.reasons.join(', ')}` : 'It stays inside the sandbox, but the user\'s settings ask before running it.'
    ].join('\n');
    try {
        const parsed = parseRisk(await model.complete(AUTO_REVIEW_SYSTEM, user, budget.maxTokens));
        return parsed
            ? { risk: parsed.risk, reason: parsed.reason || (parsed.risk === 'low' ? AUTO_REVIEW_TEXT.approved : AUTO_REVIEW_TEXT.flagged), source: 'model' }
            : { risk: 'high', reason: AUTO_REVIEW_TEXT.unparsed, source: 'model' };
    } catch {
        return { risk: 'high', reason: AUTO_REVIEW_TEXT.error, source: 'error' };
    }
};

export const isSandboxMode = (value: unknown): value is SandboxMode => SANDBOX_MODES.some(mode => mode === value);
export const isApprovalMode = (value: unknown): value is ApprovalMode => APPROVAL_MODES.some(mode => mode === value);
