import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { McpService, type McpServerConfig, type McpServerStatus, type McpToolResult } from '../../common/project-config/project-config.types';
import { ProjectConfigService } from './project-config-service';

const ENABLED_KEY = 'ingot.mcp.enabled:';

/** Tracks which MCP servers the user trusted per project and keeps the backend in sync (IDEA-31). */
@injectable()
export class IngotMcpClient {

    @inject(McpService) protected readonly service: McpService;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ProjectConfigService) protected readonly config: ProjectConfigService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    servers: readonly McpServerConfig[] = [];
    statuses: readonly McpServerStatus[] = [];
    protected enabled = new Set<string>();
    protected root?: URI;
    protected syncing?: Promise<void>;

    get connectedTools(): { server: string; name: string; description?: string; inputSchema?: unknown }[] {
        return this.statuses.filter(s => s.state === 'connected').flatMap(s => s.tools.map(t => ({ server: s.name, ...t })));
    }

    isEnabled(name: string): boolean {
        return this.enabled.has(name);
    }

    statusOf(name: string): McpServerStatus | undefined {
        return this.statuses.find(s => s.name === name);
    }

    /** Reloads the project's mcp.json and (re)starts the enabled servers. */
    async refresh(root: URI | undefined = this.workspace.tryGetRoots()[0]?.resource): Promise<void> {
        this.root = root;
        const config = await this.config.load(root);
        this.servers = config.mcpServers;
        this.enabled = new Set(root ? await this.storage.getData<string[]>(ENABLED_KEY + root.toString(), []) : []);
        await this.sync();
    }

    async setEnabled(name: string, enabled: boolean): Promise<void> {
        if (enabled) {
            this.enabled.add(name);
        } else {
            this.enabled.delete(name);
        }
        if (this.root) {
            await this.storage.setData(ENABLED_KEY + this.root.toString(), [...this.enabled]);
        }
        await this.sync();
    }

    callTool(server: string, tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
        return this.service.callTool(server, tool, args);
    }

    protected async sync(): Promise<void> {
        const wanted = this.servers.filter(s => this.enabled.has(s.name));
        this.statuses = wanted.map(s => ({ name: s.name, state: 'starting', tools: [] }));
        this.onDidChangeEmitter.fire();
        this.statuses = await this.service.sync(wanted, this.root?.path.fsPath() ?? '');
        this.onDidChangeEmitter.fire();
    }
}
