import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, ApplicationShell, ConfirmDialog, KeybindingRegistry, QuickInputService, WidgetManager, open, OpenerService, type WidgetFactory } from '@theia/core/lib/browser';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { GitService, type GitCommit, type GitFileChange } from '../../common/git/git.types';
import { GIT_FILE_COMMANDS } from '../git/git-actions.consts';
import { toGitUri } from '../git/git-resource-resolver';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { COMMIT_COMMANDS, DEFAULT_CHANGELIST, DIFF_WIDGET_ID, LOCAL_CHANGES_CONTEXT_MENU, LOCAL_CHANGES_FOCUS, LOCAL_CHANGES_LABEL, LOCAL_CHANGES_WIDGET_ID } from './commit.consts';
import { IngotDiffWidget, type DiffWidgetOptions } from './ingot-diff-widget';
import { LocalChangesModel } from './local-changes-model';
import { LocalChangesWidget } from './local-changes-widget';
import { PushDialog } from './push-dialog';

const asPaths = (arg: unknown, fallback: readonly string[]): string[] =>
    typeof arg === 'string' ? [arg] : Array.isArray(arg) && arg.every(a => typeof a === 'string') && arg.length ? [...arg] : [...fallback];

/** Commit tool window (⌘K), diff viewer and Push dialog (⇧⌘K) — IDEA-74. */
@injectable()
export class IngotCommitContribution extends AbstractViewContribution<LocalChangesWidget> {

    @inject(LocalChangesModel) protected readonly model: LocalChangesModel;
    @inject(GitService) protected readonly git: GitService;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(ApplicationShell) protected readonly appShell: ApplicationShell;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(IngotBranchService) protected readonly branchService: IngotBranchService;

    constructor() {
        super({ widgetId: LOCAL_CHANGES_WIDGET_ID, widgetName: LOCAL_CHANGES_LABEL, defaultWidgetOptions: { area: 'left', rank: 150 }, toggleCommandId: COMMIT_COMMANDS.toggle.id });
    }

    protected selection(arg: unknown): string[] {
        return asPaths(arg, this.tryGetWidget()?.selection ?? []);
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        const C = COMMIT_COMMANDS;
        registry.registerCommand(C.commit, {
            execute: async () => {
                const widget = await this.openView({ activate: true, reveal: true });
                await this.model.refresh();
                widget.focusMessage();
            }
        });
        registry.registerCommand({ id: 'ingot.commit.submit', label: 'Commit Selected Changes' }, {
            execute: async () => (await this.openView({ activate: false, reveal: true })).commit(false)
        });
        registry.registerCommand(C.commitAndPush, { execute: async () => (await this.openView({ activate: true, reveal: true })).commit(true) });
        registry.registerCommand(C.push, { execute: () => this.push() });
        registry.registerCommand(C.refresh, { execute: () => this.model.refresh() });
        registry.registerCommand(C.showDiff, {
            execute: (arg?: unknown) => {
                const path = this.selection(arg)[0] ?? this.model.entries[0]?.path;
                return path ? this.showDiff(path) : this.messages.info('No local changes.');
            }
        });
        registry.registerCommand(C.rollback, { execute: (arg?: unknown) => this.rollback(this.selection(arg)) });
        registry.registerCommand(C.jumpToSource, {
            execute: async (arg?: unknown) => {
                for (const path of this.selection(arg)) {
                    const uri = this.model.uriOf(path);
                    if (uri) {
                        await this.editors.open(uri, { mode: 'activate' });
                    }
                }
            }
        });
        registry.registerCommand(C.moveToChangelist, { execute: (arg?: unknown) => this.moveToChangelist(this.selection(arg)) });
        registry.registerCommand(C.addToGitignore, {
            execute: async (arg?: unknown) => {
                for (const path of this.selection(arg)) {
                    await registry.executeCommand(GIT_FILE_COMMANDS.addToGitignore.id, this.model.uriOf(path));
                }
                await this.model.refresh();
            }
        });
        registry.registerCommand(C.delete, {
            execute: async (arg?: unknown) => {
                const uris = this.selection(arg).map(p => this.model.uriOf(p)).filter(u => !!u);
                if (uris.length) {
                    await registry.executeCommand('file.delete', uris);
                    await this.model.refresh();
                }
            }
        });
        registry.registerCommand({ id: 'ingot.commit.messageHistory', label: 'Commit Message History…', category: 'Git' }, {
            execute: async () => {
                const messages = await this.model.recentMessages();
                const picked = await this.quickInput.showQuickPick(messages.map(m => ({ label: m.split('\n')[0], detail: m.includes('\n') ? m : undefined, message: m })),
                    { title: 'Commit Message History', placeholder: messages.length ? 'Pick a recent message' : 'No recent messages' });
                const widget = this.tryGetWidget();
                if (picked && widget) {
                    widget.message = (picked as { message: string }).message;
                    widget.update();
                    widget.focusMessage();
                }
            }
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        const C = COMMIT_COMMANDS;
        const add = (group: string, items: { id: string; label: string }[]) =>
            items.forEach((c, i) => menus.registerMenuAction([...LOCAL_CHANGES_CONTEXT_MENU, group], { commandId: c.id, label: c.label, order: String(i) }));
        add('1_diff', [C.showDiff, C.jumpToSource]);
        add('2_change', [C.rollback, C.moveToChangelist]);
        add('3_file', [C.addToGitignore, C.delete]);
        add('4_commit', [C.commit, C.refresh]);
    }

    override registerKeybindings(keybindings: KeybindingRegistry): void {
        super.registerKeybindings(keybindings);
        const when = LOCAL_CHANGES_FOCUS;
        keybindings.registerKeybindings(
            { command: COMMIT_COMMANDS.showDiff.id, keybinding: 'ctrlcmd+d', when },
            { command: COMMIT_COMMANDS.jumpToSource.id, keybinding: 'f4', when },
            { command: 'ingot.commit.submit', keybinding: 'ctrlcmd+enter', when },
            { command: COMMIT_COMMANDS.rollback.id, keybinding: 'ctrlcmd+alt+z', when },
            { command: COMMIT_COMMANDS.refresh.id, keybinding: 'ctrlcmd+r', when }
        );
    }

    async showDiff(path: string): Promise<IngotDiffWidget> {
        const existing = this.appShell.widgets.find(w => w instanceof IngotDiffWidget) as IngotDiffWidget | undefined;
        if (existing) {
            await existing.showFile(path);
            await this.appShell.activateWidget(existing.id);
            return existing;
        }
        const widget = await this.widgets.getOrCreateWidget<IngotDiffWidget>(DIFF_WIDGET_ID, { path } satisfies DiffWidgetOptions);
        if (!widget.isAttached) {
            await this.appShell.addWidget(widget, { area: 'main' });
        }
        await this.appShell.activateWidget(widget.id);
        return widget;
    }

    protected async rollback(paths: string[]): Promise<void> {
        const root = this.model.root;
        const entries = this.model.entries.filter(e => paths.includes(e.path));
        const tracked = entries.filter(e => e.status !== 'untracked' && e.status !== 'added');
        if (!root || !tracked.length) {
            this.messages.info(entries.length ? 'New files have nothing to roll back to. Use Delete to remove them.' : 'Select changed files to roll back.');
            return;
        }
        const ok = await new ConfirmDialog({
            title: 'Rollback Changes',
            msg: `Discard local changes in ${tracked.length === 1 ? tracked[0].path : `${tracked.length} files`}? This cannot be undone.`,
            ok: 'Rollback', cancel: 'Cancel'
        }).open();
        if (!ok) {
            return;
        }
        try {
            await this.git.run(root, { kind: 'restorePaths', paths: tracked.flatMap(e => e.oldPath ? [e.path, e.oldPath] : [e.path]) });
            this.messages.info(`Rolled back ${tracked.length} file${tracked.length === 1 ? '' : 's'}.`);
        } catch (error) {
            this.messages.error(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await this.model.refresh();
    }

    protected async moveToChangelist(paths: string[]): Promise<void> {
        if (!paths.length) {
            this.messages.info('Select files to move.');
            return;
        }
        const NEW = '\u0000new';
        const items = [...this.model.changelistNames.map(name => ({ label: name, id: name })), { label: '$(add) New Changelist…', id: NEW }];
        const picked = await this.quickInput.showQuickPick(items, { title: 'Move to Another Changelist' });
        let name = picked?.id;
        if (name === NEW) {
            name = (await this.quickInput.input({ title: 'New Changelist', prompt: 'Changelist name' }))?.trim();
        }
        if (name) {
            this.model.moveToChangelist(paths, name || DEFAULT_CHANGELIST);
        }
    }

    protected async push(): Promise<void> {
        const root = this.model.root;
        const rootUri = this.model.rootUri;
        if (!root || !rootUri) {
            this.messages.info('Open a project first.');
            return;
        }
        const dialog = new PushDialog({
            git: this.git, root, repoName: rootUri.path.base,
            openCommitFileDiff: (commit: GitCommit, change: GitFileChange) => this.openCommitFileDiff(root, commit, change),
            confirmForce: target => new ConfirmDialog({
                title: 'Force Push',
                msg: `Force push to ${target}? Remote commits that are not on your branch will be overwritten (with lease: only if nobody pushed since your last fetch).`,
                ok: 'Force Push', cancel: 'Cancel'
            }).open().then(r => !!r)
        });
        const request = await dialog.open();
        if (!request) {
            return;
        }
        try {
            await this.git.run(root, { kind: 'pushTo', ...request });
            this.messages.info(`Pushed ${request.localBranch} to ${request.remote}/${request.remoteBranch}.`);
        } catch (error) {
            this.messages.error(`Push failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await this.branchService.refresh();
    }

    protected async openCommitFileDiff(root: string, commit: GitCommit, change: GitFileChange): Promise<void> {
        const left = toGitUri({ root, ref: `${commit.hash}~1`, path: change.oldPath ?? change.path });
        const right = toGitUri({ root, ref: commit.hash, path: change.path });
        await open(this.opener, DiffUris.encode(left, right, `${change.path} (${commit.short})`));
    }
}

export const createDiffWidgetFactory = (create: (options: DiffWidgetOptions) => IngotDiffWidget): WidgetFactory => ({
    id: DIFF_WIDGET_ID,
    createWidget: (options: DiffWidgetOptions) => create(options) as unknown as import('@theia/core/lib/browser').Widget
});
