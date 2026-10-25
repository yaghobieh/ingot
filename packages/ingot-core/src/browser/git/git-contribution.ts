import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, QuickInputService, type QuickPickItem, type QuickPickSeparator } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { GitService, type GitBranch } from '../../common/git/git.types';
import { isValidBranchName } from '../../common/git/git.utils';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { IngotGitLogWidget } from './git-log-widget';
import { GIT_COMMANDS, GIT_LOG_WIDGET_ID, GIT_LOG_WIDGET_LABEL } from './git.browser-consts';

type BranchItem = QuickPickItem & { branch?: GitBranch; action?: 'new' };

/** Branches popup (toolbar branch ▾) and the Git Log tool window (IDEA-32). */
@injectable()
export class IngotGitContribution extends AbstractViewContribution<IngotGitLogWidget> {

    @inject(GitService) protected readonly git: GitService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(IngotBranchService) protected readonly branchService: IngotBranchService;

    constructor() {
        super({ widgetId: GIT_LOG_WIDGET_ID, widgetName: GIT_LOG_WIDGET_LABEL, defaultWidgetOptions: { area: 'bottom' } });
    }

    protected get root(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    override registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(GIT_COMMANDS.branches, { execute: () => this.showBranches() });
        registry.registerCommand(GIT_COMMANDS.newBranch, { execute: () => this.newBranch() });
        registry.registerCommand(GIT_COMMANDS.log, { execute: async () => (await this.openView({ activate: true, reveal: true })).refresh() });
        registry.registerCommand(GIT_COMMANDS.fileHistory, {
            isEnabled: () => !!this.editors.currentEditor,
            execute: async () => {
                const uri = this.editors.currentEditor?.editor.uri;
                const root = this.workspace.tryGetRoots().find(r => uri && r.resource.isEqualOrParent(uri));
                const relative = uri && root ? root.resource.relative(uri)?.toString() : undefined;
                if (relative) {
                    (await this.openView({ activate: true, reveal: true })).refresh(relative);
                }
            }
        });
    }

    protected async run(action: () => Promise<void>, success: string): Promise<void> {
        try {
            await action();
            await this.branchService.refresh();
            this.messages.info(success);
        } catch (error) {
            this.messages.error(`Git: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async showBranches(): Promise<void> {
        const root = this.root;
        if (!root) {
            return;
        }
        let branches: GitBranch[];
        try {
            branches = await this.git.branches(root);
        } catch (error) {
            this.messages.error(`Git: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const describe = (b: GitBranch): string => [b.ahead ? `↑${b.ahead}` : '', b.behind ? `↓${b.behind}` : '', b.upstream ?? ''].filter(Boolean).join(' ');
        const toItem = (b: GitBranch): BranchItem => ({ label: `${b.current ? '✓ ' : ''}${b.name}`, description: describe(b), branch: b });
        const items: (BranchItem | QuickPickSeparator)[] = [
            { label: '+ New Branch…', action: 'new' },
            { type: 'separator', label: 'Local' },
            ...branches.filter(b => !b.remote).map(toItem),
            ...(branches.some(b => b.remote) ? [{ type: 'separator' as const, label: 'Remote' }, ...branches.filter(b => b.remote).map(toItem)] : [])
        ];
        const picked = await this.quickInput.showQuickPick(items, { title: 'Git Branches', placeholder: 'Search branches' }) as BranchItem | undefined;
        if (picked?.action === 'new') {
            await this.newBranch();
        } else if (picked?.branch && !picked.branch.current) {
            const name = picked.branch.name;
            await this.run(() => this.git.checkout(root, name), `Checked out ${name}.`);
        }
    }

    async newBranch(): Promise<void> {
        const root = this.root;
        if (!root) {
            return;
        }
        const name = await this.quickInput.input({
            title: 'New Branch', prompt: 'Create and check out a new branch from the current one', placeHolder: 'feature/name',
            validateInput: async value => (!value || isValidBranchName(value) ? undefined : 'Not a valid branch name')
        });
        if (name) {
            await this.run(() => this.git.createBranch(root, name), `Created and checked out ${name}.`);
        }
    }
}
