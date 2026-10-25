import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, ConfirmDialog, KeybindingRegistry, NavigatableWidget, OpenerService, QuickInputService, open, type KeybindingContribution, type QuickPickItem } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { CommandRegistry, type Command, type CommandContribution } from '@theia/core/lib/common/command';
import { MenuModelRegistry, type MenuContribution, type MenuPath } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { GitService, type GitBranch } from '../../common/git/git.types';
import { DESTRUCTIVE_OPS, parseRemotes, parseStashList, parseStatusPaths, type GitOperation, type ResetMode } from '../../common/git/git-ops';
import { isValidBranchName, parseLog, relativeDate, remoteFileUrl } from '../../common/git/git.utils';
import { slugify } from '../../common/project-config/project-config.utils';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { EDITOR_COMMANDS } from '../editor/editor-menu.consts';
import { IngotGitContribution } from './git-contribution';
import { toGitUri } from './git-resource-resolver';
import { GIT_COMMIT_COMMANDS, GIT_FILE_COMMANDS, GIT_LOG_COMMIT_MENU, GIT_SHELF_DIR } from './git-actions.consts';
import { GIT_COMMANDS } from './git.browser-consts';

interface Target { readonly root: URI; readonly rootPath: string; readonly uri?: URI; readonly relative?: string }
type FileTarget = Target & { readonly uri: URI; readonly relative: string };

/**
 * Complete Git menus (IDEA-70 / IDEA-58): the same Git submenu in the editor, project tree and editor tab
 * right-click, plus the Git Log commit menu. Everything runs real git through GitService.run (validated
 * operations); anything that discards work or rewrites history asks first.
 */
@injectable()
export class IngotGitActionsContribution implements CommandContribution, MenuContribution, KeybindingContribution {

    @inject(GitService) protected readonly git: GitService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(SelectionService) protected readonly selection: SelectionService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ClipboardService) protected readonly clipboard: ClipboardService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(FileService) protected readonly files: FileService;
    @inject(FileDialogService) protected readonly dialogs: FileDialogService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(IngotBranchService) protected readonly branchService: IngotBranchService;
    @inject(IngotGitContribution) protected readonly gitLog: IngotGitContribution;

    // ---- targets ----

    /** The file a menu acts on: an explicit URI arg, the right-clicked tab, the tree/editor selection, or the current editor. */
    targetUri(args: unknown[]): URI | undefined {
        for (const arg of args.flat()) {
            if (arg instanceof URI) {
                return arg;
            }
            if (arg && typeof arg === 'object' && 'uri' in arg && (arg as { uri: unknown }).uri instanceof URI) {
                return (arg as { uri: URI }).uri;
            }
            if (arg instanceof Event) {
                const tabBar = this.shell.findTabBar(arg as MouseEvent);
                const title = tabBar && this.shell.findTitle(tabBar, arg as MouseEvent);
                const owner = title?.owner;
                if (owner && NavigatableWidget.is(owner)) {
                    return owner.getResourceUri();
                }
            }
        }
        const selected = this.selection.selection as unknown;
        const first = Array.isArray(selected) ? selected[0] : selected;
        if (first && typeof first === 'object' && 'uri' in first && (first as { uri: unknown }).uri instanceof URI) {
            return (first as { uri: URI }).uri;
        }
        return this.editors.currentEditor?.editor.uri;
    }

    target(args: unknown[]): Target | undefined {
        const uri = this.targetUri(args);
        const roots = this.workspace.tryGetRoots();
        const root = (uri && roots.find(r => r.resource.isEqualOrParent(uri))?.resource) ?? roots[0]?.resource;
        if (!root) {
            return undefined;
        }
        const relative = uri && root.isEqualOrParent(uri) && !uri.isEqual(root) ? root.relative(uri)?.toString() : undefined;
        return { root, rootPath: root.path.fsPath(), uri, relative };
    }

    protected fileTarget(args: unknown[]): FileTarget | undefined {
        const t = this.target(args);
        return t?.uri && t.relative ? t as FileTarget : undefined;
    }

    // ---- helpers ----

    protected errorText(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /** Runs one operation; destructive ones must have been confirmed by the caller (see `confirm`). */
    async run(t: Target, op: GitOperation, success?: string): Promise<string | undefined> {
        try {
            const { output } = await this.git.run(t.rootPath, op);
            if (success) {
                this.messages.info(success);
            }
            void this.branchService.refresh();
            return output;
        } catch (error) {
            this.messages.error(`Git: ${this.errorText(error)}`);
            return undefined;
        }
    }

    protected async confirm(title: string, msg: string, ok: string): Promise<boolean> {
        return !!await new ConfirmDialog({ title, msg, ok, cancel: 'Cancel' }).open();
    }

    protected async diff(t: Target, left: URI, right: URI, label: string): Promise<void> {
        await open(this.opener, DiffUris.encode(left, right, label));
    }

    protected async pickBranch(t: Target, title: string, filter: (b: GitBranch) => boolean = b => !b.current): Promise<GitBranch | undefined> {
        let branches: GitBranch[];
        try {
            branches = (await this.git.branches(t.rootPath)).filter(filter);
        } catch (error) {
            this.messages.error(`Git: ${this.errorText(error)}`);
            return undefined;
        }
        if (!branches.length) {
            this.messages.info('No other branches.');
            return undefined;
        }
        const picked = await this.quickInput.showQuickPick(branches.map(b => ({ label: b.name, description: b.remote ? 'remote' : b.current ? 'current' : 'local', branch: b })), { title, placeholder: 'Search branches' });
        return (picked as { branch?: GitBranch } | undefined)?.branch;
    }

    protected async pickCommit(t: Target, title: string, options: { path?: string; ref?: string } = {}): Promise<string | undefined> {
        const commits = await this.git.log(t.rootPath, 200, options.path).catch(() => []);
        if (!commits.length) {
            this.messages.info('No commits.');
            return undefined;
        }
        const picked = await this.quickInput.showQuickPick(commits.map(c => ({ label: c.subject, description: `${c.short} · ${c.author} · ${relativeDate(c.date)}`, id: c.hash })), { title, placeholder: 'Search commits' });
        return picked?.id;
    }

    protected async inputBranchName(title: string, value = ''): Promise<string | undefined> {
        const name = await this.quickInput.input({ title, value, placeHolder: 'feature/name', validateInput: async v => !v || isValidBranchName(v) ? undefined : 'Not a valid branch name' });
        return name?.trim() || undefined;
    }

    protected async pickResetMode(title: string): Promise<ResetMode | undefined> {
        const modes: (QuickPickItem & { mode: ResetMode })[] = [
            { label: 'Mixed', description: 'Keep changes in the working tree, unstage them', mode: 'mixed' },
            { label: 'Soft', description: 'Keep changes staged', mode: 'soft' },
            { label: 'Hard', description: 'Discard all changes (cannot be undone)', mode: 'hard' }
        ];
        return (await this.quickInput.showQuickPick(modes, { title, placeholder: 'Reset mode' }) as { mode?: ResetMode } | undefined)?.mode;
    }

    protected async saveText(text: string, name: string, what: string): Promise<void> {
        const where = await this.quickInput.showQuickPick([{ label: 'Copy to Clipboard', id: 'clipboard' }, { label: 'Save as File…', id: 'file' }], { title: what });
        if (where?.id === 'clipboard') {
            await this.clipboard.writeText(text);
            this.messages.info(`${what}: copied to the clipboard.`);
        } else if (where?.id === 'file') {
            const uri = await this.dialogs.showSaveDialog({ title: what, inputValue: name });
            if (uri) {
                await this.files.write(uri, text);
                this.messages.info(`${what}: saved ${uri.path.base}.`);
            }
        }
    }

    protected shelfDir(t: Target): URI {
        return t.root.resolve('.git').resolve(GIT_SHELF_DIR);
    }

    protected async changedPaths(t: Target, only?: string): Promise<string[]> {
        const output = await this.run(t, { kind: 'status' });
        const all = output === undefined ? [] : parseStatusPaths(output);
        return only ? all.filter(p => p === only) : all;
    }

    protected async currentBranch(t: Target): Promise<string | undefined> {
        const name = (await this.run(t, { kind: 'currentBranch' }))?.trim();
        return name && name !== 'HEAD' ? name : undefined;
    }

    protected async revParse(t: Target, ref: string): Promise<string | undefined> {
        return (await this.git.run(t.rootPath, { kind: 'revParse', ref }).catch(() => undefined))?.output.trim();
    }

    // ---- commands ----

    registerCommands(registry: CommandRegistry): void {
        const file = (command: Command, run: (t: FileTarget, args: unknown[]) => unknown) => registry.registerCommand(command, {
            isEnabled: (...args: unknown[]) => !!this.fileTarget(args),
            execute: (...args: unknown[]) => { const t = this.fileTarget(args); return t ? run(t, args) : undefined; }
        });
        const repo = (command: Command, run: (t: Target, args: unknown[]) => unknown) => registry.registerCommand(command, {
            isEnabled: (...args: unknown[]) => !!this.target(args),
            execute: (...args: unknown[]) => { const t = this.target(args); return t ? run(t, args) : undefined; }
        });
        const F = GIT_FILE_COMMANDS;

        file(F.commitFile, async t => {
            const message = await this.quickInput.input({ title: `Commit ${t.relative}`, prompt: 'Commit message', placeHolder: `Update ${t.uri.path.base}` });
            if (message?.trim()) {
                await this.editors.all.find(e => e.editor.uri.isEqual(t.uri))?.saveable.save();
                try {
                    await this.git.commitFile(t.rootPath, t.relative, message.trim());
                    this.messages.info(`Committed ${t.relative}.`);
                    void this.branchService.refresh();
                } catch (error) {
                    this.messages.error(`Git: ${this.errorText(error)}`);
                }
            }
        });
        file(F.add, t => this.run(t, { kind: 'add', paths: [t.relative] }, `Added ${t.relative}.`));
        file(F.rollback, async t => {
            if (await this.confirm('Rollback', `Discard all changes in ${t.relative} and restore it from HEAD?`, 'Rollback')) {
                await this.run(t, { kind: 'restorePaths', paths: [t.relative] }, `Rolled back ${t.relative}.`);
            }
        });
        file(F.revert, async t => {
            const commit = await this.pickCommit(t, `Revert a commit that changed ${t.uri.path.base}`, { path: t.relative });
            if (commit && await this.confirm('Revert Commit', `Create a new commit that reverts ${commit.slice(0, 7)}?`, 'Revert')) {
                await this.run(t, { kind: 'revert', commit }, `Reverted ${commit.slice(0, 7)}.`);
            }
        });
        repo(F.cherryPick, async t => {
            const branch = await this.pickBranch(t, 'Cherry-pick from branch');
            if (!branch) {
                return;
            }
            const candidates = parseLog(await this.run(t, { kind: 'logOnly', branch: branch.name }) ?? '');
            if (!candidates.length) {
                this.messages.info(`${branch.name} has no commits that are not on the current branch.`);
                return;
            }
            const picked = await this.quickInput.showQuickPick(candidates.map(c => ({ label: c.subject, description: `${c.short} · ${c.author} · ${relativeDate(c.date)}`, id: c.hash })),
                { title: `Cherry-pick from ${branch.name}`, placeholder: 'Commits not on the current branch' });
            if (picked && picked.id) {
                await this.run(t, { kind: 'cherryPick', commit: picked.id }, `Cherry-picked ${picked.id.slice(0, 7)}.`);
            }
        });
        file(F.showDiff, t => this.diff(t, toGitUri({ root: t.rootPath, ref: 'HEAD', path: t.relative }), t.uri, `${t.uri.path.base} (HEAD ↔ Working Tree)`));
        file(F.compareWithRevision, async t => {
            const ref = await this.pickCommit(t, `Compare ${t.uri.path.base} with Revision`, { path: t.relative });
            if (ref) {
                await this.diff(t, toGitUri({ root: t.rootPath, ref, path: t.relative }), t.uri, `${t.uri.path.base} (${ref.slice(0, 7)} ↔ Working Tree)`);
            }
        });
        const compareBranch = async (t: FileTarget) => {
            const branch = await this.pickBranch(t, `Compare ${t.uri.path.base} with Branch`);
            if (branch) {
                await this.diff(t, toGitUri({ root: t.rootPath, ref: branch.name, path: t.relative }), t.uri, `${t.uri.path.base} (${branch.name} ↔ Working Tree)`);
            }
        };
        file(F.compareWithBranch, compareBranch);
        file(F.branchCompare, compareBranch);
        file(F.compareWithLocal, async t => {
            const upstream = (await this.run(t, { kind: 'upstream' }))?.trim();
            if (!upstream) {
                this.messages.info('The current branch has no upstream to compare with.');
                return;
            }
            await this.diff(t, toGitUri({ root: t.rootPath, ref: upstream, path: t.relative }), t.uri, `${t.uri.path.base} (${upstream} ↔ Local)`);
        });
        file(F.showHistory, async t => (await this.gitLog.openView({ activate: true, reveal: true })).refresh(t.relative));
        file(F.showHistoryForSelection, async t => {
            const editor = this.editors.all.find(e => e.editor.uri.isEqual(t.uri))?.editor;
            const sel = editor?.selection;
            const start = (sel?.start.line ?? 0) + 1;
            const end = (sel?.end.line ?? (editor ? editor.document.lineCount - 1 : 0)) + 1;
            const output = await this.run(t, { kind: 'logLines', path: t.relative, start, end });
            const commits = (output ?? '').split('\n').filter(l => l.includes('\x1f')).map(l => l.split('\x1f'));
            if (!commits.length) {
                this.messages.info('No history for these lines.');
                return;
            }
            const picked = await this.quickInput.showQuickPick(commits.map(([hash, short, author, date, subject]) => ({ label: subject, description: `${short} · ${author} · ${relativeDate(date)}`, id: hash })),
                { title: `History of ${t.uri.path.base}:${start}-${end}` });
            if (picked?.id) {
                await this.diff(t, toGitUri({ root: t.rootPath, ref: `${picked.id}~1`, path: t.relative }), toGitUri({ root: t.rootPath, ref: picked.id, path: t.relative }), `${t.uri.path.base} (${picked.id.slice(0, 7)})`);
            }
        });
        file(F.annotate, async t => {
            await open(this.opener, t.uri);
            await this.commands.executeCommand(EDITOR_COMMANDS.toggleBlame.id);
        });
        file(F.showCurrentRevision, async t => {
            const row = (await this.run(t, { kind: 'lastCommit', path: t.relative }))?.trim();
            if (!row) {
                this.messages.info(`${t.relative} has no commits yet.`);
                return;
            }
            const [hash, author, date, subject] = row.split('\x1f');
            const action = await this.messages.info(`${t.uri.path.base} @ ${hash.slice(0, 8)} · ${author}, ${relativeDate(date)}: ${subject}`, 'Copy Revision');
            if (action) {
                await this.clipboard.writeText(hash);
            }
        });
        file(F.createPatch, async t => {
            const patch = await this.run(t, { kind: 'diff', paths: [t.relative] });
            if (patch !== undefined && !patch.trim()) {
                this.messages.info(`${t.relative} has no changes.`);
            } else if (patch) {
                await this.saveText(patch, `${t.uri.path.name}.patch`, 'Create Patch');
            }
        });
        repo(F.applyPatch, async t => {
            const from = await this.quickInput.showQuickPick([{ label: 'From File…', id: 'file' }, { label: 'From Clipboard', id: 'clipboard' }], { title: 'Apply Patch' });
            let patch: string | undefined;
            if (from?.id === 'clipboard') {
                patch = await this.clipboard.readText();
            } else if (from?.id === 'file') {
                const uri = await this.dialogs.showOpenDialog({ title: 'Apply Patch', canSelectFiles: true, canSelectFolders: false, filters: { Patches: ['patch', 'diff'] } });
                patch = uri ? (await this.files.read(Array.isArray(uri) ? uri[0] : uri)).value : undefined;
            }
            if (patch?.trim()) {
                await this.run(t, { kind: 'apply', patch }, 'Patch applied.');
            }
        });
        file(F.addToGitignore, () => this.commands.executeCommand(EDITOR_COMMANDS.addToGitignore.id));
        repo(F.stash, async t => {
            const scope = t.relative ? await this.quickInput.showQuickPick([{ label: 'All changes', id: 'all' }, { label: `Only ${t.relative}`, id: 'file' }], { title: 'Stash Changes' }) : { id: 'all' };
            if (!scope) {
                return;
            }
            const message = await this.quickInput.input({ title: 'Stash Changes', prompt: 'Message (optional)', placeHolder: 'WIP' });
            if (message === undefined) {
                return;
            }
            await this.run(t, { kind: 'stash', message, includeUntracked: scope.id === 'all', ...(scope.id === 'file' ? { paths: [t.relative!] } : {}) }, 'Changes stashed.');
        });
        repo(F.unstash, async t => {
            const entries = parseStashList(await this.run(t, { kind: 'stashList' }) ?? '');
            if (!entries.length) {
                this.messages.info('No stashes.');
                return;
            }
            const picked = await this.quickInput.showQuickPick(entries.map(e => ({ label: e.message, description: `stash@{${e.index}} · ${relativeDate(e.date)}`, index: e.index })), { title: 'Unstash' }) as { index?: number } | undefined;
            if (picked?.index === undefined) {
                return;
            }
            const action = await this.quickInput.showQuickPick([{ label: 'Pop', description: 'Apply and remove the stash', id: 'pop' }, { label: 'Apply', description: 'Apply and keep the stash', id: 'apply' }, { label: 'Drop', description: 'Delete the stash', id: 'drop' }], { title: `stash@{${picked.index}}` });
            if (action?.id === 'drop') {
                if (await this.confirm('Drop Stash', `Delete stash@{${picked.index}}? This cannot be undone.`, 'Drop')) {
                    await this.run(t, { kind: 'stashDrop', index: picked.index }, 'Stash dropped.');
                }
            } else if (action) {
                await this.run(t, { kind: 'stashApply', index: picked.index, pop: action.id === 'pop' }, action.id === 'pop' ? 'Stash popped.' : 'Stash applied.');
            }
        });
        repo(F.shelve, async t => {
            const paths = await this.changedPaths(t, t.relative && (await this.quickInput.showQuickPick([{ label: 'All changes', id: 'all' }, { label: `Only ${t.relative}`, id: 'file' }], { title: 'Shelve Changes' }))?.id === 'file' ? t.relative : undefined);
            if (!paths.length) {
                this.messages.info('Nothing to shelve.');
                return;
            }
            const name = await this.quickInput.input({ title: 'Shelve Changes', prompt: `Shelve ${paths.length} file(s) and restore them from HEAD`, value: `Shelved ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` });
            const slug = name && slugify(name);
            if (!slug) {
                return;
            }
            const patch = await this.run(t, { kind: 'diff', paths });
            if (!patch) {
                return;
            }
            await this.files.write(this.shelfDir(t).resolve(`${slug}.patch`), patch);
            await this.run(t, { kind: 'restorePaths', paths }, `Shelved ${paths.length} file(s) as "${name}".`);
        });
        repo(F.unshelve, async t => {
            const stat = await this.files.resolve(this.shelfDir(t)).catch(() => undefined);
            const shelves = (stat?.children ?? []).filter(c => c.name.endsWith('.patch'));
            if (!shelves.length) {
                this.messages.info('Nothing shelved.');
                return;
            }
            const picked = await this.quickInput.showQuickPick(shelves.map(s => ({ label: s.name.replace(/\.patch$/, ''), uri: s.resource })), { title: 'Unshelve' }) as { uri?: URI } | undefined;
            if (!picked?.uri) {
                return;
            }
            const patch = (await this.files.read(picked.uri)).value;
            if (await this.run(t, { kind: 'apply', patch }, 'Unshelved.') !== undefined) {
                await this.files.delete(picked.uri);
            }
        });

        repo(F.branchNew, () => this.commands.executeCommand(GIT_COMMANDS.newBranch.id));
        repo(F.branchCheckout, async t => {
            const branch = await this.pickBranch(t, 'Checkout Branch');
            if (branch) {
                try {
                    await this.git.checkout(t.rootPath, branch.name);
                    this.messages.info(`Checked out ${branch.name}.`);
                    void this.branchService.refresh();
                } catch (error) {
                    this.messages.error(`Git: ${this.errorText(error)}`);
                }
            }
        });
        repo(F.branchMerge, async t => {
            const branch = await this.pickBranch(t, 'Merge into Current Branch');
            if (branch) {
                await this.run(t, { kind: 'merge', branch: branch.name }, `Merged ${branch.name}.`);
            }
        });
        repo(F.branchRebase, async t => {
            const branch = await this.pickBranch(t, 'Rebase Current Branch onto');
            if (branch && await this.confirm('Rebase', `Rebase the current branch onto ${branch.name}? This rewrites its commits.`, 'Rebase')) {
                await this.run(t, { kind: 'rebase', onto: branch.name }, `Rebased onto ${branch.name}.`);
            }
        });
        repo(F.branchRename, async t => {
            const branch = await this.pickBranch(t, 'Rename Branch', b => !b.remote);
            const to = branch && await this.inputBranchName(`Rename ${branch.name}`, branch.name);
            if (branch && to && to !== branch.name) {
                await this.run(t, { kind: 'renameBranch', from: branch.name, to }, `Renamed ${branch.name} to ${to}.`);
            }
        });
        repo(F.branchDelete, async t => {
            const branch = await this.pickBranch(t, 'Delete Branch', b => !b.remote && !b.current);
            if (!branch || !await this.confirm('Delete Branch', `Delete local branch ${branch.name}?`, 'Delete')) {
                return;
            }
            try {
                await this.git.run(t.rootPath, { kind: 'deleteBranch', name: branch.name, force: false });
                this.messages.info(`Deleted ${branch.name}.`);
            } catch {
                if (await this.confirm('Branch Not Merged', `${branch.name} is not fully merged. Delete it anyway? Its unmerged commits may be lost.`, 'Force Delete')) {
                    await this.run(t, { kind: 'deleteBranch', name: branch.name, force: true }, `Deleted ${branch.name}.`);
                }
            }
            void this.branchService.refresh();
        });
        repo(F.pull, async t => {
            const how = await this.quickInput.showQuickPick([{ label: 'Merge', description: 'git pull --no-rebase', id: 'merge' }, { label: 'Rebase', description: 'git pull --rebase', id: 'rebase' }], { title: 'Pull' });
            if (how) {
                await this.run(t, { kind: 'pull', rebase: how.id === 'rebase' }, 'Pulled.');
            }
        });
        repo(F.fetch, t => this.run(t, { kind: 'fetch' }, 'Fetched all remotes.'));
        repo(F.push, async t => {
            const branch = await this.currentBranch(t);
            if (!branch) {
                this.messages.warn('HEAD is detached; check out a branch to push.');
                return;
            }
            const upstream = (await this.run(t, { kind: 'upstream' }))?.trim();
            if (await this.confirm('Push', upstream ? `Push ${branch} to ${upstream}?` : `Push ${branch} to origin and set it as upstream?`, 'Push')) {
                await this.run(t, { kind: 'push', setUpstream: !upstream }, `Pushed ${branch}.`);
            }
        });
        repo(F.resetHead, async t => {
            const ref = await this.quickInput.input({ title: 'Reset HEAD', prompt: 'Reset the current branch to (commit, tag, branch or HEAD~n)', value: 'HEAD' });
            const mode = ref?.trim() && await this.pickResetMode(`Reset HEAD to ${ref.trim()}`);
            if (ref && mode && await this.confirm('Reset HEAD', `git reset --${mode} ${ref.trim()}${mode === 'hard' ? '\n\nAll uncommitted changes will be lost.' : ''}`, 'Reset')) {
                await this.run(t, { kind: 'reset', ref: ref.trim(), mode }, `Reset (${mode}) to ${ref.trim()}.`);
            }
        });
        repo(F.manageRemotes, t => this.manageRemotes(t));
        file(F.openOnRemote, async t => {
            const remote = await this.git.remote(t.rootPath);
            const url = remote && remoteFileUrl(remote.url, remote.branch ?? remote.commit, t.relative);
            if (url) {
                this.windows.openNewWindow(url, { external: true });
            } else {
                this.messages.warn('This repository has no web remote (origin).');
            }
        });
        repo(F.copyRevision, async t => {
            const row = t.relative ? (await this.run(t, { kind: 'lastCommit', path: t.relative }))?.trim() : undefined;
            const hash = row?.split('\x1f')[0] || await this.revParse(t, 'HEAD');
            if (hash) {
                await this.clipboard.writeText(hash);
                this.messages.info(`Copied ${hash.slice(0, 8)}.`);
            }
        });

        this.registerCommitCommands(registry);
    }

    protected async manageRemotes(t: Target): Promise<void> {
        const remotes = parseRemotes(await this.run(t, { kind: 'remotes' }) ?? '');
        const picked = await this.quickInput.showQuickPick([
            { label: '+ Add Remote…', id: '' },
            ...remotes.map(r => ({ label: r.name, description: r.url, id: r.name }))
        ], { title: 'Manage Remotes' });
        if (!picked) {
            return;
        }
        if (!picked.id) {
            const name = await this.quickInput.input({ title: 'Add Remote', prompt: 'Name', value: remotes.length ? 'upstream' : 'origin' });
            const url = name?.trim() && await this.quickInput.input({ title: `Add Remote ${name}`, prompt: 'URL', placeHolder: 'git@github.com:owner/repo.git' });
            if (name && url) {
                await this.run(t, { kind: 'addRemote', name: name.trim(), url: url.trim() }, `Added remote ${name.trim()}.`);
            }
            return;
        }
        const action = await this.quickInput.showQuickPick([{ label: 'Edit URL…', id: 'edit' }, { label: 'Remove', id: 'remove' }], { title: picked.id });
        if (action?.id === 'edit') {
            const url = await this.quickInput.input({ title: `Remote ${picked.id}`, prompt: 'URL', value: 'description' in picked ? picked.description : '' });
            if (url?.trim()) {
                await this.run(t, { kind: 'setRemoteUrl', name: picked.id, url: url.trim() }, `Updated ${picked.id}.`);
            }
        } else if (action?.id === 'remove' && await this.confirm('Remove Remote', `Remove remote ${picked.id}?`, 'Remove')) {
            await this.run(t, { kind: 'removeRemote', name: picked.id }, `Removed ${picked.id}.`);
        }
    }

    // ---- Git Log commit menu ----

    protected commitArg(args: unknown[]): string | undefined {
        const hash = args.find((a): a is string => typeof a === 'string' && /^[0-9a-f]{7,64}$/i.test(a));
        return hash ?? this.gitLog.tryGetWidget()?.selectedHash;
    }

    protected async refreshLog(): Promise<void> {
        const widget = this.gitLog.tryGetWidget();
        await widget?.refresh(widget.filePath);
        void this.branchService.refresh();
    }

    protected registerCommitCommands(registry: CommandRegistry): void {
        const C = GIT_COMMIT_COMMANDS;
        const commit = (command: Command, run: (t: Target, hash: string) => unknown) => registry.registerCommand(command, {
            isEnabled: (...args: unknown[]) => !!this.commitArg(args) && !!this.workspace.tryGetRoots().length,
            execute: async (...args: unknown[]) => {
                const hash = this.commitArg(args);
                const t = this.target([this.workspace.tryGetRoots()[0]?.resource]);
                if (hash && t) {
                    await run(t, hash);
                }
            }
        });
        const short = (hash: string) => hash.slice(0, 7);
        const isHead = async (t: Target, hash: string) => (await this.revParse(t, 'HEAD')) === (await this.revParse(t, hash));
        const destructive = async (t: Target, op: GitOperation, title: string, msg: string, ok: string, success: string) => {
            if (DESTRUCTIVE_OPS.includes(op.kind) && !await this.confirm(title, msg, ok)) {
                return;
            }
            await this.run(t, op, success);
            await this.refreshLog();
        };

        commit(C.copyRevision, async (_t, hash) => { await this.clipboard.writeText(hash); this.messages.info(`Copied ${short(hash)}.`); });
        commit(C.createPatch, async (t, hash) => {
            const patch = await this.run(t, { kind: 'formatPatch', commit: hash });
            if (patch) {
                await this.saveText(patch, `${short(hash)}.patch`, 'Create Patch');
            }
        });
        commit(C.cherryPick, async (t, hash) => { await this.run(t, { kind: 'cherryPick', commit: hash }, `Cherry-picked ${short(hash)}.`); await this.refreshLog(); });
        commit(C.checkout, (t, hash) => destructive(t, { kind: 'checkoutRevision', commit: hash }, 'Checkout Revision', `Check out ${short(hash)}? HEAD will be detached.`, 'Checkout', `Checked out ${short(hash)} (detached HEAD).`));
        commit(C.showRepository, async (t, hash) => {
            const paths = (await this.run(t, { kind: 'lsTree', commit: hash }))?.split('\n').filter(Boolean) ?? [];
            const picked = await this.quickInput.showQuickPick(paths.map(p => ({ label: p.split('/').pop()!, description: p, id: p })), { title: `Repository at ${short(hash)}`, placeholder: 'Search files' });
            if (picked?.id) {
                await open(this.opener, toGitUri({ root: t.rootPath, ref: hash, path: picked.id }));
            }
        });
        commit(C.compareWithLocal, async (t, hash) => {
            const changes = await this.git.changes(t.rootPath, hash).catch(() => []);
            const picked = changes.length === 1 ? { id: changes[0].path } : await this.quickInput.showQuickPick(changes.map(ch => ({ label: ch.path, description: ch.status, id: ch.path })), { title: `Compare ${short(hash)} with Local` });
            if (picked?.id) {
                await this.diff(t, toGitUri({ root: t.rootPath, ref: hash, path: picked.id }), t.root.resolve(picked.id), `${picked.id.split('/').pop()} (${short(hash)} ↔ Local)`);
            }
        });
        commit(C.resetToHere, async (t, hash) => {
            const mode = await this.pickResetMode(`Reset current branch to ${short(hash)}`);
            if (mode) {
                await destructive(t, { kind: 'reset', ref: hash, mode }, 'Reset Current Branch', `git reset --${mode} ${short(hash)}${mode === 'hard' ? '\n\nAll uncommitted changes will be lost.' : ''}`, 'Reset', `Reset (${mode}) to ${short(hash)}.`);
            }
        });
        commit(C.revert, async (t, hash) => { await this.run(t, { kind: 'revert', commit: hash }, `Reverted ${short(hash)}.`); await this.refreshLog(); });
        commit(C.undo, async (t, hash) => {
            if (!await isHead(t, hash)) {
                this.messages.warn('Only the latest commit (HEAD) can be undone.');
                return;
            }
            await destructive(t, { kind: 'undoCommit' }, 'Undo Commit', `Undo ${short(hash)}? Its changes stay staged.`, 'Undo', `Undid ${short(hash)}.`);
        });
        commit(C.editMessage, async (t, hash) => {
            const current = (await this.git.log(t.rootPath, 400).catch(() => [])).find(c => c.hash === hash)?.subject ?? '';
            const message = await this.quickInput.input({ title: `Edit Commit Message (${short(hash)})`, value: current });
            if (!message?.trim() || message.trim() === current) {
                return;
            }
            const head = await isHead(t, hash);
            await destructive(t, { kind: 'reword', commit: hash, message: message.trim() }, 'Edit Commit Message',
                head ? `Amend ${short(hash)} with the new message?` : `Reword ${short(hash)}? Commits after it are rewritten.`, 'Edit', 'Commit message updated.');
        });
        const fixup = (squash: boolean) => async (t: Target, hash: string) => {
            const staged = ((await this.run(t, { kind: 'status' })) ?? '').split('\0').some(e => e.length > 3 && e[0] !== ' ' && e[0] !== '?');
            if (!staged) {
                this.messages.info('Stage the changes to fold into this commit first.');
                return;
            }
            await destructive(t, { kind: 'fixup', commit: hash, squash }, squash ? 'Squash Into' : 'Fixup',
                `${squash ? 'Squash' : 'Fold'} the staged changes into ${short(hash)}? Commits after it are rewritten.`, squash ? 'Squash' : 'Fixup', `${squash ? 'Squashed' : 'Fixed up'} ${short(hash)}.`);
        };
        commit(C.fixup, fixup(false));
        commit(C.squash, fixup(true));
        commit(C.drop, (t, hash) => destructive(t, { kind: 'dropCommit', commit: hash }, 'Drop Commit', `Remove ${short(hash)} from the branch? Commits after it are rewritten.`, 'Drop', `Dropped ${short(hash)}.`));
        commit(C.interactiveRebase, async (t, hash) => {
            const terminal = await this.terminals.newTerminal({ title: 'git rebase -i', cwd: t.root.toString(), destroyTermOnClose: true, useServerTitle: false });
            await terminal.start();
            this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'activate' });
            terminal.sendText(`git rebase -i ${hash}~1\r`);
        });
        commit(C.newBranch, async (t, hash) => {
            const name = await this.inputBranchName(`New Branch at ${short(hash)}`);
            const checkout = name && await this.quickInput.showQuickPick([{ label: 'Create and Checkout', id: 'yes' }, { label: 'Create Only', id: 'no' }], { title: name });
            if (name && checkout) {
                await this.run(t, { kind: 'createBranchAt', name, commit: hash, checkout: checkout.id === 'yes' }, `Created ${name}.`);
                await this.refreshLog();
            }
        });
        commit(C.newTag, async (t, hash) => {
            const name = await this.quickInput.input({ title: `New Tag at ${short(hash)}`, placeHolder: 'v1.0.0', validateInput: async v => !v || isValidBranchName(v) ? undefined : 'Not a valid tag name' });
            const message = name?.trim() ? await this.quickInput.input({ title: `Tag ${name}`, prompt: 'Message (optional; leave empty for a lightweight tag)' }) : undefined;
            if (name?.trim() && message !== undefined) {
                await this.run(t, { kind: 'createTag', name: name.trim(), commit: hash, message }, `Tagged ${short(hash)} as ${name.trim()}.`);
                await this.refreshLog();
            }
        });
        commit(C.goToParent, async (t, hash) => {
            const parent = (await this.run(t, { kind: 'parents', commit: hash }))?.trim().split(/\s+/)[1];
            if (parent) {
                await this.gitLog.tryGetWidget()?.selectHash(parent);
            } else {
                this.messages.info('This is the first commit.');
            }
        });
        commit(C.goToChild, async (t, hash) => {
            const widget = this.gitLog.tryGetWidget();
            const commits = widget?.loadedCommits ?? [];
            const index = commits.findIndex(c => c.hash === hash);
            for (let i = index - 1; i >= 0; i--) {
                const parents = (await this.run(t, { kind: 'parents', commit: commits[i].hash }))?.trim().split(/\s+/).slice(1) ?? [];
                if (parents.includes(hash)) {
                    await widget?.selectHash(commits[i].hash);
                    return;
                }
            }
            this.messages.info('No child commit in the loaded log.');
        });
    }

    // ---- menus ----

    /** The Git submenu, identical in the editor, project tree and editor tab menus. */
    registerGitSubmenu(menus: MenuModelRegistry, path: MenuPath): void {
        const F = GIT_FILE_COMMANDS;
        const groups: [string, Command[]][] = [
            ['1_commit', [F.commitFile, F.add, F.rollback, F.revert, F.cherryPick]],
            ['2_compare', [F.showDiff, F.compareWithRevision, F.compareWithBranch, F.compareWithLocal]],
            ['3_history', [F.showHistory, F.showHistoryForSelection, F.annotate, F.showCurrentRevision]],
            ['4_patch', [F.createPatch, F.applyPatch, F.addToGitignore]],
            ['5_stash', [F.stash, F.unstash, F.shelve, F.unshelve]],
            ['7_remote', [F.pull, F.fetch, F.push, F.resetHead, F.manageRemotes]],
            ['8_copy', [F.openOnRemote, F.copyRevision]]
        ];
        for (const [group, commands] of groups) {
            commands.forEach((command, i) => menus.registerMenuAction([...path, group], { commandId: command.id, label: command.label, order: String.fromCharCode(97 + i) }));
        }
        const branches = [...path, '6_branches', 'ingot_branches'];
        menus.registerSubmenu(branches, 'Branches', { sortString: 'a' });
        [F.branchNew, F.branchCheckout, F.branchMerge, F.branchRebase, F.branchCompare, F.branchRename, F.branchDelete]
            .forEach((command, i) => menus.registerMenuAction(branches, { commandId: command.id, label: command.label.replace(/…$/, '') + (command.label.endsWith('…') ? '…' : ''), order: String.fromCharCode(97 + i) }));
    }

    registerMenus(menus: MenuModelRegistry): void {
        const C = GIT_COMMIT_COMMANDS;
        const groups: [string, Command[]][] = [
            ['1_copy', [C.copyRevision, C.createPatch]],
            ['2_checkout', [C.cherryPick, C.checkout, C.showRepository, C.compareWithLocal]],
            ['3_reset', [C.resetToHere, C.revert, C.undo]],
            ['4_rewrite', [C.editMessage, C.fixup, C.squash, C.drop, C.interactiveRebase]],
            ['5_refs', [C.newBranch, C.newTag]],
            ['6_nav', [C.goToChild, C.goToParent]]
        ];
        for (const [group, commands] of groups) {
            commands.forEach((command, i) => menus.registerMenuAction([...GIT_LOG_COMMIT_MENU, group], { commandId: command.id, label: command.label, order: String.fromCharCode(97 + i) }));
        }
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({ command: GIT_FILE_COMMANDS.push.id, keybinding: 'ctrlcmd+shift+k' });
    }
}
