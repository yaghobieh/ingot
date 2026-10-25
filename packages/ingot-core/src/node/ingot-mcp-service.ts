import { injectable } from '@theia/core/shared/inversify';
import { MAX_TOOL_RESULT_CHARS } from '../common/project-config/project-config.consts';
import type { McpServerConfig, McpServerStatus, McpService, McpToolResult } from '../common/project-config/project-config.types';
import { McpConnection } from './mcp-connection';

interface Entry {
    readonly key: string;
    readonly connection: McpConnection;
    status: McpServerStatus;
}

/** Runs the MCP servers the user enabled (IDEA-31). Project servers never start until enabled in the UI. */
@injectable()
export class IngotMcpService implements McpService {

    protected readonly entries = new Map<string, Entry>();

    async sync(servers: McpServerConfig[], cwd: string): Promise<McpServerStatus[]> {
        const wanted = new Map(servers.map(s => [s.name, s]));
        for (const [name, entry] of this.entries) {
            const config = wanted.get(name);
            if (!config || entry.key !== this.keyOf(config, cwd)) {
                entry.connection.dispose();
                this.entries.delete(name);
            }
        }
        await Promise.all(servers.filter(s => !this.entries.has(s.name)).map(s => this.start(s, cwd)));
        return this.status();
    }

    async status(): Promise<McpServerStatus[]> {
        return [...this.entries.values()].map(e => e.status);
    }

    async callTool(server: string, tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
        const entry = this.entries.get(server);
        if (!entry || entry.status.state !== 'connected') {
            return { text: `MCP server "${server}" is not connected.`, isError: true };
        }
        try {
            const result = await entry.connection.callTool(tool, args);
            return { text: result.text.slice(0, MAX_TOOL_RESULT_CHARS), isError: result.isError };
        } catch (error) {
            return { text: entry.connection.clean(error instanceof Error ? error.message : String(error)), isError: true };
        }
    }

    protected keyOf(config: McpServerConfig, cwd: string): string {
        return JSON.stringify([config, cwd]);
    }

    protected async start(config: McpServerConfig, cwd: string): Promise<void> {
        const connection = new McpConnection(config, cwd);
        const entry: Entry = { key: this.keyOf(config, cwd), connection, status: { name: config.name, state: 'starting', tools: [] } };
        this.entries.set(config.name, entry);
        try {
            await connection.connect();
            const tools = await connection.listTools();
            entry.status = { name: config.name, state: 'connected', tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
        } catch (error) {
            connection.dispose();
            entry.status = { name: config.name, state: 'error', tools: [], error: connection.clean(error instanceof Error ? error.message : String(error)) };
        }
    }
}
