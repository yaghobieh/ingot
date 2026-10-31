import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { AgentStore } from '../agents/agent-store';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { CodebaseIndexStore } from '../codebase-index/codebase-index-store';
import { INDEX_COMMANDS, INDEX_STATUS_ID, INDEX_STATUS_PRIORITY } from '../../common/codebase-index/codebase-index.consts';
import { indexStatusView } from '../../common/codebase-index/codebase-index.utils';

const BRANCH_ID = 'ingot-branch';
const AGENTS_ID = 'ingot-agents-active';

/** Status bar from the design reference: branch, index state and active agents on the left (IDEA-13). */
@injectable()
export class IngotStatusBarContribution implements FrontendApplicationContribution {

    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(IngotBranchService) protected readonly branches: IngotBranchService;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(CodebaseIndexStore) protected readonly index: CodebaseIndexStore;

    onStart(): void {
        this.branches.onDidChange(() => this.updateBranch());
        this.agents.onDidChange(() => this.updateAgents());
        this.index.onDidChange(() => this.updateIndex());
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

    /** IDEA-260: the codebase index of the first root: progress while indexing, "Index ready" after; a click rebuilds. */
    protected updateIndex(): void {
        const status = this.index.enabled ? this.index.primary : undefined;
        if (!status) {
            this.statusBar.removeElement(INDEX_STATUS_ID);
            return;
        }
        const view = indexStatusView(status);
        this.statusBar.setElement(INDEX_STATUS_ID, {
            text: view.text, tooltip: view.tooltip, className: view.className, alignment: StatusBarAlignment.LEFT, priority: INDEX_STATUS_PRIORITY,
            command: INDEX_COMMANDS.rebuild.id
        });
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
