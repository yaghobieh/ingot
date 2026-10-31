import type { ConfigSource, McpServerConfig, ProjectCommand, ProjectRule, RuleDraft, RuleKind } from './project-config.types';
import { MAX_RULE_MENTIONS, RULE_FILE_EXT, RULE_MENTION_PREFIX } from './project-config.consts';
import { stripExportBlock } from '../rules-kit';

export interface Frontmatter {
    readonly data: Record<string, string | boolean | string[]>;
    readonly body: string;
}

const parseValue = (raw: string): string | boolean | string[] => {
    const value = raw.trim();
    if (value === 'true' || value === 'false') {
        return value === 'true';
    }
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    return value.replace(/^["']|["']$/g, '');
};

/** Minimal YAML frontmatter (`key: value`, booleans, `[a, b]` lists and `- item` lists), as used by rules and commands. */
export const parseFrontmatter = (text: string): Frontmatter => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!match) {
        return { data: {}, body: text.trim() };
    }
    const data: Record<string, string | boolean | string[]> = {};
    let listKey: string | undefined;
    for (const line of match[1].split(/\r?\n/)) {
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (item && listKey) {
            const list = Array.isArray(data[listKey]) ? data[listKey] as string[] : [];
            data[listKey] = [...list, item[1].trim().replace(/^["']|["']$/g, '')];
            continue;
        }
        const pair = /^([\w-]+):\s*(.*)$/.exec(line);
        if (pair) {
            listKey = pair[2].trim() ? undefined : pair[1];
            data[pair[1]] = pair[2].trim() ? parseValue(pair[2]) : [];
        }
    }
    return { data, body: text.slice(match[0].length).trim() };
};

const baseName = (path: string): string => path.split('/').pop()!.replace(/\.(md|mdc)$/i, '').replace(/\.prompt$/i, '');

const asList = (value: string | boolean | string[] | undefined): string[] =>
    Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];

/**
 * IDEA-287: Cursor's rule types from frontmatter. `alwaysApply: true` → always; globs → auto; a description → agent
 * requested; `alwaysApply: false` alone → manual (@-mention). A plain file without frontmatter keys stays always-on.
 */
export const ruleKindOf = (data: Frontmatter['data'], globs: readonly string[]): RuleKind => {
    const description = typeof data.description === 'string' && data.description.trim();
    if (data.alwaysApply === true) {
        return 'always';
    }
    if (globs.length) {
        return 'auto';
    }
    if (description) {
        return 'agent';
    }
    return data.alwaysApply === false ? 'manual' : 'always';
};

/** A rule file (or AGENTS.md, always on). `scope` is the folder of a nested rule. */
export const ruleFromFile = (path: string, text: string, source: ConfigSource, scope?: string): ProjectRule => {
    // IDEA-319: AGENTS.md's `ingot export` block repeats `.ingot/rules`, which are loaded on their own.
    const { data, body } = parseFrontmatter(source === 'agents' ? stripExportBlock(text) : text);
    const globs = asList(data.globs);
    const kind = source === 'agents' ? 'always' : ruleKindOf(data, globs);
    const file = source === 'agents' ? path.split('/').pop()! : baseName(path);
    return {
        name: scope ? `${scope}/${file}` : file, path, source, globs, kind, alwaysApply: kind === 'always', body,
        ...(typeof data.description === 'string' && data.description ? { description: data.description } : {}),
        ...(scope ? { scope } : {})
    };
};

export const commandFromFile = (path: string, text: string, source: ConfigSource, kind: ProjectCommand['kind'] = 'command'): ProjectCommand => {
    const { data, body } = parseFrontmatter(text);
    const name = kind === 'skill' ? (typeof data.name === 'string' && data.name ? data.name : path.split('/').slice(-2)[0]) : baseName(path);
    const description = typeof data.description === 'string' && data.description ? data.description : body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').slice(0, 80);
    const args = asList(data.args ?? data['argument-hint']).join(' ');
    return { name: name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-'), path, source, kind, body, ...(description ? { description } : {}), ...(args ? { args } : {}) };
};

const toGlobRegExp = (glob: string): RegExp => {
    let pattern = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            pattern += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
            i += glob[i + 2] === '/' ? 2 : 1;
        } else if (c === '*') {
            pattern += '[^/]*';
        } else if (c === '?') {
            pattern += '[^/]';
        } else if (c === '{') {
            const end = glob.indexOf('}', i);
            pattern += `(?:${glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
            i = end;
        } else {
            pattern += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${pattern}$`);
};

/** Glob match for project-relative paths (`**`, `*`, `?`, `{a,b}`). A glob without `/` matches the file name anywhere. */
export const matchGlob = (glob: string, path: string): boolean => {
    const normalized = path.replace(/^\.\//, '');
    const re = toGlobRegExp(glob.replace(/^\.\//, ''));
    return re.test(normalized) || (!glob.includes('/') && re.test(normalized.split('/').pop()!));
};

const isUnder = (file: string, folder: string): boolean => file.startsWith(`${folder}/`);

/** Context files as seen from a nested rule's folder (relative to it); all files for a root rule. */
const filesInScope = (rule: ProjectRule, files: readonly string[]): string[] =>
    rule.scope ? files.filter(f => isUnder(f, rule.scope!)).map(f => f.slice(rule.scope!.length + 1)) : [...files];

const depth = (rule: ProjectRule): number => rule.scope ? rule.scope.split('/').length : 0;

/**
 * Rules that apply to this turn: always-on rules plus rules whose globs match a file in context. A nested rule
 * (IDEA-287) only applies when a context file is under its folder; for nested AGENTS.md files only the closest one to
 * each file applies. Root rules come first, deeper ones last (more specific wins on conflicts).
 */
export const applicableRules = (rules: readonly ProjectRule[], files: readonly string[]): ProjectRule[] => {
    const closestAgents = new Set(files.map(file => rules
        .filter(r => r.source === 'agents' && r.scope && isUnder(file, r.scope))
        .sort((a, b) => depth(b) - depth(a))[0]).filter((r): r is ProjectRule => !!r));
    return rules.filter(rule => {
        const scoped = filesInScope(rule, files);
        if (rule.scope && !scoped.length) {
            return false;
        }
        if (rule.source === 'agents' && rule.scope) {
            return closestAgents.has(rule);
        }
        return rule.kind === 'always' || (rule.kind === 'auto' && rule.globs.some(glob => scoped.some(file => matchGlob(glob, file))));
    }).sort((a, b) => depth(a) - depth(b));
};

/** Short label for lists: `always`, the globs, `agent requested` or `manual (@)`, plus a nested rule's folder. */
export const ruleKindLabel = (rule: Pick<ProjectRule, 'kind' | 'globs' | 'scope'>): string => {
    const kind = rule.kind === 'auto' ? rule.globs.join(', ') : rule.kind === 'agent' ? 'agent requested' : rule.kind === 'manual' ? 'manual (@)' : 'always';
    return rule.scope ? `${kind} · ${rule.scope}/` : kind;
};

const scopeNote = (rule: ProjectRule): string => rule.scope ? ` (for files under ${rule.scope}/)` : '';

export const formatRules = (rules: readonly ProjectRule[]): string =>
    rules.length ? `Project rules (follow them; a nested rule wins over a root rule for files under its folder):\n\n${rules.map(r => `## ${r.name}${scopeNote(r)}\n${r.body}`).join('\n\n')}` : '';

/** IDEA-287: Agent Requested rules, listed by name and description so the agent can fetch the relevant ones. */
export const requestableRules = (rules: readonly ProjectRule[]): ProjectRule[] => rules.filter(r => r.kind === 'agent');

export const formatRuleIndex = (rules: readonly ProjectRule[], tool: string): string => rules.length
    ? [`Available rules: read one with ${tool} {"name": "<rule name>"} before working on something it describes.`,
        ...rules.map(r => `- ${r.name}: ${r.description ?? ''}${scopeNote(r)}`)].join('\n')
    : '';

/** A rule by name (case-insensitive), for `fetch_rule` and @-mentions. */
export const findRule = (rules: readonly ProjectRule[], name: string): ProjectRule | undefined => {
    const wanted = name.trim().toLowerCase().replace(/^@/, '');
    return rules.find(r => r.name.toLowerCase() === wanted) ?? rules.find(r => baseName(r.name).toLowerCase() === wanted);
};

/** IDEA-287: rules the @ menu offers; manual and agent-requested rules first since they are not applied on their own. */
export const mentionableRules = (rules: readonly ProjectRule[]): ProjectRule[] =>
    [...rules].sort((a, b) => Number(a.kind === 'always' || a.kind === 'auto') - Number(b.kind === 'always' || b.kind === 'auto') || a.name.localeCompare(b.name));

/** IDEA-295: `API style!` → `api-style.md`; undefined when nothing usable is left. */
export const ruleFileName = (name: string): string | undefined => {
    const slug = name.trim().toLowerCase().replace(/\.(md|mdc)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug ? `${slug}${RULE_FILE_EXT}` : undefined;
};

/** IDEA-295: a rule file (Cursor-style frontmatter, then the body) that loads back as the same kind. */
export const ruleFileText = (draft: RuleDraft): string => {
    const quote = (v: string): string => JSON.stringify(v.trim());
    const globs = (draft.globs ?? '').split(',').map(g => g.trim()).filter(Boolean);
    const front = draft.kind === 'always' ? ['alwaysApply: true']
        : draft.kind === 'auto' ? [`globs: [${globs.map(quote).join(', ')}]`, 'alwaysApply: false']
            : draft.kind === 'agent' ? [`description: ${quote(draft.description ?? draft.name)}`, 'alwaysApply: false']
                : ['alwaysApply: false'];
    return `---\n${front.join('\n')}\n---\n${draft.body.trim()}\n`;
};

/** IDEA-287: `@` menu entries (`rule:<name>`) for the rules matching what was typed after `@`. */
export const ruleMentionItems = (rules: readonly ProjectRule[], query: string): string[] => {
    const wanted = query.trim().toLowerCase();
    return mentionableRules(rules)
        .filter(r => !wanted || r.name.toLowerCase().includes(wanted) || (r.description ?? '').toLowerCase().includes(wanted) || (wanted.length > 1 && 'rules'.startsWith(wanted)))
        .slice(0, MAX_RULE_MENTIONS)
        .map(r => `${RULE_MENTION_PREFIX}${r.name}`);
};

/**
 * IDEA-287: where a nested rule file lives. `packages/web/.ingot/rules/x.md` → scope `packages/web`, source `ingot`.
 * Root files (no folder in front) return undefined: they are loaded with the project's own config.
 */
export const nestedRuleScope = (path: string): { scope: string; source: ConfigSource } | undefined => {
    const clean = path.replace(/\\/g, '/').replace(/^\.\//, '');
    const agents = /^(.+)\/AGENTS\.md$/.exec(clean);
    if (agents) {
        return { scope: agents[1], source: 'agents' };
    }
    const folder = /^(.+?)\/\.(ingot|cursor)\/rules\//.exec(clean);
    return folder ? { scope: folder[1], source: folder[2] === 'ingot' ? 'ingot' : 'external' } : undefined;
};

/** IDEA-249: the folder a command came from, shown as its source in the `/` menu (for example `.ingot/commands`). */
export const commandFolder = (command: Pick<ProjectCommand, 'path' | 'kind'>): string => {
    const parts = command.path.split('/');
    return parts.slice(0, command.kind === 'skill' ? -2 : -1).join('/') || '.';
};

/** `/name args` → the command or skill, with `$ARGUMENTS` replaced (or args appended). */
export const expandCommand = (prompt: string, commands: readonly ProjectCommand[]): { command: ProjectCommand; text: string } | undefined => {
    const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
    const command = match && commands.find(c => c.name === match[1].toLowerCase());
    if (!command) {
        return undefined;
    }
    const args = (match![2] ?? '').trim();
    const text = command.body.includes('$ARGUMENTS') ? command.body.split('$ARGUMENTS').join(args) : [command.body, args].filter(Boolean).join('\n\n');
    return { command, text };
};

/** Marks an env value that Ingot keeps in the OS keychain instead of the file. */
export const KEYCHAIN_PLACEHOLDER = '${keychain}';

const splitSecretEnv = (env: Record<string, string> | undefined): { env?: Record<string, string>; secretEnv?: string[] } => {
    if (!env) {
        return {};
    }
    const secretEnv = Object.keys(env).filter(k => env[k] === KEYCHAIN_PLACEHOLDER);
    const plain = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== KEYCHAIN_PLACEHOLDER));
    return { ...(Object.keys(plain).length ? { env: plain } : {}), ...(secretEnv.length ? { secretEnv } : {}) };
};

/** Header secrets share the server's keychain namespace with a `header:` prefix. */
export const headerSecretName = (header: string): string => `header:${header}`;

const splitSecretHeaders = (headers: Record<string, string> | undefined): { headers?: Record<string, string>; secretHeaders?: string[] } => {
    const split = splitSecretEnv(headers);
    return { ...(split.env ? { headers: split.env } : {}), ...(split.secretEnv ? { secretHeaders: split.secretEnv } : {}) };
};

/** Keychain account for one MCP secret. */
export const mcpSecretKey = (server: string, name: string): string => `mcp:${server}:${name}`;

/** Replaces `${VAR}` in args with env values (used for connection strings passed as arguments). */
export const expandArgs = (args: readonly string[], env: Readonly<Record<string, string>>): string[] =>
    args.map(a => a.replace(/\$\{([A-Z0-9_]+)\}/g, (m, name: string) => env[name] ?? m));

/** Serializes servers back to the common `mcp.json` shape; keychain vars are written as placeholders, never values. */
export const toMcpJson = (servers: readonly McpServerConfig[]): string => JSON.stringify({
    mcpServers: Object.fromEntries(servers.map(s => [s.name, {
        ...(s.command ? { command: s.command, args: [...(s.args ?? [])] } : {}),
        ...(s.url ? { url: s.url } : {}),
        ...(s.envFile ? { envFile: s.envFile } : {}),
        ...(s.env || s.secretEnv ? { env: { ...(s.env ?? {}), ...Object.fromEntries((s.secretEnv ?? []).map(k => [k, KEYCHAIN_PLACEHOLDER])) } } : {}),
        ...(s.headers || s.secretHeaders ? { headers: { ...(s.headers ?? {}), ...Object.fromEntries((s.secretHeaders ?? []).map(k => [k, KEYCHAIN_PLACEHOLDER])) } } : {})
    }]))
}, undefined, 2) + '\n';

/** `{ "mcpServers": { name: { command, args, env } | { url, headers } } }` (common MCP format). */
export const parseMcpJson = (text: string, source: McpServerConfig['source']): McpServerConfig[] => {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return [];
    }
    const servers = (json as { mcpServers?: Record<string, Record<string, unknown>> })?.mcpServers;
    if (!servers || typeof servers !== 'object') {
        return [];
    }
    return Object.entries(servers).flatMap(([name, raw]) => {
        if (!raw || typeof raw !== 'object') {
            return [];
        }
        const strings = (v: unknown): Record<string, string> | undefined =>
            v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, val]) => [k, String(val)])) : undefined;
        const command = typeof raw.command === 'string' ? raw.command : undefined;
        const url = typeof raw.url === 'string' ? raw.url : undefined;
        if (!command && !url) {
            return [];
        }
        const config: McpServerConfig = {
            name, source,
            ...(command ? { command, args: Array.isArray(raw.args) ? raw.args.map(String) : [] } : {}),
            ...(url ? { url } : {}),
            ...(typeof raw.envFile === 'string' && raw.envFile ? { envFile: raw.envFile } : {}),
            ...splitSecretEnv(strings(raw.env)),
            ...splitSecretHeaders(strings(raw.headers))
        };
        return [config];
    });
};

export type ScopeLabel = 'Global' | 'Project' | 'Imported' | 'Team';

/** Scope badge for an item: Global (`~/.ingot`), Imported (other tools' folders, project or global), Team (account) or Project. */
export const scopeLabel = (source: ConfigSource | 'user'): ScopeLabel =>
    source === 'team' ? 'Team' : source === 'global' || source === 'user' ? 'Global' : source === 'external' || source === 'global-imported' ? 'Imported' : 'Project';

/** File-name slug for a new rule / command / skill. */
export const slugify = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

/** Later sources win: imported folders < legacy `.alloy` < `.ingot`, so Ingot's own config overrides the rest. */
export const mergeByName = <T extends { name: string }>(...lists: (readonly T[])[]): T[] => {
    const byName = new Map<string, T>();
    for (const list of lists) {
        for (const item of list) {
            byName.set(item.name, item);
        }
    }
    return [...byName.values()];
};
