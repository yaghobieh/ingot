import type { McpServerConfig, McpServerStatus } from '../project-config/project-config.types';

export interface McpCatalogField {
    readonly name: string;
    readonly label: string;
    /** Secret values go to the OS keychain; the file only gets a placeholder. */
    readonly secret: boolean;
    readonly placeholder?: string;
    readonly optional?: boolean;
}

/** Marketplace sections (IDEA-123), in display order. */
export const MCP_CATEGORIES = [
    { id: 'dev', label: 'Developer & Design' },
    { id: 'productivity', label: 'Productivity & Teams' },
    { id: 'google', label: 'Google Workspace' },
    { id: 'cloud', label: 'Cloud & Hosting' },
    { id: 'backend', label: 'Backend & Payments' },
    { id: 'databases', label: 'Databases' },
    { id: 'browser', label: 'Browser & Testing' },
    { id: 'search', label: 'Search & Docs' },
    { id: 'core', label: 'Core Utilities' }
] as const;
export type McpCategory = typeof MCP_CATEGORIES[number]['id'];

export interface McpCatalogEntry {
    readonly id: string;
    readonly category: McpCategory;
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
    { id: 'github', category: 'dev', name: 'GitHub', description: 'Repositories, issues, pull requests and code search.', mark: 'GH', color: '#24292F', ...npx('@modelcontextprotocol/server-github'),
        fields: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', secret: true, placeholder: 'ghp_…' }] },
    { id: 'gitlab', category: 'dev', name: 'GitLab', description: 'Projects, merge requests, issues and pipelines.', mark: 'GL', color: '#E24329', ...npx('@modelcontextprotocol/server-gitlab'),
        fields: [{ name: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', secret: true, placeholder: 'glpat-…' },
            { name: 'GITLAB_API_URL', label: 'API URL (self-hosted)', secret: false, placeholder: 'https://gitlab.com/api/v4', optional: true }] },
    { id: 'atlassian', category: 'productivity', name: 'Jira & Confluence', description: 'Atlassian issues, boards and pages. Signs in with your Atlassian account.', mark: 'AT', color: '#1868DB', ...remote('https://mcp.atlassian.com/v1/sse'), fields: [], signIn: true },
    { id: 'linear', category: 'productivity', name: 'Linear', description: 'Issues, projects and cycles. Signs in with your Linear account.', mark: 'LN', color: '#5E6AD2', ...remote('https://mcp.linear.app/sse'), fields: [], signIn: true },
    { id: 'slack', category: 'productivity', name: 'Slack', description: 'Read channels and threads, post messages.', mark: 'SL', color: '#4A154B', ...npx('@modelcontextprotocol/server-slack'),
        fields: [{ name: 'SLACK_BOT_TOKEN', label: 'Bot token', secret: true, placeholder: 'xoxb-…' }, { name: 'SLACK_TEAM_ID', label: 'Workspace (team) ID', secret: false, placeholder: 'T0123…' }] },
    { id: 'notion', category: 'productivity', name: 'Notion', description: 'Search and edit pages and databases. Signs in with your Notion account.', mark: 'N', color: '#191919', ...remote('https://mcp.notion.com/mcp'), fields: [], signIn: true },
    { id: 'figma', category: 'dev', name: 'Figma', description: 'Read frames, components and styles from design files.', mark: 'FG', color: '#A259FF', ...npx('figma-developer-mcp', '--stdio'),
        fields: [{ name: 'FIGMA_API_KEY', label: 'Personal access token', secret: true, placeholder: 'figd_…' }] },
    { id: 'postgres', category: 'databases', name: 'Postgres', description: 'Read-only SQL queries and schema inspection.', mark: 'PG', color: '#336791', ...npx('@modelcontextprotocol/server-postgres', '${POSTGRES_URL}'),
        fields: [{ name: 'POSTGRES_URL', label: 'Connection string', secret: true, placeholder: 'postgresql://user:pass@localhost:5432/db' }] },
    { id: 'supabase', category: 'backend', name: 'Supabase', description: 'Projects, tables, SQL, branches and edge functions. Signs in with Supabase.', mark: 'SB', color: '#3ECF8E', ...remote('https://mcp.supabase.com/mcp'), fields: [], signIn: true },
    { id: 'neon', category: 'databases', name: 'Neon', description: 'Serverless Postgres projects, branches and queries. Signs in with Neon.', mark: 'NE', color: '#00C2A8', ...remote('https://mcp.neon.tech/mcp'), fields: [], signIn: true },
    { id: 'sentry', category: 'dev', name: 'Sentry', description: 'Issues, events and releases. Signs in with your Sentry account.', mark: 'SE', color: '#362D59', ...remote('https://mcp.sentry.dev/mcp'), fields: [], signIn: true },
    { id: 'vercel', category: 'cloud', name: 'Vercel', description: 'Projects, deployments, logs and docs. Signs in with Vercel.', mark: 'VC', color: '#111111', ...remote('https://mcp.vercel.com'), fields: [], signIn: true },
    { id: 'stripe', category: 'backend', name: 'Stripe', description: 'Customers, products, invoices and payments, plus Stripe docs. Signs in with Stripe.', mark: 'ST', color: '#635BFF', ...remote('https://mcp.stripe.com'), fields: [], signIn: true },
    { id: 'resend', category: 'backend', name: 'Resend', description: 'Send email, manage domains, contacts and broadcasts.', mark: 'RE', color: '#000000', ...npx('resend-mcp'),
        fields: [{ name: 'RESEND_API_KEY', label: 'API key', secret: true, placeholder: 're_…' }] },
    { id: 'discord', category: 'productivity', name: 'Discord', description: 'Servers, channels and messages. Signs in with Discord.', mark: 'DC', color: '#5865F2', ...remote('https://mcp.discord.com/api/v1'), fields: [], signIn: true },
    { id: 'google-drive', category: 'google', name: 'Google Drive', description: 'Search, read and create Drive files. Signs in with Google.', mark: 'GD', color: '#1FA463', ...remote('https://drivemcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    { id: 'gmail', category: 'google', name: 'Gmail', description: 'Search and read mail, draft replies. Signs in with Google.', mark: 'GM', color: '#EA4335', ...remote('https://gmailmcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    { id: 'playwright', category: 'browser', name: 'Playwright', description: 'Drive a real browser: open pages, click, fill, screenshot.', mark: 'PW', color: '#2EAD33', ...npx('@playwright/mcp@latest'), fields: [] },
    { id: 'docker', category: 'cloud', name: 'Docker', description: 'Containers, images and the Docker MCP gateway (Docker Desktop).', mark: 'DK', color: '#1D63ED', command: 'docker', args: ['mcp', 'gateway', 'run'], fields: [] },
    { id: 'filesystem', category: 'core', name: 'Filesystem', description: 'Read and write files in the project folder.', mark: 'FS', color: '#3B6FD9', ...npx('@modelcontextprotocol/server-filesystem', '.'), fields: [] },
    { id: 'fetch', category: 'search', name: 'Fetch', description: 'Fetch web pages and convert them to markdown.', mark: 'FE', color: '#E07B39', ...npx('@kazuph/mcp-fetch'), fields: [] },
    { id: 'memory', category: 'core', name: 'Memory', description: 'A local knowledge graph the agent can remember facts in.', mark: 'ME', color: '#8B5CF6', ...npx('@modelcontextprotocol/server-memory'), fields: [] },
    // Google (Workspace remote MCP servers, Developer Preview; sign in with Google)
    { id: 'google-calendar', category: 'google', name: 'Google Calendar', description: 'Find free time, read and create events. Signs in with Google.', mark: 'GC', color: '#4285F4', ...remote('https://calendarmcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    { id: 'google-docs', category: 'google', name: 'Google Docs', description: 'Read and edit Docs. Signs in with Google.', mark: 'GO', color: '#4285F4', ...remote('https://docsmcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    { id: 'google-sheets', category: 'google', name: 'Google Sheets', description: 'Read and update spreadsheets. Signs in with Google.', mark: 'GS', color: '#0F9D58', ...remote('https://sheetsmcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    { id: 'google-chat', category: 'google', name: 'Google Chat', description: 'Spaces and messages in Google Chat. Signs in with Google.', mark: 'GT', color: '#00AC47', ...remote('https://chatmcp.googleapis.com/mcp/v1'), fields: [], signIn: true },
    // Productivity
    { id: 'granola', category: 'productivity', name: 'Granola', description: 'Search your meeting notes, decisions and action items. Signs in with Granola.', mark: 'GR', color: '#2F6B3F', ...remote('https://mcp.granola.ai/mcp'), fields: [], signIn: true },
    { id: 'apollo', category: 'productivity', name: 'Apollo', description: 'Prospects, accounts, sequences and enrichment. Signs in with Apollo.', mark: 'AP', color: '#F5C518', ...remote('https://mcp.apollo.io/mcp'), fields: [], signIn: true },
    // Cloud & hosting
    { id: 'aws', category: 'cloud', name: 'AWS', description: 'AWS docs, guided workflows (Amplify, CDK, …) and API calls with your AWS CLI sign-in. Needs uv and the AWS CLI.', mark: 'AW', color: '#FF9900',
        command: 'uvx', args: ['mcp-proxy-for-aws-cli@latest', 'https://aws-mcp.us-east-1.api.aws/mcp'], fields: [{ name: 'AWS_PROFILE', label: 'AWS profile', secret: false, placeholder: 'default', optional: true }, { name: 'AWS_REGION', label: 'Region', secret: false, placeholder: 'us-east-1', optional: true }] },
    { id: 'aws-amplify', category: 'cloud', name: 'AWS Amplify', description: 'Amplify Gen 2 backend, frontend and deployment workflows through the AWS MCP Server. Needs uv and the AWS CLI.', mark: 'AM', color: '#FF9900',
        command: 'uvx', args: ['mcp-proxy-for-aws-cli@latest', 'https://aws-mcp.us-east-1.api.aws/mcp'], fields: [{ name: 'AWS_PROFILE', label: 'AWS profile', secret: false, placeholder: 'default', optional: true }] },
    { id: 'amazon-location', category: 'cloud', name: 'Amazon Location', description: 'Places search, geocoding, routes and maps with Amazon Location Service. Needs uv.', mark: 'AL', color: '#232F3E',
        command: 'uvx', args: ['awslabs.aws-location-mcp-server@latest'], fields: [{ name: 'AWS_PROFILE', label: 'AWS profile', secret: false, placeholder: 'default', optional: true }, { name: 'AWS_REGION', label: 'Region', secret: false, placeholder: 'us-east-1', optional: true }] },
    { id: 'aws-docs', category: 'cloud', name: 'AWS Documentation', description: 'Search and read AWS documentation. Needs uv.', mark: 'AD', color: '#232F3E', command: 'uvx', args: ['awslabs.aws-documentation-mcp-server@latest'], fields: [] },
    { id: 'cloudflare', category: 'cloud', name: 'Cloudflare', description: 'Workers, KV, R2, D1 and the Cloudflare API. Signs in with Cloudflare.', mark: 'CF', color: '#F38020', ...remote('https://mcp.cloudflare.com/mcp'), fields: [], signIn: true },
    { id: 'netlify', category: 'cloud', name: 'Netlify', description: 'Create, deploy and manage Netlify sites.', mark: 'NL', color: '#00AD9F', ...npx('@netlify/mcp'), fields: [] },
    { id: 'kubernetes', category: 'cloud', name: 'Kubernetes', description: 'Pods, deployments, logs and kubectl through your kubeconfig.', mark: 'K8', color: '#326CE5', ...npx('mcp-server-kubernetes'), fields: [] },
    // Backend
    { id: 'appwrite', category: 'backend', name: 'Appwrite', description: 'Databases, auth, storage and functions in Appwrite Cloud. Signs in with Appwrite.', mark: 'AE', color: '#FD366E', ...remote('https://mcp.appwrite.io/'), fields: [], signIn: true },
    { id: 'firebase', category: 'backend', name: 'Firebase', description: 'Firestore, Auth, Hosting and project config with the Firebase CLI sign-in.', mark: 'FB', color: '#FFCA28', ...npx('firebase-tools@latest', 'mcp'), fields: [] },
    { id: 'prisma', category: 'backend', name: 'Prisma', description: 'Prisma Postgres databases, migrations and schema. Signs in with Prisma.', mark: 'PR', color: '#2D3748', ...remote('https://mcp.prisma.io/mcp'), fields: [], signIn: true },
    // Databases
    { id: 'mongodb', category: 'databases', name: 'MongoDB', description: 'Query collections and inspect schemas (read-only by default).', mark: 'MG', color: '#00684A', ...npx('mongodb-mcp-server', '--readOnly'),
        fields: [{ name: 'MDB_MCP_CONNECTION_STRING', label: 'Connection string', secret: true, placeholder: 'mongodb+srv://user:pass@cluster.example.net/db' }] },
    { id: 'redis', category: 'databases', name: 'Redis', description: 'Keys, hashes, streams and search on a Redis server. Needs uv.', mark: 'RD', color: '#DC382D', command: 'uvx', args: ['--from', 'redis-mcp-server@latest', 'redis-mcp-server', '--url', '${REDIS_URL}'],
        fields: [{ name: 'REDIS_URL', label: 'Redis URL', secret: true, placeholder: 'redis://localhost:6379/0' }] },
    { id: 'sqlite', category: 'databases', name: 'SQLite', description: 'Query and inspect a local SQLite database file. Needs uv.', mark: 'LI', color: '#003B57', command: 'uvx', args: ['mcp-server-sqlite', '--db-path', '${SQLITE_PATH}'],
        fields: [{ name: 'SQLITE_PATH', label: 'Database file', secret: false, placeholder: './data.db' }] },
    // Browser & testing
    { id: 'puppeteer', category: 'browser', name: 'Puppeteer', description: 'Headless Chrome: navigate, screenshot, click and run scripts.', mark: 'PP', color: '#40B5A4', ...npx('@modelcontextprotocol/server-puppeteer'), fields: [] },
    { id: 'chrome-devtools', category: 'browser', name: 'Chrome DevTools', description: 'Inspect a live Chrome: console, network, performance traces.', mark: 'CD', color: '#4285F4', ...npx('chrome-devtools-mcp@latest'), fields: [] },
    // Search & docs
    { id: 'brave-search', category: 'search', name: 'Brave Search', description: 'Web, news, image and local search.', mark: 'BS', color: '#FB542B', ...npx('@brave/brave-search-mcp-server'),
        fields: [{ name: 'BRAVE_API_KEY', label: 'API key', secret: true, placeholder: 'BSA…' }] },
    { id: 'context7', category: 'search', name: 'Context7', description: 'Up-to-date library docs and code examples for any package.', mark: 'C7', color: '#0F766E', ...npx('@upstash/context7-mcp'),
        fields: [{ name: 'CONTEXT7_API_KEY', label: 'API key (higher limits)', secret: true, placeholder: 'ctx7sk-…', optional: true }] },
    { id: 'exa', category: 'search', name: 'Exa', description: 'Neural web search and page contents. Signs in with Exa.', mark: 'EX', color: '#1F40ED', ...remote('https://mcp.exa.ai/mcp'), fields: [], signIn: true },
    { id: 'huggingface', category: 'search', name: 'Hugging Face', description: 'Models, datasets, Spaces and papers on the Hub. Signs in with Hugging Face.', mark: 'HF', color: '#FFD21E', ...remote('https://huggingface.co/mcp'), fields: [], signIn: true },
    // Core
    { id: 'git', category: 'core', name: 'Git', description: 'Read history, diffs and branches of a local repository. Needs uv.', mark: 'GI', color: '#F05032', command: 'uvx', args: ['mcp-server-git'], fields: [] },
    { id: 'sequential-thinking', category: 'core', name: 'Sequential Thinking', description: 'Step-by-step planning tool for long, multi-step problems.', mark: 'SQ', color: '#6366F1', ...npx('@modelcontextprotocol/server-sequential-thinking'), fields: [] },
    { id: 'time', category: 'core', name: 'Time', description: 'Current time and time zone conversions. Needs uv.', mark: 'TI', color: '#0EA5E9', command: 'uvx', args: ['mcp-server-time'], fields: [] }
];

export type McpScope = 'user' | 'project';

export interface McpCategoryGroup { readonly id: McpCategory; readonly label: string; readonly entries: readonly McpCatalogEntry[] }

/** Entries split into marketplace sections in MCP_CATEGORIES order; empty sections are dropped. */
export const groupByCategory = (entries: readonly McpCatalogEntry[]): McpCategoryGroup[] =>
    MCP_CATEGORIES.map(c => ({ id: c.id, label: c.label, entries: entries.filter(e => e.category === c.id) })).filter(g => g.entries.length > 0);

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
