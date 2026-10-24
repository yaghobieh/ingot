import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileSearchService } from '@theia/file-search/lib/common/file-search-service';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { AgentStore } from '../agents/agent-store';
import { AGENT_COMMANDS } from '../agents/agents.consts';

const BRANCH_ID = 'ingot-branch';
const INDEX_ID = 'ingot-index';
const AGENTS_ID = 'ingot-agents-active';

/** Status bar from the design reference: branch, index state and active agents on the left (IDEA-13). */
@injectable()
export class IngotStatusBarContribution implements FrontendApplicationContribution {

    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(IngotBranchService) protected readonly branches: IngotBranchService;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(FileSearchService) protected readonly fileSearch: FileSearchService;

    onStart(): void {
        this.branches.onDidChange(() => this.updateBranch());
        this.agents.onDidChange(() => this.updateAgents());
        this.workspace.onWorkspaceChanged(() => this.updateIndex());
        this.updateBranch();
        this.updateAgents();
        this.updateIndex();
    }

    protected updateBranch(): void {
        const branch = this.branches.branch;
        if (!branch) {
            this.statusBar.removeElement(BRANCH_ID);
            return;
        }
        this.statusBar.setElement(BRANCH_ID, {
            text: branch, tooltip: `Git branch: ${branch}`, alignment: StatusBarAlignment.LEFT, priority: 1000,
            className: 'ingot-status-branch', command: 'scmView:toggle'
        });
    }

    /** "Indexing…" until the workspace file index answers a query, then "Index ready". */
    protected async updateIndex(): Promise<void> {
        await this.workspace.ready;
        const roots = this.workspace.tryGetRoots().map(r => r.resource.toString());
        if (!roots.length) {
            this.statusBar.removeElement(INDEX_ID);
            return;
        }
        this.statusBar.setElement(INDEX_ID, { text: 'Indexing…', alignment: StatusBarAlignment.LEFT, priority: 990, className: 'ingot-status-index' });
        try {
            await this.fileSearch.find('', { rootUris: roots, limit: 1 });
            this.statusBar.setElement(INDEX_ID, { text: 'Index ready', tooltip: 'Project files indexed for search', alignment: StatusBarAlignment.LEFT, priority: 990, className: 'ingot-status-index' });
        } catch {
            this.statusBar.setElement(INDEX_ID, { text: 'Index unavailable', alignment: StatusBarAlignment.LEFT, priority: 990, className: 'ingot-status-index' });
        }
    }

    protected updateAgents(): void {
        const count = this.agents.activeCount;
        if (!count) {
            this.statusBar.removeElement(AGENTS_ID);
            return;
        }
        this.statusBar.setElement(AGENTS_ID, {
            text: `${count} ${count === 1 ? 'agent' : 'agents'} active`, alignment: StatusBarAlignment.LEFT, priority: 980,
            className: 'ingot-status-agents', command: AGENT_COMMANDS.toggle.id
        });
    }
}
