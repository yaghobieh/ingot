import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { DATA_SOURCE_FILES, DATA_SOURCE_LABELS } from '../../common/tool-windows/tool-windows.consts';
import type { DataSource, ProjectFile } from '../../common/tool-windows/tool-windows.types';
import { detectDataSources } from '../../common/tool-windows/tool-windows.utils';
import { DATABASE_WIDGET_ID, TOOL_WINDOW_COMMANDS } from './tool-windows.consts';

/** Database tool window: the databases this project uses, found from compose, Prisma and .env files (IDEA-61). */
@injectable()
export class IngotDatabaseWidget extends ReactWidget {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    protected sources: DataSource[] = [];
    protected loading = true;

    @postConstruct()
    protected init(): void {
        this.id = DATABASE_WIDGET_ID;
        this.title.label = 'Database';
        this.title.caption = 'Database';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-database';
        this.addClass('ingot-toolwindow');
        this.node.tabIndex = 0;
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.refresh()));
        this.refresh();
    }

    async refresh(): Promise<void> {
        this.loading = true;
        this.update();
        const found: ProjectFile[] = [];
        for (const root of this.workspace.tryGetRoots()) {
            const children = (await this.files.resolve(root.resource).catch(() => undefined))?.children ?? [];
            const sqlite = children.filter(c => c.isFile && /\.(db|sqlite3?)$/.test(c.name)).map(c => c.name);
            for (const rel of [...DATA_SOURCE_FILES, ...sqlite]) {
                const uri = root.resource.resolve(rel);
                if (sqlite.includes(rel)) {
                    found.push({ path: rel, content: '' });
                    continue;
                }
                const content = await this.files.read(uri).then(c => c.value).catch(() => undefined);
                if (content !== undefined) {
                    found.push({ path: rel, content });
                }
            }
        }
        this.sources = detectDataSources(found);
        this.loading = false;
        this.update();
    }

    protected openSource(ds: DataSource): void {
        const [root] = this.workspace.tryGetRoots();
        if (root) {
            open(this.opener, root.resource.resolve(ds.source));
        }
    }

    protected render(): React.ReactNode {
        return <div className='ingot-tw'>
            <div className='ingot-tw-header'>
                <span className='ingot-tw-title'>Database</span>
                <button type='button' className='ingot-tw-icon-button' title='Refresh' aria-label='Refresh data sources' onClick={() => this.refresh()}>
                    <span className='codicon codicon-refresh' />
                </button>
            </div>
            {this.loading && <div className='ingot-tw-empty'>Looking for data sources…</div>}
            {!this.loading && !this.sources.length && <div className='ingot-tw-empty'>
                No data sources found in docker compose, Prisma or .env files.
                <button type='button' className='ingot-tw-link' onClick={() => this.commands.executeCommand(TOOL_WINDOW_COMMANDS.mcp.id)}>Connect a database through an MCP server</button>
            </div>}
            {!this.loading && this.sources.length > 0 && <ul className='ingot-tw-list' id='ingot-database-list'>
                {this.sources.map(ds => (
                    <li key={`${ds.kind}:${ds.name}`} className='ingot-tw-row' title={`Found in ${ds.source}`} onDoubleClick={() => this.openSource(ds)}>
                        <span className={`ingot-db-kind ingot-db-${ds.kind}`}>{DATA_SOURCE_LABELS[ds.kind]}</span>
                        <span className='ingot-tw-name'>{ds.name}</span>
                        <span className='ingot-tw-detail'>{ds.detail ? `${ds.detail} · ` : ''}{ds.source}</span>
                    </li>
                ))}
            </ul>}
        </div>;
    }
}
