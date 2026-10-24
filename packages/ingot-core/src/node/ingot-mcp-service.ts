import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { DEFAULT_KEYCHAIN_SERVICE } from '../common/models/models.consts';
import { expandArgs, mcpSecretKey } from '../common/project-config/project-config.utils';
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

    @inject(KeyStoreService) protected readonly keyStore: KeyStoreService;

    protected readonly entries = new Map<string, Entry>();
    protected readonly keychain = process.env.INGOT_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;

    async setSecret(server: string, name: string, value: string): Promise<void> {
        if (!/^[A-Za-z0-9_.-]+$/.test(server) || !/^[A-Z0-9_]+$/i.test(name)) {
            throw new Error('Invalid MCP secret name.');
        }
        await this.keyStore.setPassword(this.keychain, mcpSecretKey(server, name), value);
        this.entries.get(server)?.connection.dispose();
        this.entries.delete(server);
    }

    async deleteSecrets(server: string, names: string[]): Promise<void> {
        await Promise.all(names.map(n => this.keyStore.deletePassword(this.keychain, mcpSecretKey(server, n)).catch(() => false)));
    }

    async sync(servers: McpServerConfig[], cwd: string): Promise<McpServerStatus[]> {
        const wanted = new Map(servers.map(s => [s.name, s]));
        for (const [name, entry] of this.entries) {
            const config = wanted.get(name);
            // Restart servers whose config changed, or that failed / waited for a secret, so a refresh retries them.
            if (!config || entry.key !== this.keyOf(config, cwd) || entry.status.state !== 'connected') {
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

    /** Reads the server's keychain secrets; returns the names that are still missing. */
    protected async resolveSecrets(config: McpServerConfig): Promise<{ env: Record<string, string>; missing: string[] }> {
        const env: Record<string, string> = {};
        const missing: string[] = [];
        for (const name of config.secretEnv ?? []) {
            const value = await this.keyStore.getPassword(this.keychain, mcpSecretKey(config.name, name)).catch(() => undefined);
            if (value) {
                env[name] = value;
            } else {
                missing.push(name);
            }
        }
        return { env, missing };
    }

    protected async start(base: McpServerConfig, cwd: string): Promise<void> {
        const secrets = await this.resolveSecrets(base);
        const env = { ...(base.env ?? {}), ...secrets.env };
        const config: McpServerConfig = { ...base, env, ...(base.args ? { args: expandArgs(base.args, env) } : {}) };
        const connection = new McpConnection(config, cwd);
        const entry: Entry = { key: this.keyOf(base, cwd), connection, status: { name: base.name, state: 'starting', tools: [] } };
        this.entries.set(base.name, entry);
        if (secrets.missing.length) {
            entry.status = { name: base.name, state: 'needs-auth', tools: [], missingSecrets: secrets.missing };
            return;
        }
        try {
            await connection.connect();
            const tools = await connection.listTools();
            const resources = await connection.countResources();
            entry.status = { name: base.name, state: 'connected', tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), resources, output: connection.output };
        } catch (error) {
            connection.dispose();
            entry.status = { name: base.name, state: 'error', tools: [], error: connection.clean(error instanceof Error ? error.message : String(error)), output: connection.output };
        }
    }
}
