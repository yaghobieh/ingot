import type { McpServerConfig, McpServerStatus } from '../project-config/project-config.types';

export interface McpCatalogField {
    readonly name: string;
    readonly label: string;
    /** Secret values go to the OS keychain; the file only gets a placeholder. */
    readonly secret: boolean;
    readonly placeholder?: string;
    readonly optional?: boolean;
}

export interface McpCatalogEntry {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** Short monogram and tile color for the row icon (no third-party logos). */
    readonly mark: string;
    readonly color: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly fields: readonly McpCatalogField[];
    readonly signIn?: boolean;
}

const npx = (...pkg: string[]): { command: string; args: string[] } => ({ command: 'npx', args: ['-y', ...pkg] });
const remote = (url: string): { command: string; args: string[] } => npx('mcp-remote', url);

/**
 * One-click MCP servers (IDEA-62): config templates for popular apps. Remote servers that sign in with OAuth run
 * through `mcp-remote`, which opens the browser once and keeps the token outside the project.
 */
export const MCP_CATALOG: readonly McpCatalogEntry[] = [
    { id: 'github', name: 'GitHub', description: 'Repositories, issues, pull requests and code search.', mark: 'GH', color: '#24292F', ...npx('@modelcontextprotocol/server-github'),
        fields: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', secret: true, placeholder: 'ghp_…' }] },
    { id: 'gitlab', name: 'GitLab', description: 'Projects, merge requests, issues and pipelines.', mark: 'GL', color: '#E24329', ...npx('@modelcontextprotocol/server-gitlab'),
        fields: [{ name: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', secret: true, placeholder: 'glpat-…' },
            { name: 'GITLAB_API_URL', label: 'API URL (self-hosted)', secret: false, placeholder: 'https://gitlab.com/api/v4', optional: true }] },
    { id: 'atlassian', name: 'Jira & Confluence', description: 'Atlassian issues, boards and pages. Signs in with your Atlassian account.', mark: 'AT', color: '#1868DB', ...remote('https://mcp.atlassian.com/v1/sse'), fields: [], signIn: true },
    { id: 'linear', name: 'Linear', description: 'Issues, projects and cycles. Signs in with your Linear account.', mark: 'LN', color: '#5E6AD2', ...remote('https://mcp.linear.app/sse'), fields: [], signIn: true },
    { id: 'slack', name: 'Slack', description: 'Read channels and threads, post messages.', mark: 'SL', color: '#4A154B', ...npx('@modelcontextprotocol/server-slack'),
        fields: [{ name: 'SLACK_BOT_TOKEN', label: 'Bot token', secret: true, placeholder: 'xoxb-…' }, { name: 'SLACK_TEAM_ID', label: 'Workspace (team) ID', secret: false, placeholder: 'T0123…' }] },
    { id: 'notion', name: 'Notion', description: 'Search and edit pages and databases. Signs in with your Notion account.', mark: 'N', color: '#191919', ...remote('https://mcp.notion.com/mcp'), fields: [], signIn: true },
    { id: 'figma', name: 'Figma', description: 'Read frames, components and styles from design files.', mark: 'FG', color: '#A259FF', ...npx('figma-developer-mcp', '--stdio'),
        fields: [{ name: 'FIGMA_API_KEY', label: 'Personal access token', secret: true, placeholder: 'figd_…' }] },
    { id: 'postgres', name: 'Postgres', description: 'Read-only SQL queries and schema inspection.', mark: 'PG', color: '#336791', ...npx('@modelcontextprotocol/server-postgres', '${POSTGRES_URL}'),
        fields: [{ name: 'POSTGRES_URL', label: 'Connection string', secret: true, placeholder: 'postgresql://user:pass@localhost:5432/db' }] },
    { id: 'supabase', name: 'Supabase', description: 'Projects, tables, SQL, branches and edge functions. Signs in with Supabase.', mark: 'SB', color: '#3ECF8E', ...remote('https://mcp.supabase.com/mcp'), fields: [], signIn: true },
    { id: 'neon', name: 'Neon', description: 'Serverless Postgres projects, branches and queries. Signs in with Neon.', mark: 'NE', color: '#00C2A8', ...remote('https://mcp.neon.tech/mcp'), fields: [], signIn: true },
    { id: 'sentry', name: 'Sentry', description: 'Issues, events and releases. Signs in with your Sentry account.', mark: 'SE', color: '#362D59', ...remote('https://mcp.sentry.dev/mcp'), fields: [], signIn: true },
    { id: 'vercel', name: 'Vercel', description: 'Projects, deployments, logs and docs. Signs in with Vercel.', mark: 'VC', color: '#111111', ...remote('https://mcp.vercel.com'), fields: [], signIn: true },
    { id: 'stripe', name: 'Stripe', description: 'Customers, products, invoices and payments, plus Stripe docs. Signs in with Stripe.', mark: 'ST', color: '#635BFF', ...remote('https://mcp.stripe.com'), fields: [], signIn: true },
    { id: 'resend', name: 'Resend', description: 'Send email, manage domains, contacts and broadcasts.', mark: 'RE', color: '#000000', ...npx('resend-mcp'),
        fields: [{ name: 'RESEND_API_KEY', label: 'API key', secret: true, placeholder: 're_…' }] },
    { id: 'discord', name: 'Discord', description: 'Servers, channels and messages. Signs in with Discord.', mark: 'DC', color: '#5865F2', ...remote('https://mcp.discord.com/api/v1'), fields: [], signIn: true },
    { id: 'google-drive', name: 'Google Drive', description: 'Search, read and create Drive files. Signs in with Google.', mark: 'GD', color: '#1FA463', ...remote('https://drivemcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    { id: 'gmail', name: 'Gmail', description: 'Search and read mail, draft replies. Signs in with Google.', mark: 'GM', color: '#EA4335', ...remote('https://gmailmcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    { id: 'playwright', name: 'Playwright', description: 'Drive a real browser: open pages, click, fill, screenshot.', mark: 'PW', color: '#2EAD33', ...npx('@playwright/mcp@latest'), fields: [] },
    { id: 'docker', name: 'Docker', description: 'Containers, images and the Docker MCP gateway (Docker Desktop).', mark: 'DK', color: '#1D63ED', command: 'docker', args: ['mcp', 'gateway', 'run'], fields: [] },
    { id: 'filesystem', name: 'Filesystem', description: 'Read and write files in the project folder.', mark: 'FS', color: '#3B6FD9', ...npx('@modelcontextprotocol/server-filesystem', '.'), fields: [] },
    { id: 'fetch', name: 'Fetch', description: 'Fetch web pages and convert them to markdown.', mark: 'FE', color: '#E07B39', ...npx('@kazuph/mcp-fetch'), fields: [] },
    { id: 'memory', name: 'Memory', description: 'A local knowledge graph the agent can remember facts in.', mark: 'ME', color: '#8B5CF6', ...npx('@modelcontextprotocol/server-memory'), fields: [] }
];

export type McpScope = 'user' | 'project';

/** Server config for a catalog entry: plain fields go into env, secret ones become keychain placeholders. */
export const catalogToConfig = (entry: McpCatalogEntry, name: string, scope: McpScope, values: Readonly<Record<string, string>>): McpServerConfig => {
    const env = Object.fromEntries(entry.fields.filter(f => !f.secret && values[f.name]).map(f => [f.name, values[f.name]]));
    const secretEnv = entry.fields.filter(f => f.secret).map(f => f.name);
    return {
        name, source: scope === 'user' ? 'user' : 'ingot', command: entry.command, args: [...entry.args],
        ...(Object.keys(env).length ? { env } : {}), ...(secretEnv.length ? { secretEnv } : {})
    };
};

export const isValidServerName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name);

export type McpRowGroup = 'attention' | 'connected' | 'available';

/** Which section a server row belongs in on the MCP page. */
export const rowGroup = (enabled: boolean, status: McpServerStatus | undefined): McpRowGroup => {
    if (!enabled) {
        return 'available';
    }
    return status?.state === 'error' || status?.state === 'needs-auth' ? 'attention' : 'connected';
};

/** "41 tools, 4 resources enabled" / "Needs authentication" / "Error - Show Output". */
export const rowSummary = (enabled: boolean, status: McpServerStatus | undefined): string => {
    if (!enabled) {
        return 'Disabled';
    }
    switch (status?.state) {
        case 'error': return 'Error - Show Output';
        case 'needs-auth': return 'Needs authentication';
        case 'connected': {
            const tools = `${status.tools.length} tool${status.tools.length === 1 ? '' : 's'}`;
            return status.resources ? `${tools}, ${status.resources} resource${status.resources === 1 ? '' : 's'} enabled` : `${tools} enabled`;
        }
        default: return 'Connecting…';
    }
};

/** The catalog entry a configured server was created from (same command and package args), if any. */
export const catalogEntryFor = (config: Pick<McpServerConfig, 'name' | 'command' | 'args'>): McpCatalogEntry | undefined =>
    MCP_CATALOG.find(e => e.id === config.name)
    ?? MCP_CATALOG.find(e => e.command === config.command && e.args.filter(a => !a.startsWith('$') && a !== '-y').every(a => (config.args ?? []).includes(a)));

/** Case-insensitive match of a search query against any of the given texts. */
export const matchesQuery = (query: string, ...texts: (string | undefined)[]): boolean => {
    const q = query.trim().toLowerCase();
    return !q || texts.some(t => t?.toLowerCase().includes(q));
};

export const CUSTOMIZE_TABS = [
    { id: 'plugins', label: 'Plugins' },
    { id: 'mcps', label: 'MCPs' },
    { id: 'skills', label: 'Skills', dir: 'skills' },
    { id: 'subagents', label: 'Subagents', dir: 'agents' },
    { id: 'rules', label: 'Rules', dir: 'rules' },
    { id: 'commands', label: 'Commands', dir: 'commands' },
    { id: 'hooks', label: 'Hooks', dir: 'hooks' }
] as const;
export type CustomizeTab = typeof CUSTOMIZE_TABS[number]['id'];

/** Rows shown before "Show N more" in the Needs Attention section. */
export const ATTENTION_PREVIEW = 5;

/** Splits a command line into args, honouring single and double quotes. */
export const splitArgs = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let quote: string | undefined;
    let started = false;
    for (const ch of line) {
        if (quote) {
            if (ch === quote) {
                quote = undefined;
            } else {
                current += ch;
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            started = true;
        } else if (/\s/.test(ch)) {
            if (started || current) {
                out.push(current);
            }
            current = '';
            started = false;
        } else {
            current += ch;
        }
    }
    if (started || current) {
        out.push(current);
    }
    return out;
};

export type McpTransport = 'stdio' | 'http';

export interface McpKeyValue { readonly key: string; readonly value: string; readonly secret: boolean }

export interface CustomServerForm {
    readonly name: string;
    readonly transport: McpTransport;
    readonly command: string;
    readonly args: string;
    readonly env: readonly McpKeyValue[];
    readonly url: string;
    readonly headers: readonly McpKeyValue[];
    /** Remote server that signs in with OAuth in the browser (runs through mcp-remote). */
    readonly oauth: boolean;
}

/**
 * Turns the Add / Edit MCP Server form into a config plus the secrets for the keychain.
 * Secret env vars and headers become `${keychain}` placeholders in mcp.json, never plaintext.
 */
export const customToConfig = (form: CustomServerForm, scope: McpScope): { config: McpServerConfig; secrets: Record<string, string> } => {
    const source = scope === 'user' ? 'user' : 'ingot';
    const filled = (list: readonly McpKeyValue[]) => list.filter(kv => kv.key.trim());
    const secrets: Record<string, string> = {};
    const env = filled(form.env);
    for (const kv of env.filter(e => e.secret && e.value)) {
        secrets[kv.key.trim()] = kv.value;
    }
    const plainEnv = Object.fromEntries(env.filter(e => !e.secret).map(e => [e.key.trim(), e.value]));
    const secretEnv = env.filter(e => e.secret).map(e => e.key.trim());
    const envPart = { ...(Object.keys(plainEnv).length ? { env: plainEnv } : {}), ...(secretEnv.length ? { secretEnv } : {}) };
    if (form.transport === 'http' && form.oauth) {
        return { config: { name: form.name, source, command: 'npx', args: ['-y', 'mcp-remote', form.url.trim()], ...envPart }, secrets };
    }
    if (form.transport === 'http') {
        const headers = filled(form.headers);
        for (const kv of headers.filter(h => h.secret && h.value)) {
            secrets[`header:${kv.key.trim()}`] = kv.value;
        }
        const plain = Object.fromEntries(headers.filter(h => !h.secret).map(h => [h.key.trim(), h.value]));
        const secretHeaders = headers.filter(h => h.secret).map(h => h.key.trim());
        return { config: { name: form.name, source, url: form.url.trim(), ...(Object.keys(plain).length ? { headers: plain } : {}), ...(secretHeaders.length ? { secretHeaders } : {}) }, secrets };
    }
    return { config: { name: form.name, source, command: form.command.trim(), args: splitArgs(form.args), ...envPart }, secrets };
};

/** Form values for editing an existing server (secret values are never read back, only their names). */
export const configToForm = (config: McpServerConfig): CustomServerForm => {
    const remote = config.command === 'npx' && config.args?.includes('mcp-remote');
    const url = remote ? config.args![config.args!.indexOf('mcp-remote') + 1] ?? '' : config.url ?? '';
    const env = [...Object.entries(config.env ?? {}).map(([key, value]) => ({ key, value, secret: false })), ...(config.secretEnv ?? []).map(key => ({ key, value: '', secret: true }))];
    const headers = [...Object.entries(config.headers ?? {}).map(([key, value]) => ({ key, value, secret: false })), ...(config.secretHeaders ?? []).map(key => ({ key, value: '', secret: true }))];
    return {
        name: config.name, transport: config.url || remote ? 'http' : 'stdio', oauth: !!remote,
        command: remote ? '' : config.command ?? '', args: remote ? '' : (config.args ?? []).map(a => /\s/.test(a) ? `"${a}"` : a).join(' '),
        env, url, headers
    };
};

export const EMPTY_SERVER_FORM: CustomServerForm = { name: '', transport: 'stdio', command: '', args: '', env: [], url: '', headers: [], oauth: false };

export type ConfigItemKind = 'rule' | 'command' | 'skill' | 'subagent' | 'hook';

/** Where a new item lives under `.ingot/` (project) or `~/.ingot/` (global), and its starter content. */
export const newItemFile = (kind: ConfigItemKind, slug: string): { path: string[]; content: string } => {
    switch (kind) {
        case 'rule': return { path: ['rules', `${slug}.md`], content: `---\ndescription: \nglobs: \nalwaysApply: false\n---\n\n` };
        case 'command': return { path: ['commands', `${slug}.md`], content: `---\ndescription: \n---\n\nDescribe what /${slug} should do.\n` };
        case 'skill': return { path: ['skills', slug, 'SKILL.md'], content: `---\nname: ${slug}\ndescription: \n---\n\n# ${slug}\n\nSteps the agent follows when this skill applies.\n` };
        case 'subagent': return { path: ['agents', `${slug}.md`], content: `---\nname: ${slug}\ndescription: \nmodel: \n---\n\nYou are a focused subagent that…\n` };
        case 'hook': return { path: ['hooks', `${slug}.json`], content: `${JSON.stringify({ event: 'afterEdit', command: '' }, undefined, 2)}\n` };
    }
};
