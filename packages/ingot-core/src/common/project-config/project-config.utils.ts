import type { ConfigSource, McpServerConfig, ProjectCommand, ProjectRule } from './project-config.types';

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

const baseName = (path: string): string => path.split('/').pop()!.replace(/\.(md|mdc)$/i, '');

const asList = (value: string | boolean | string[] | undefined): string[] =>
    Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];

/** A rule file. Without globs or `alwaysApply: false` a rule always applies (like AGENTS.md); with globs it applies to matching files. */
export const ruleFromFile = (path: string, text: string, source: ConfigSource): ProjectRule => {
    const { data, body } = parseFrontmatter(text);
    const globs = asList(data.globs);
    const alwaysApply = data.alwaysApply === true || (data.alwaysApply === undefined && globs.length === 0);
    return {
        name: source === 'agents' ? path.split('/').pop()! : baseName(path), path, source, globs, alwaysApply, body,
        ...(typeof data.description === 'string' && data.description ? { description: data.description } : {})
    };
};

export const commandFromFile = (path: string, text: string, source: ConfigSource, kind: ProjectCommand['kind'] = 'command'): ProjectCommand => {
    const { data, body } = parseFrontmatter(text);
    const name = kind === 'skill' ? (typeof data.name === 'string' && data.name ? data.name : path.split('/').slice(-2)[0]) : baseName(path);
    const description = typeof data.description === 'string' && data.description ? data.description : body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').slice(0, 80);
    return { name: name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-'), path, source, kind, body, ...(description ? { description } : {}) };
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

/** Rules that apply to this turn: always-on rules plus rules whose globs match a file in context. */
export const applicableRules = (rules: readonly ProjectRule[], files: readonly string[]): ProjectRule[] =>
    rules.filter(rule => rule.alwaysApply || rule.globs.some(glob => files.some(file => matchGlob(glob, file))));

export const formatRules = (rules: readonly ProjectRule[]): string =>
    rules.length ? `Project rules (follow them):\n\n${rules.map(r => `## ${r.name}\n${r.body}`).join('\n\n')}` : '';

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
            ...splitSecretEnv(strings(raw.env)),
            ...splitSecretHeaders(strings(raw.headers))
        };
        return [config];
    });
};

export type ScopeLabel = 'Global' | 'Project' | 'Imported';

/** Scope badge for an item: Global (`~/.ingot`), Imported (other tools' folders, project or global) or Project. */
export const scopeLabel = (source: ConfigSource | 'user'): ScopeLabel =>
    source === 'global' || source === 'user' ? 'Global' : source === 'external' || source === 'global-imported' ? 'Imported' : 'Project';

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
