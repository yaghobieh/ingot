import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { breadcrumbs } from '../../common/vcs/vcs.utils';
import { IngotBranchService } from '../vcs/ingot-branch-service';

const BREADCRUMBS_ID = 'ingot-breadcrumbs';
const BRANCH_ID = 'ingot-branch';
const SEPARATOR = ' › ';

/** JetBrains New UI status bar: breadcrumbs on the left, Git branch on the right (IDEA-13). */
@injectable()
export class IngotStatusBarContribution implements FrontendApplicationContribution {

    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(IngotBranchService) protected readonly branches: IngotBranchService;

    onStart(): void {
        this.editors.onCurrentEditorChanged(() => this.updateBreadcrumbs());
        this.workspace.onWorkspaceChanged(() => this.updateBreadcrumbs());
        this.branches.onDidChange(() => this.updateBranch());
        this.updateBreadcrumbs();
        this.updateBranch();
    }

    protected updateBreadcrumbs(): void {
        const [root] = this.workspace.tryGetRoots();
        if (!root) {
            this.statusBar.removeElement(BREADCRUMBS_ID);
            return;
        }
        const editor = this.editors.currentEditor;
        const parts = editor
            ? breadcrumbs(root.resource.path.toString(), root.resource.path.base, editor.editor.uri.path.toString())
            : [root.resource.path.base];
        this.statusBar.setElement(BREADCRUMBS_ID, {
            text: parts.join(SEPARATOR),
            tooltip: editor?.editor.uri.path.fsPath() ?? root.resource.path.fsPath(),
            alignment: StatusBarAlignment.LEFT,
            priority: 1000,
            className: 'ingot-status-breadcrumbs',
            command: 'revealInExplorer'
        });
    }

    protected updateBranch(): void {
        const branch = this.branches.branch;
        if (!branch) {
            this.statusBar.removeElement(BRANCH_ID);
            return;
        }
        this.statusBar.setElement(BRANCH_ID, {
            text: `$(git-branch) ${branch}`,
            tooltip: `Git branch: ${branch}`,
            alignment: StatusBarAlignment.RIGHT,
            priority: -1000,
            className: 'ingot-status-branch',
            command: 'scmView:toggle'
        });
    }
}
