import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, WidgetManager, type KeybindingContribution, type KeybindingRegistry, type WidgetFactory, type Widget } from '@theia/core/lib/browser';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { GitService } from '../../common/git/git.types';
import { LocalChangesModel } from '../commit/local-changes-model';
import { MergeConflictsDialog } from './merge-conflicts-dialog';
import { IngotMergeWidget, type MergeToolOptions } from './merge-tool-widget';
import { MERGE_COMMANDS, MERGE_FOCUS, MERGE_WIDGET_ID } from './merge.consts';

/** Conflicts dialog and three-pane merge tool (IDEA-33). */
@injectable()
export class IngotMergeContribution implements CommandContribution, KeybindingContribution {

    @inject(LocalChangesModel) protected readonly changes: LocalChangesModel;
    @inject(GitService) protected readonly git: GitService;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(MessageService) protected readonly messages: MessageService;

    protected get current(): IngotMergeWidget | undefined {
        return [this.shell.activeWidget, this.shell.currentWidget].find(w => w instanceof IngotMergeWidget) as IngotMergeWidget | undefined;
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(MERGE_COMMANDS.conflicts, { execute: () => this.showConflicts() });
        registry.registerCommand(MERGE_COMMANDS.open, { execute: (path?: unknown) => typeof path === 'string' ? this.openMerge(path) : this.showConflicts() });
        registry.registerCommand(MERGE_COMMANDS.acceptYours, { execute: () => this.current?.acceptSide('ours'), isEnabled: () => !!this.current });
        registry.registerCommand(MERGE_COMMANDS.acceptTheirs, { execute: () => this.current?.acceptSide('theirs'), isEnabled: () => !!this.current });
        registry.registerCommand(MERGE_COMMANDS.applyNonConflicting, { execute: () => this.current?.applyNonConflicting(), isEnabled: () => !!this.current });
        registry.registerCommand(MERGE_COMMANDS.nextConflict, { execute: () => this.current?.navigate(1), isEnabled: () => !!this.current });
        registry.registerCommand(MERGE_COMMANDS.previousConflict, { execute: () => this.current?.navigate(-1), isEnabled: () => !!this.current });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybindings(
            { command: MERGE_COMMANDS.nextConflict.id, keybinding: 'f7', when: MERGE_FOCUS },
            { command: MERGE_COMMANDS.previousConflict.id, keybinding: 'shift+f7', when: MERGE_FOCUS }
        );
    }

    async conflictedFiles(): Promise<string[]> {
        const root = this.changes.root;
        if (!root) {
            return [];
        }
        const out = (await this.git.run(root, { kind: 'conflicted' }).catch(() => ({ output: '' }))).output;
        return out.split('\0').filter(Boolean);
    }

    async showConflicts(): Promise<void> {
        const files = await this.conflictedFiles();
        if (!files.length) {
            this.messages.info('There are no merge conflicts.');
            return;
        }
        const root = this.changes.root!;
        const yours = (await this.git.run(root, { kind: 'currentBranch' }).catch(() => ({ output: '' }))).output.trim() || 'HEAD';
        const theirs = (await this.git.run(root, { kind: 'revParse', ref: 'MERGE_HEAD' }).catch(() => ({ output: '' }))).output.trim().slice(0, 8) || 'incoming';
        const action = await new MergeConflictsDialog(files, yours, theirs).open();
        if (!action) {
            return;
        }
        if (action.kind === 'merge') {
            await this.openMerge(action.paths[0], () => this.showConflicts());
            return;
        }
        await this.git.run(root, { kind: 'checkoutSide', side: action.kind, paths: action.paths });
        await this.git.run(root, { kind: 'add', paths: action.paths });
        await this.changes.refresh();
        if ((await this.conflictedFiles()).length) {
            await this.showConflicts();
        }
    }

    async openMerge(path: string, onResolved?: () => void): Promise<IngotMergeWidget> {
        const widget = await this.widgets.getOrCreateWidget<IngotMergeWidget>(MERGE_WIDGET_ID, { path } satisfies MergeToolOptions);
        if (onResolved) {
            widget.onResolved(onResolved);
        }
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }
}

export const createMergeWidgetFactory = (create: (options: MergeToolOptions) => IngotMergeWidget): WidgetFactory => ({
    id: MERGE_WIDGET_ID,
    createWidget: (options: MergeToolOptions) => create(options) as unknown as Widget
});
