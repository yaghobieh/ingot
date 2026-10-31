import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { BUILTIN_TOOL_SERVER, type AgentAction } from '../agents/agent-actions';
import type { AgentToolCall } from '../agents/agent-protocol';
import { globMatcher } from '../agents/workspace-tools';
import {
    BUILTIN_READ_ONLY, COMMAND_SEPARATORS, DEFAULT_POLICY, LOCAL_HOSTS, MCP_ALLOW_SEPARATOR, POLICY_FILE, POLICY_REASON, REGEX_SPECIAL_CHARS, SAFE_OUTSIDE_PREFIXES, SANDBOX_CARD, SANDBOX_EXEC,
    SANDBOX_HOME_CACHES, SANDBOX_TEMP_DIRS, WEB_SEARCH_HOST
} from './agent-policy.consts';
import type {
    AgentPolicy, NetworkDefault, PolicyContext, PolicyDecision, PolicyLoad, PolicyOrigin, SandboxMode, SandboxSpec
} from './agent-policy.types';

const DEFAULT: PolicyDecision = { verdict: 'default' };
const OUTSIDE_SHOWN = 3;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const stringList = (value: unknown, field: string, errors: string[]): readonly string[] => {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        errors.push(`"${field}" must be a list of strings.`);
        return [];
    }
    return value.map(item => item.trim()).filter(Boolean);
};

const section = (value: unknown, field: string, errors: string[]): Record<string, unknown> => {
    if (value === undefined) {
        return {};
    }
    if (!isRecord(value)) {
        errors.push(`"${field}" must be an object.`);
        return {};
    }
    return value;
};

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T, field: string, errors: string[]): T => {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
        errors.push(`"${field}" must be ${options.map(o => `"${o}"`).join(' or ')}.`);
        return fallback;
    }
    return value as T;
};

/** Reads `.ingot/policy.json` (comments allowed). Wrong fields fall back to the defaults and are reported. */
export const parsePolicy = (text: string | undefined): Omit<PolicyLoad, 'exists'> => {
    if (!text?.trim()) {
        return { policy: DEFAULT_POLICY, errors: [] };
    }
    const parseErrors: ParseError[] = [];
    const raw: unknown = parse(text, parseErrors, { allowTrailingComma: true });
    if (parseErrors.length || !isRecord(raw)) {
        const first = parseErrors[0];
        return { policy: DEFAULT_POLICY, errors: [first ? `${printParseErrorCode(first.error)} at offset ${first.offset}.` : 'The file must hold one JSON object.'] };
    }
    const errors: string[] = [];
    const commands = section(raw.commands, 'commands', errors);
    const paths = section(raw.paths, 'paths', errors);
    const network = section(raw.network, 'network', errors);
    const sandbox = section(raw.sandbox, 'sandbox', errors);
    const policy: AgentPolicy = {
        commands: { allow: stringList(commands.allow, 'commands.allow', errors), deny: stringList(commands.deny, 'commands.deny', errors) },
        paths: { writable: stringList(paths.writable, 'paths.writable', errors), readOnly: stringList(paths.readOnly, 'paths.readOnly', errors) },
        network: {
            default: oneOf<NetworkDefault>(network.default, ['allow', 'deny'], DEFAULT_POLICY.network.default, 'network.default', errors),
            allow: stringList(network.allow, 'network.allow', errors),
            deny: stringList(network.deny, 'network.deny', errors)
        },
        sandbox: {
            mode: oneOf<SandboxMode>(sandbox.mode, ['restricted', 'off'], DEFAULT_POLICY.sandbox.mode, 'sandbox.mode', errors),
            allowWrite: stringList(sandbox.allowWrite, 'sandbox.allowWrite', errors)
        }
    };
    return { policy, errors };
};

/** Shell words of one command part, quotes removed (`'a b'` and `"a b"` stay one word). */
export const tokenize = (segment: string): string[] => {
    const words: string[] = [];
    let word = '';
    let quote: '"' | '\'' | undefined;
    let started = false;
    for (let i = 0; i < segment.length; i++) {
        const ch = segment[i];
        if (quote) {
            if (ch === quote) {
                quote = undefined;
            } else if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
                word += segment[++i];
            } else {
                word += ch;
            }
        } else if (ch === '"' || ch === '\'') {
            quote = ch;
            started = true;
        } else if (ch === '\\' && i + 1 < segment.length) {
            word += segment[++i];
            started = true;
        } else if (/\s/.test(ch)) {
            if (started || word) {
                words.push(word);
            }
            word = '';
            started = false;
        } else {
            word += ch;
            started = true;
        }
    }
    if (started || word) {
        words.push(word);
    }
    return words;
};

/** Splits a command line on `&&`, `||`, `;`, `|` and new lines outside quotes; `$(…)` and backtick bodies become parts too. */
export const splitCommand = (command: string): string[] => {
    const parts: string[] = [];
    let current = '';
    let quote: '"' | '\'' | undefined;
    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (quote) {
            current += ch;
            if (ch === quote) {
                quote = undefined;
            }
            continue;
        }
        if (ch === '"' || ch === '\'') {
            quote = ch;
            current += ch;
            continue;
        }
        const separator = COMMAND_SEPARATORS.find(sep => command.startsWith(sep, i));
        if (separator) {
            parts.push(current);
            current = '';
            i += separator.length - 1;
            continue;
        }
        current += ch;
    }
    parts.push(current);
    const inner = [...command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map(m => m[1] ?? m[2]);
    return [...parts, ...inner.flatMap(splitCommand)].map(p => p.trim()).filter(Boolean);
};

const hasSubstitution = (command: string): boolean => /\$\(|`/.test(command);

/** One part as it is matched: env assignments dropped, the program's folder dropped, spaces collapsed. */
const normalizePart = (part: string): string => {
    const words = tokenize(part);
    while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
        words.shift();
    }
    if (words.length) {
        words[0] = words[0].split('/').pop() ?? words[0];
    }
    return words.join(' ');
};

const escapeRegExp = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

const patternSource = (pattern: string): string =>
    escapeRegExp(pattern.trim().replace(/\s+/g, ' ')).replace(/\*/g, '.*').replace(/\?/g, '.');

const isMultiPart = (pattern: string): boolean => COMMAND_SEPARATORS.some(sep => sep !== '\n' && pattern.includes(sep));

/** `git push` matches `git push origin main`: a pattern matches the whole part or its leading words. */
export const matchesCommand = (pattern: string, part: string): boolean =>
    new RegExp(`^${patternSource(pattern)}(?:\\s.*)?$`).test(normalizePart(part));

const deniedBy = (policy: AgentPolicy, command: string, parts: readonly string[]): string | undefined => {
    const whole = command.replace(/\s+/g, ' ');
    return policy.commands.deny.find(pattern => isMultiPart(pattern)
        ? new RegExp(patternSource(pattern)).test(whole)
        : parts.some(part => matchesCommand(pattern, part)));
};

const allowedBy = (policy: AgentPolicy, command: string, parts: readonly string[]): string | undefined => {
    if (!policy.commands.allow.length || hasSubstitution(command)) {
        return undefined;
    }
    const whole = command.trim().replace(/\s+/g, ' ');
    const multi = policy.commands.allow.find(pattern => isMultiPart(pattern) && new RegExp(`^${patternSource(pattern)}$`).test(whole));
    if (multi) {
        return multi;
    }
    const used = parts.map(part => policy.commands.allow.find(pattern => !isMultiPart(pattern) && matchesCommand(pattern, part)));
    return used.every(Boolean) ? [...new Set(used)].join('", "') : undefined;
};

const normalizePath = (path: string): string => {
    const out: string[] = [];
    for (const segment of path.split('/')) {
        if (!segment || segment === '.') {
            continue;
        }
        if (segment === '..') {
            out.pop();
        } else {
            out.push(segment);
        }
    }
    return `/${out.join('/')}`;
};

export const resolvePath = (base: string, path: string): string => normalizePath(path.startsWith('/') ? path : `${base}/${path}`);

export const isInside = (dir: string, path: string): boolean => {
    const folder = normalizePath(dir);
    return path === folder || path.startsWith(folder === '/' ? '/' : `${folder}/`);
};

const expandHome = (word: string, home: string | undefined): string | undefined => {
    const homeRef = /^~(?=\/|$)|^\$HOME(?=\/|$)|^\$\{HOME\}(?=\/|$)/.exec(word);
    if (!homeRef) {
        return word;
    }
    return home ? `${home}${word.slice(homeRef[0].length)}` : undefined;
};

const pathCandidate = (word: string): string | undefined => {
    const target = word.replace(/^\d*[<>]+&?/, '');
    const value = /^-{1,2}[\w-]+=/.test(target) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(target) ? target.slice(target.indexOf('=') + 1) : target;
    if (!value || value.includes('://') || /^\d+$/.test(value)) {
        return undefined;
    }
    const escapes = value === '..' || value.startsWith('../') || value.includes('/../') || value.endsWith('/..');
    return value.startsWith('/') || value.startsWith('~') || /^\$\{?HOME\b/.test(value) || escapes ? value : undefined;
};

/** Paths a command names outside the project (and outside the safe system folders), as written. */
export const outsideReferences = (command: string, context: PolicyContext): string[] => {
    const base = context.cwd ?? context.root;
    const found = new Set<string>();
    for (const part of splitCommand(command)) {
        const words = tokenize(part);
        if (words.length === 1 && words[0] === 'cd') {
            found.add('cd ~');
        }
        for (const word of words) {
            const candidate = pathCandidate(word);
            if (!candidate) {
                continue;
            }
            const expanded = expandHome(candidate, context.home);
            if (expanded === undefined) {
                found.add(candidate);
                continue;
            }
            const absolute = resolvePath(base, expanded);
            const inside = isInside(context.root, absolute) || (!!context.cwd && isInside(context.cwd, absolute));
            const safe = SAFE_OUTSIDE_PREFIXES.some(prefix => absolute === prefix.replace(/\/$/, '') || absolute.startsWith(prefix));
            if (!inside && !safe) {
                found.add(candidate);
            }
        }
    }
    return [...found];
};

export const urlsIn = (command: string): string[] => [...command.matchAll(/\bhttps?:\/\/[^\s'"|;&)<>]+/gi)].map(m => m[0]);

export const hostOf = (url: string): string | undefined => {
    try {
        return new URL(url).hostname.toLowerCase() || undefined;
    } catch {
        return undefined;
    }
};

/** `github.com` matches it and its subdomains; `*.example.com` only subdomains; `*` every host. */
export const matchesHost = (pattern: string, host: string): boolean => {
    const p = pattern.trim().toLowerCase();
    const h = host.toLowerCase();
    if (p === '*') {
        return true;
    }
    if (p.startsWith('*.')) {
        return h.endsWith(p.slice(1));
    }
    return h === p || h.endsWith(`.${p}`);
};

/** How a refusal names the rule that denied it, inside its closing `(…)`. */
export const policyRuleRef = {
    commandDeny: (pattern: string): string => `commands.deny "${pattern}"`,
    networkDeny: (pattern: string): string => `network.deny "${pattern}"`,
    networkDefaultDeny: (): string => 'network.default is "deny"',
    readOnly: (pattern: string): string => `matches "${pattern}"`
};

export const checkHost = (policy: AgentPolicy, host: string): PolicyDecision => {
    const local = LOCAL_HOSTS.includes(host);
    const denied = policy.network.deny.find(pattern => (pattern.trim() !== '*' || !local) && matchesHost(pattern, host));
    if (denied) {
        return { verdict: 'deny', reason: `${POLICY_REASON.deniedHost} "${host}" (${policyRuleRef.networkDeny(denied)})` };
    }
    if (local || policy.network.allow.some(pattern => matchesHost(pattern, host))) {
        return DEFAULT;
    }
    return policy.network.default === 'deny' ? { verdict: 'deny', reason: `${POLICY_REASON.deniedHost} "${host}" (${policyRuleRef.networkDefaultDeny()})` } : DEFAULT;
};

export const checkUrl = (policy: AgentPolicy, url: string): PolicyDecision => {
    const host = hostOf(url);
    return host ? checkHost(policy, host) : DEFAULT;
};

/** Order: denied commands and hosts, then anything outside the project (asks), then the allow list. */
export const checkCommand = (policy: AgentPolicy, command: string, context: PolicyContext): PolicyDecision => {
    if (!command.trim()) {
        return DEFAULT;
    }
    const parts = splitCommand(command);
    const denied = deniedBy(policy, command, parts);
    if (denied) {
        return { verdict: 'deny', reason: `${POLICY_REASON.deniedCommand} (${policyRuleRef.commandDeny(denied)})` };
    }
    for (const url of urlsIn(command)) {
        const host = checkUrl(policy, url);
        if (host.verdict === 'deny') {
            return host;
        }
    }
    if (policy.sandbox.mode === 'restricted') {
        const outside = outsideReferences(command, context);
        if (outside.length) {
            const shown = outside.slice(0, OUTSIDE_SHOWN).join(', ');
            return { verdict: 'ask', reason: `${POLICY_REASON.outside}: ${shown}${outside.length > OUTSIDE_SHOWN ? ` (+${outside.length - OUTSIDE_SHOWN})` : ''}` };
        }
    }
    const allowed = allowedBy(policy, command, parts);
    return allowed ? { verdict: 'allow', reason: `commands.allow "${allowed}"` } : DEFAULT;
};

const pathMatches = (pattern: string, path: string): boolean => {
    const clean = pattern.trim().replace(/^\.\/+/, '');
    return globMatcher(clean)(path) || (!/[*?]/.test(clean) && path.startsWith(`${clean.replace(/\/+$/, '')}/`));
};

/** Whether the agent may write (edit, create, delete) a project-relative path. */
export const checkWrite = (policy: AgentPolicy, path: string): PolicyDecision => {
    const clean = path.trim().replace(/^\.\/+/, '');
    const readOnly = [...BUILTIN_READ_ONLY, ...policy.paths.readOnly].find(pattern => pathMatches(pattern, clean));
    if (readOnly) {
        return { verdict: 'deny', reason: `${POLICY_REASON.readOnly} ("${clean}" ${policyRuleRef.readOnly(readOnly)})` };
    }
    if (policy.paths.writable.length && !policy.paths.writable.some(pattern => pathMatches(pattern, clean))) {
        return { verdict: 'deny', reason: `${POLICY_REASON.notWritable} "${clean}" (paths.writable: ${policy.paths.writable.join(', ')})` };
    }
    return DEFAULT;
};

const WRITE_TOOLS: readonly string[] = ['run', 'delete'];

const invalid = (load: Omit<PolicyLoad, 'exists'>): PolicyDecision => ({ verdict: 'deny', reason: `${POLICY_REASON.invalid} (${load.errors[0]})` });

/** An agent edit or new file: refused while the policy file is broken, else per `paths`. */
export const checkEdit = (load: Omit<PolicyLoad, 'exists'>, path: string): PolicyDecision =>
    load.errors.length ? invalid(load) : checkWrite(load.policy, path);

const wildcardPart = (pattern: string, value: string): boolean => {
    const body = pattern.split('*').map(part => part.replace(REGEX_SPECIAL_CHARS, '\\$&')).join('.*');
    return new RegExp(`^${body}$`, 'i').test(value);
};

/** IDEA-287: a permissions.json `mcpAllowlist` entry (`server:tool`, `*` anywhere, case-insensitive) that covers the call, if any. */
export const mcpAllowEntry = (patterns: readonly string[], server: string, tool: string): string | undefined =>
    patterns.find(pattern => {
        const at = pattern.indexOf(MCP_ALLOW_SEPARATOR);
        return at > 0 && wildcardPart(pattern.slice(0, at), server) && wildcardPart(pattern.slice(at + 1), tool);
    });

/**
 * The policy's verdict on one built-in tool call. MCP tools are left to the approval settings unless a permissions.json
 * `mcpAllowlist` entry covers them (IDEA-287); reads always are.
 */
export const checkToolCall = (load: Omit<PolicyLoad, 'exists'>, call: AgentToolCall, context: PolicyContext): PolicyDecision => {
    if (call.server !== BUILTIN_TOOL_SERVER) {
        const entry = mcpAllowEntry(load.mcpAllow ?? [], call.server, call.tool);
        return entry ? { verdict: 'allow', reason: `${POLICY_REASON.mcpAllowed} "${entry}"` } : DEFAULT;
    }
    if (load.errors.length && WRITE_TOOLS.includes(call.tool)) {
        return invalid(load);
    }
    const str = (value: unknown): string => typeof value === 'string' ? value : '';
    switch (call.tool) {
        case 'run': return checkCommand(load.policy, str(call.args.command), context);
        case 'delete': return checkEdit(load, str(call.args.path));
        case 'web_fetch': case 'browser_open': return checkUrl(load.policy, str(call.args.url));
        case 'web_search': return checkHost(load.policy, WEB_SEARCH_HOST);
        default: return DEFAULT;
    }
};

/** Writable folders and network for a command in restricted mode; undefined when the sandbox is off. */
export const sandboxSpec = (policy: AgentPolicy, context: PolicyContext): SandboxSpec | undefined => {
    if (policy.sandbox.mode === 'off') {
        return undefined;
    }
    const home = context.home;
    const extra = policy.sandbox.allowWrite
        .map(dir => expandHome(dir, home))
        .filter((dir): dir is string => !!dir)
        .map(dir => resolvePath(context.root, dir));
    const caches = home ? SANDBOX_HOME_CACHES.map(dir => `${home}/${dir}`) : [];
    const writable = [context.root, ...(context.cwd ? [context.cwd] : []), ...SANDBOX_TEMP_DIRS, ...caches, ...extra];
    return { writable: [...new Set(writable)], network: policy.network.default };
};

const quoteSbpl = (path: string): string => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A macOS sandbox profile: reads and processes as usual, writes only in the spec's folders, network per the spec. */
export const sandboxProfile = (spec: SandboxSpec): string => [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${spec.writable.map(dir => `(subpath ${quoteSbpl(dir)})`).join(' ')} (literal "/dev/null"))`,
    ...(spec.network === 'deny'
        ? ['(deny network-outbound)', '(allow network-outbound (remote ip "localhost:*"))', '(allow network-outbound (remote unix-socket))']
        : [])
].join('\n');

export interface ShellCommand {
    readonly cmd: string;
    readonly args: readonly string[];
}

/** Wraps a shell command in the OS sandbox where Ingot has one (macOS today); `applied` is false elsewhere. */
export const sandboxCommand = (shell: ShellCommand, spec: SandboxSpec, platform: string): ShellCommand & { readonly applied: boolean } =>
    platform === 'darwin'
        ? { cmd: SANDBOX_EXEC, args: ['-p', sandboxProfile(spec), shell.cmd, ...shell.args], applied: true }
        : { ...shell, applied: false };

/** IDEA-287: the file behind a refusal: a Cursor file when only it added the rule, else `.ingot/policy.json`. */
export const policySourceOf = (reason: string | undefined, origins: readonly PolicyOrigin[] | undefined): string =>
    (reason && origins?.find(origin => reason.includes(`${origin.rule})`))?.file) || POLICY_FILE;

/** The tool result the agent gets for a call the policy refused. */
export const policyBlockedText = (reason: string | undefined, source: string = POLICY_FILE): string =>
    `Blocked by ${source}: it ${reason ?? POLICY_REASON.deniedCommand}. Do not retry this; ask the user to change the policy if it is really needed.`;

/** The card for a command that reaches outside the project: it runs once, without the sandbox, if the user agrees. */
export const outsideApproval = (action: AgentAction): AgentAction => ({ ...action, label: SANDBOX_CARD.outside, once: true });

/** The card after the sandbox refused a write: run the same command again without the sandbox? */
export const sandboxRetryApproval = (command: string): AgentAction => ({ kind: 'terminal', label: SANDBOX_CARD.retry, detail: command, command, once: true });

const countLabel = (count: number, word: string): string => `${count} ${word}`;

/** Short lines for the audit log header: what the policy allows, at a glance. */
export const policySummary = (policy: AgentPolicy): string[] => [
    `Commands: ${countLabel(policy.commands.allow.length, 'allowed')}, ${countLabel(policy.commands.deny.length, 'denied')}`,
    `Writable: ${policy.paths.writable.length ? policy.paths.writable.join(', ') : 'whole project'}`,
    `Network: ${policy.network.default} by default${policy.network.deny.length ? `, ${countLabel(policy.network.deny.length, 'blocked')}` : ''}`,
    `Sandbox: ${policy.sandbox.mode}`
];
