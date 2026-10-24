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

/** One-click MCP servers (IDEA-62). Remote servers sign in through the browser via mcp-remote. */
export const MCP_CATALOG: readonly McpCatalogEntry[] = [
    { id: 'github', name: 'GitHub', description: 'Repositories, issues, pull requests and code search.', mark: 'GH', color: '#24292F', ...npx('@modelcontextprotocol/server-github'),
        fields: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', secret: true, placeholder: 'ghp_…' }] },
    { id: 'atlassian', name: 'Jira & Confluence', description: 'Atlassian issues, boards and pages. Signs in with your Atlassian account.', mark: 'AT', color: '#1868DB', ...remote('https://mcp.atlassian.com/v1/sse'), fields: [], signIn: true },
    { id: 'slack', name: 'Slack', description: 'Read channels and threads, post messages.', mark: 'SL', color: '#4A154B', ...npx('@modelcontextprotocol/server-slack'),
        fields: [{ name: 'SLACK_BOT_TOKEN', label: 'Bot token', secret: true, placeholder: 'xoxb-…' }, { name: 'SLACK_TEAM_ID', label: 'Workspace (team) ID', secret: false, placeholder: 'T0123…' }] },
    { id: 'postgres', name: 'Postgres', description: 'Read-only SQL queries and schema inspection.', mark: 'PG', color: '#336791', ...npx('@modelcontextprotocol/server-postgres', '${POSTGRES_URL}'),
        fields: [{ name: 'POSTGRES_URL', label: 'Connection string', secret: true, placeholder: 'postgresql://user:pass@localhost:5432/db' }] },
    { id: 'linear', name: 'Linear', description: 'Issues, projects and cycles. Signs in with your Linear account.', mark: 'LN', color: '#5E6AD2', ...remote('https://mcp.linear.app/sse'), fields: [], signIn: true },
    { id: 'notion', name: 'Notion', description: 'Search and edit pages and databases.', mark: 'N', color: '#191919', ...npx('@notionhq/notion-mcp-server'),
        fields: [{ name: 'NOTION_TOKEN', label: 'Integration token', secret: true, placeholder: 'ntn_…' }] },
    { id: 'figma', name: 'Figma', description: 'Read frames, components and styles from design files.', mark: 'FG', color: '#A259FF', ...npx('figma-developer-mcp', '--stdio'),
        fields: [{ name: 'FIGMA_API_KEY', label: 'Personal access token', secret: true, placeholder: 'figd_…' }] },
    { id: 'sentry', name: 'Sentry', description: 'Issues, events and releases. Signs in with your Sentry account.', mark: 'SE', color: '#362D59', ...remote('https://mcp.sentry.dev/mcp'), fields: [], signIn: true },
    { id: 'filesystem', name: 'Filesystem', description: 'Read and write files in the project folder.', mark: 'FS', color: '#3B6FD9', ...npx('@modelcontextprotocol/server-filesystem', '.'), fields: [] },
    { id: 'browser', name: 'Browser', description: 'Drive a real browser with Playwright: open pages, click, fill, screenshot.', mark: 'BR', color: '#2EAD33', ...npx('@playwright/mcp@latest'), fields: [] },
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
