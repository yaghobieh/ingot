import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AgentEventHooks } from './agent-event-hooks';

/** IDEA-287: Cursor's `workspaceOpen` hook, once for each folder the window opens (also folders added later). Observation only. */
@injectable()
export class WorkspaceOpenHooks implements FrontendApplicationContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(AgentEventHooks) protected readonly hooks: AgentEventHooks;

    protected readonly opened = new Set<string>();

    onStart(): void {
        void this.workspace.roots.then(() => this.fire());
        this.workspace.onWorkspaceChanged(() => this.fire());
    }

    protected fire(): void {
        for (const root of this.workspace.tryGetRoots().map(r => r.resource)) {
            const key = root.toString();
            if (!this.opened.has(key)) {
                this.opened.add(key);
                void this.hooks.run('workspaceOpen', root, {}, { workspace_folder: root.path.fsPath() }).catch(() => undefined);
            }
        }
    }
}
