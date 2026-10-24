import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { McpService, type McpServerConfig, type McpServerStatus, type McpToolResult } from '../../common/project-config/project-config.types';
import { MCP_FILE } from '../../common/project-config/project-config.consts';
import { mergeByName, parseMcpJson, toMcpJson } from '../../common/project-config/project-config.utils';
import type { McpScope } from '../../common/mcp/mcp-catalog';
import { ProjectConfigService } from './project-config-service';

const ENABLED_KEY = 'ingot.mcp.enabled:';
const USER_DISABLED_KEY = 'ingot.mcp.userDisabled';
const PROJECT_DIR = '.ingot';

/**
 * MCP servers for the current window (IDEA-31, IDEA-62).
 * - User servers (`<config dir>/mcp.json`) run in every project unless switched off.
 * - Project servers (`.ingot/mcp.json` and imported config) stay off until trusted per project.
 * Secrets live in the OS keychain; config files only hold `${keychain}` placeholders.
 */
@injectable()
export class IngotMcpClient {

    @inject(McpService) protected readonly service: McpService;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ProjectConfigService) protected readonly config: ProjectConfigService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(FileService) protected readonly files: FileService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    /** All servers: project servers override user servers with the same name. */
    servers: readonly McpServerConfig[] = [];
    userServers: readonly McpServerConfig[] = [];
    projectServers: readonly McpServerConfig[] = [];
    statuses: readonly McpServerStatus[] = [];
    protected enabled = new Set<string>();
    protected userDisabled = new Set<string>();
    protected root?: URI;

    get connectedTools(): { server: string; name: string; description?: string; inputSchema?: unknown }[] {
        return this.statuses.filter(s => s.state === 'connected').flatMap(s => s.tools.map(t => ({ server: s.name, ...t })));
    }

    scopeOf(name: string): McpScope {
        return this.projectServers.some(s => s.name === name) ? 'project' : 'user';
    }

    isEnabled(name: string): boolean {
        return this.scopeOf(name) === 'project' ? this.enabled.has(name) : !this.userDisabled.has(name);
    }

    statusOf(name: string): McpServerStatus | undefined {
        return this.statuses.find(s => s.name === name);
    }

    protected async userFile(): Promise<URI> {
        return new URI(await this.env.getConfigDirUri()).resolve(MCP_FILE);
    }

    protected projectFile(): URI | undefined {
        return this.root?.resolve(PROJECT_DIR).resolve(MCP_FILE);
    }

    protected async readServers(uri: URI | undefined, source: McpServerConfig['source']): Promise<McpServerConfig[]> {
        if (!uri) {
            return [];
        }
        const text = await this.files.read(uri).then(c => c.value).catch(() => undefined);
        return text ? parseMcpJson(text, source) : [];
    }

    /** Reloads user and project mcp.json and (re)starts the enabled servers. */
    async refresh(root: URI | undefined = this.workspace.tryGetRoots()[0]?.resource): Promise<void> {
        this.root = root;
        const config = await this.config.load(root);
        this.projectServers = config.mcpServers;
        this.userServers = await this.readServers(await this.userFile(), 'user');
        this.servers = mergeByName(this.userServers, this.projectServers);
        this.enabled = new Set(root ? await this.storage.getData<string[]>(ENABLED_KEY + root.toString(), []) : []);
        this.userDisabled = new Set(await this.storage.getData<string[]>(USER_DISABLED_KEY, []));
        await this.sync();
    }

    async setEnabled(name: string, enabled: boolean): Promise<void> {
        if (this.scopeOf(name) === 'user') {
            if (enabled) {
                this.userDisabled.delete(name);
            } else {
                this.userDisabled.add(name);
            }
            await this.storage.setData(USER_DISABLED_KEY, [...this.userDisabled]);
        } else {
            if (enabled) {
                this.enabled.add(name);
            } else {
                this.enabled.delete(name);
            }
            if (this.root) {
                await this.storage.setData(ENABLED_KEY + this.root.toString(), [...this.enabled]);
            }
        }
        await this.sync();
    }

    /** Adds (or replaces) a server in the user or project mcp.json, stores its secrets in the keychain and starts it. */
    async addServer(config: McpServerConfig, scope: McpScope, secrets: Readonly<Record<string, string>>): Promise<void> {
        const file = scope === 'user' ? await this.userFile() : this.projectFile();
        if (!file) {
            throw new Error('Open a project to add a project MCP server.');
        }
        const existing = await this.readServers(file, scope === 'user' ? 'user' : 'ingot');
        await this.files.write(file, toMcpJson(mergeByName(existing, [config])));
        for (const [name, value] of Object.entries(secrets)) {
            if (value) {
                await this.service.setSecret(config.name, name, value);
            }
        }
        if (scope === 'project') {
            this.enabled.add(config.name);
            if (this.root) {
                await this.storage.setData(ENABLED_KEY + this.root.toString(), [...this.enabled]);
            }
        } else {
            this.userDisabled.delete(config.name);
            await this.storage.setData(USER_DISABLED_KEY, [...this.userDisabled]);
        }
        await this.refresh(this.root);
    }

    async removeServer(name: string): Promise<void> {
        const scope = this.scopeOf(name);
        const file = scope === 'user' ? await this.userFile() : this.projectFile();
        const server = this.servers.find(s => s.name === name);
        if (file) {
            const existing = await this.readServers(file, scope === 'user' ? 'user' : 'ingot');
            await this.files.write(file, toMcpJson(existing.filter(s => s.name !== name)));
        }
        await this.service.deleteSecrets(name, [...(server?.secretEnv ?? [])]);
        await this.refresh(this.root);
    }

    /** Saves the missing keychain secrets of a server and restarts it. */
    async authenticate(name: string, secrets: Readonly<Record<string, string>>): Promise<void> {
        for (const [key, value] of Object.entries(secrets)) {
            if (value) {
                await this.service.setSecret(name, key, value);
            }
        }
        await this.sync();
    }

    callTool(server: string, tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
        return this.service.callTool(server, tool, args);
    }

    async sync(): Promise<void> {
        const wanted = this.servers.filter(s => this.isEnabled(s.name));
        this.statuses = wanted.map(s => ({ name: s.name, state: 'starting', tools: [] }));
        this.onDidChangeEmitter.fire();
        this.statuses = await this.service.sync(wanted, this.root?.path.fsPath() ?? '');
        this.onDidChangeEmitter.fire();
    }
}
