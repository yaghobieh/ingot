import { inject, injectable } from '@theia/core/shared/inversify';
import { CommonCommands, ConfirmDialog, OpenerService, QuickInputService, open, type FrontendApplicationContribution, type QuickPickItem } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import { MenuModelRegistry, type MenuContribution, type MenuPath } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CONFIG_DIRS, RULES_DIR } from '../../common/project-config/project-config.consts';
import { GitService } from '../../common/git/git.types';
import { relativeDate, remoteFileUrl } from '../../common/git/git.utils';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { toGitUri } from '../git/git-resource-resolver';
import { IngotGitActionsContribution } from '../git/git-actions-contribution';
import { CALL_HIERARCHY_COMMAND, COMMAND_PALETTE, EDITOR_COMMANDS, EDITOR_MENU, EDITOR_SUBMENUS, MONACO_ACTIONS, SOURCE_DEFINITION_PLUGIN_COMMAND } from './editor-menu.consts';

interface EditorContext {
    readonly uri: URI;
    readonly root?: URI;
    readonly relative?: string;
    readonly line: number;
    readonly word?: string;
    readonly selection: string;
    readonly languageId: string;
    readonly editor: MonacoEditor;
}

type BlameDecorations = { ids: string[] };

/** Full editor right-click menu: navigation, AI, find, refactor, remote/history/Git, clipboard (IDEA-56). */
@injectable()
export class IngotEditorContextMenuContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(MenuModelRegistry) protected readonly menus: MenuModelRegistry;
    @inject(ClipboardService) protected readonly clipboard: ClipboardService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(FileService) protected readonly files: FileService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(GitService) protected readonly git: GitService;
    @inject(IngotAgentsContribution) protected readonly agents: IngotAgentsContribution;
    @inject(IngotGitActionsContribution) protected readonly gitActions: IngotGitActionsContribution;

    protected readonly blame = new Map<string, BlameDecorations>();
    protected pruning = false;

    onStart(): void {
        this.pruneForeignItems();
        this.menus.onDidChange(() => this.pruneForeignItems());
    }

    /** The reference menu is curated: drop default and plugin groups so nothing is listed twice. */
    protected pruneForeignItems(): void {
        if (this.pruning) {
            return;
        }
        const root = this.menus.getMenu(EDITOR_CONTEXT_MENU) as { children?: readonly { id: string }[]; removeNode?: (node: unknown) => void } | undefined;
        if (!root?.children || !root.removeNode) {
            return;
        }
        this.pruning = true;
        try {
            for (const child of [...root.children].filter(c => !c.id.startsWith('ingot_'))) {
                root.removeNode(child);
            }
        } finally {
            this.pruning = false;
        }
    }

    protected context(): EditorContext | undefined {
        const widget = this.editors.currentEditor;
        const editor = widget && MonacoEditor.get(widget);
        if (!editor) {
            return undefined;
        }
        const uri = editor.uri;
        const root = this.workspace.tryGetRoots().find(r => r.resource.isEqualOrParent(uri))?.resource;
        const control = editor.getControl();
        const position = control.getPosition();
        const model = control.getModel();
        const selection = control.getSelection();
        const word = position && model ? model.getWordAtPosition(position)?.word : undefined;
        return {
            uri, root, editor,
            relative: root ? root.relative(uri)?.toString() : undefined,
            line: position?.lineNumber ?? 1,
            word,
            selection: selection && model ? model.getValueInRange(selection) : '',
            languageId: model?.getLanguageId() ?? ''
        };
    }

    protected async runBuiltin(primary: string, fallback?: string): Promise<void> {
        const id = this.commands.getCommand(primary) ? primary : fallback;
        if (id) {
            await this.commands.executeCommand(id);
        }
    }

    protected async gitRun(action: () => Promise<void>, success?: string): Promise<void> {
        try {
            await action();
            if (success) {
                this.messages.info(success);
            }
        } catch (error) {
            this.messages.error(`Git: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected async openDiff(ctx: EditorContext, ref: string, label: string): Promise<void> {
        if (!ctx.root || !ctx.relative) {
            return;
        }
        const left = toGitUri({ root: ctx.root.path.fsPath(), ref, path: ctx.relative });
        await open(this.opener, DiffUris.encode(left, ctx.uri, `${ctx.uri.path.base} (${label} ↔ Working Tree)`));
    }

    protected async pickRevision(ctx: EditorContext, title: string): Promise<string | undefined> {
        if (!ctx.root || !ctx.relative) {
            return undefined;
        }
        const commits = await this.git.log(ctx.root.path.fsPath(), 100, ctx.relative);
        if (!commits.length) {
            this.messages.info('No history for this file yet.');
            return undefined;
        }
        const picked = await this.quickInput.showQuickPick(commits.map(commit => ({ label: commit.subject, description: `${commit.short} · ${commit.author} · ${relativeDate(commit.date)}`, id: commit.hash })), { title, placeholder: 'Search commits' });
        return picked?.id;
    }

    protected async toggleBlame(ctx: EditorContext): Promise<void> {
        const key = ctx.uri.toString();
        const control = ctx.editor.getControl();
        const existing = this.blame.get(key);
        if (existing) {
            control.deltaDecorations(existing.ids, []);
            this.blame.delete(key);
            return;
        }
        if (!ctx.root || !ctx.relative) {
            return;
        }
        const lines = await this.git.blame(ctx.root.path.fsPath(), ctx.relative);
        const model = control.getModel();
        const ids = control.deltaDecorations([], lines.filter(l => model && l.line <= model.getLineCount()).map(l => {
            const end = model!.getLineMaxColumn(l.line);
            return {
            range: { startLineNumber: l.line, startColumn: end, endLineNumber: l.line, endColumn: end },
            options: {
                showIfCollapsed: true,
                after: { content: `    ${l.author}, ${l.date ? relativeDate(l.date) : ''} · ${l.summary}`, inlineClassName: 'ingot-blame-annotation' }
            }
            };
        }));
        this.blame.set(key, { ids });
    }

    protected slug(text: string): string {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    }

    registerCommands(registry: CommandRegistry): void {
        const hasEditor = { isEnabled: () => !!this.context() };
        const withCtx = (run: (ctx: EditorContext) => unknown) => ({ ...hasEditor, execute: () => { const ctx = this.context(); return ctx ? run(ctx) : undefined; } });
        const inRepo = (run: (ctx: EditorContext & { root: URI; relative: string }) => unknown) => ({
            isEnabled: () => !!this.context()?.relative,
            execute: () => { const ctx = this.context(); return ctx?.root && ctx.relative ? run(ctx as EditorContext & { root: URI; relative: string }) : undefined; }
        });

        registry.registerCommand(EDITOR_COMMANDS.goToSourceDefinition, { execute: () => this.runBuiltin(SOURCE_DEFINITION_PLUGIN_COMMAND, MONACO_ACTIONS.definition) });
        registry.registerCommand(EDITOR_COMMANDS.findAllReferences, { execute: () => this.runBuiltin(MONACO_ACTIONS.references) });
        registry.registerCommand(EDITOR_COMMANDS.findAllImplementations, { execute: () => this.runBuiltin(MONACO_ACTIONS.implementation) });
        registry.registerCommand(EDITOR_COMMANDS.showCallHierarchy, { execute: () => this.runBuiltin(CALL_HIERARCHY_COMMAND) });

        const addSymbol = async (ctx: EditorContext, fresh: boolean): Promise<void> => {
            if (fresh) {
                await this.commands.executeCommand(AGENT_COMMANDS.newAgent.id);
            }
            const widget = await this.agents.openView({ activate: true, reveal: true });
            const symbol = ctx.selection.trim() && !ctx.selection.includes('\n') ? ctx.selection.trim() : ctx.word;
            widget.addContext(`@${ctx.relative ?? ctx.uri.path.base}:${ctx.line}${symbol ? ` ${symbol}` : ''}`);
        };
        registry.registerCommand(EDITOR_COMMANDS.addSymbolToChat, withCtx(ctx => addSymbol(ctx, false)));
        registry.registerCommand(EDITOR_COMMANDS.addSymbolToNewChat, withCtx(ctx => addSymbol(ctx, true)));
        registry.registerCommand(EDITOR_COMMANDS.createRule, {
            isEnabled: () => !!this.context()?.selection.trim() && !!this.workspace.tryGetRoots().length,
            execute: async () => {
                const ctx = this.context();
                const root = ctx?.root ?? this.workspace.tryGetRoots()[0]?.resource;
                if (!ctx || !root) {
                    return;
                }
                const name = await this.quickInput.input({ title: 'Create Rule', prompt: 'Name the rule; the selection becomes its example', placeHolder: 'prefer-optimistic-updates' });
                const slug = name && this.slug(name);
                if (!slug) {
                    return;
                }
                const uri = root.resolve(`${CONFIG_DIRS.ingot}/${RULES_DIR}/${slug}.md`);
                const body = `---\ndescription: ${name}\nglobs: ${ctx.relative ? `"**/*.${ctx.uri.path.ext.replace('.', '')}"` : '"**/*"'}\n---\n\n# ${name}\n\nFollow this pattern${ctx.relative ? ` (from ${ctx.relative}:${ctx.line})` : ''}:\n\n\`\`\`${ctx.languageId}\n${ctx.selection.trimEnd()}\n\`\`\`\n`;
                await this.files.write(uri, body);
                await open(this.opener, uri);
                this.messages.info(`Created rule ${CONFIG_DIRS.ingot}/${RULES_DIR}/${slug}.md`);
            }
        });

        registry.registerCommand(EDITOR_COMMANDS.openChangesHead, inRepo(ctx => this.openDiff(ctx, 'HEAD', 'HEAD')));
        registry.registerCommand(EDITOR_COMMANDS.openChangesPrevious, inRepo(ctx => this.openDiff(ctx, 'HEAD~1', 'HEAD~1')));
        const remoteUrl = async (ctx: EditorContext & { root: URI; relative: string }): Promise<string | undefined> => {
            const remote = await this.git.remote(ctx.root.path.fsPath());
            const url = remote && remoteFileUrl(remote.url, remote.branch ?? remote.commit, ctx.relative, ctx.line);
            if (!url) {
                this.messages.warn('This repository has no web remote (origin).');
            }
            return url;
        };
        registry.registerCommand(EDITOR_COMMANDS.openOnRemote, inRepo(async ctx => { const url = await remoteUrl(ctx); if (url) { this.windows.openNewWindow(url, { external: true }); } }));
        registry.registerCommand(EDITOR_COMMANDS.copyRemoteUrl, inRepo(async ctx => { const url = await remoteUrl(ctx); if (url) { await this.clipboard.writeText(url); } }));
        registry.registerCommand(EDITOR_COMMANDS.toggleBlame, inRepo(ctx => this.gitRun(() => this.toggleBlame(ctx))));
        registry.registerCommand(EDITOR_COMMANDS.blameLine, inRepo(ctx => this.gitRun(async () => {
            const line = (await this.git.blame(ctx.root.path.fsPath(), ctx.relative)).find(l => l.line === ctx.line);
            if (line) {
                this.messages.info(`${line.hash.slice(0, 8)} · ${line.author}, ${line.date ? relativeDate(line.date) : ''}: ${line.summary}`);
            }
        })));
        registry.registerCommand(EDITOR_COMMANDS.quickFileHistory, inRepo(async ctx => {
            const ref = await this.pickRevision(ctx, `History of ${ctx.uri.path.base}`);
            if (ref) {
                await this.openDiff(ctx, ref, ref.slice(0, 7));
            }
        }));
        registry.registerCommand(EDITOR_COMMANDS.compareWithRevision, inRepo(async ctx => {
            const ref = await this.pickRevision(ctx, `Compare ${ctx.uri.path.base} with Revision`);
            if (ref) {
                await this.openDiff(ctx, ref, ref.slice(0, 7));
            }
        }));
        registry.registerCommand(EDITOR_COMMANDS.compareWithBranch, inRepo(ctx => this.gitRun(async () => {
            const branches = await this.git.branches(ctx.root.path.fsPath());
            const items: QuickPickItem[] = branches.filter(b => !b.current).map(b => ({ label: b.name, description: b.remote ? 'remote' : 'local' }));
            const picked = await this.quickInput.showQuickPick(items, { title: `Compare ${ctx.uri.path.base} with Branch`, placeholder: 'Search branches' });
            if (picked) {
                await this.openDiff(ctx, picked.label, picked.label);
            }
        })));
        registry.registerCommand(EDITOR_COMMANDS.commitFile, inRepo(async ctx => {
            const message = await this.quickInput.input({ title: `Commit ${ctx.relative}`, prompt: 'Commit message', placeHolder: `Update ${ctx.uri.path.base}` });
            if (message?.trim()) {
                await ctx.editor.document.save();
                await this.gitRun(() => this.git.commitFile(ctx.root.path.fsPath(), ctx.relative, message.trim()), `Committed ${ctx.relative}.`);
            }
        }));
        registry.registerCommand(EDITOR_COMMANDS.rollbackFile, inRepo(async ctx => {
            const ok = await new ConfirmDialog({ title: 'Rollback', msg: `Discard all changes in ${ctx.relative} and restore it from HEAD?`, ok: 'Rollback' }).open();
            if (ok) {
                await this.gitRun(() => this.git.rollbackFile(ctx.root.path.fsPath(), ctx.relative), `Rolled back ${ctx.relative}.`);
            }
        }));
        registry.registerCommand(EDITOR_COMMANDS.addToGitignore, inRepo(async ctx => {
            const ignore = ctx.root.resolve('.gitignore');
            const current = (await this.files.exists(ignore)) ? (await this.files.read(ignore)).value : '';
            const entry = `/${ctx.relative}`;
            if (current.split('\n').some(l => l.trim() === entry)) {
                this.messages.info(`${entry} is already in .gitignore.`);
                return;
            }
            await this.files.write(ignore, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${entry}\n`);
            this.messages.info(`Added ${entry} to .gitignore.`);
        }));

        registry.registerCommand(EDITOR_COMMANDS.copyPath, withCtx(ctx => this.clipboard.writeText(ctx.uri.path.fsPath())));
        registry.registerCommand(EDITOR_COMMANDS.copyRelativePath, withCtx(ctx => this.clipboard.writeText(ctx.relative ?? ctx.uri.path.base)));
        registry.registerCommand(EDITOR_COMMANDS.copyReference, withCtx(ctx => this.clipboard.writeText(`${ctx.relative ?? ctx.uri.path.base}:${ctx.line}${ctx.word ? ` (${ctx.word})` : ''}`)));
        registry.registerCommand(EDITOR_COMMANDS.copyMarkdown, withCtx(ctx => {
            const code = ctx.selection || ctx.editor.getControl().getModel()?.getLineContent(ctx.line) || '';
            return this.clipboard.writeText(`\`${ctx.relative ?? ctx.uri.path.base}:${ctx.line}\`\n\n\`\`\`${ctx.languageId}\n${code.trimEnd()}\n\`\`\`\n`);
        }));
    }

    registerMenus(menus: MenuModelRegistry): void {
        const add = (path: MenuPath, commandId: string, label: string, order: string): void => {
            menus.registerMenuAction(path, { commandId, label, order });
        };
        const n = EDITOR_MENU.navigation;
        add(n, MONACO_ACTIONS.definition, 'Go to Definition', 'a');
        add(n, MONACO_ACTIONS.typeDefinition, 'Go to Type Definition', 'b');
        add(n, EDITOR_COMMANDS.goToSourceDefinition.id, 'Go to Source Definition', 'c');
        add(n, MONACO_ACTIONS.implementation, 'Go to Implementations', 'd');
        add(n, MONACO_ACTIONS.references, 'Go to References', 'e');
        add(n, EDITOR_COMMANDS.addSymbolToChat.id, 'Add Symbol to Current Chat', 'f');
        add(n, EDITOR_COMMANDS.addSymbolToNewChat.id, 'Add Symbol to New Chat', 'g');
        add(n, EDITOR_COMMANDS.createRule.id, 'Create Rule', 'h');
        menus.registerSubmenu(EDITOR_SUBMENUS.peek, 'Peek', { sortString: 'i' });
        add(EDITOR_SUBMENUS.peek, MONACO_ACTIONS.peekDefinition, 'Peek Definition', 'a');
        add(EDITOR_SUBMENUS.peek, MONACO_ACTIONS.peekTypeDefinition, 'Peek Type Definition', 'b');
        add(EDITOR_SUBMENUS.peek, MONACO_ACTIONS.peekImplementation, 'Peek Implementations', 'c');
        add(EDITOR_SUBMENUS.peek, MONACO_ACTIONS.peekReferences, 'Peek References', 'd');

        add(EDITOR_MENU.find, EDITOR_COMMANDS.findAllReferences.id, 'Find All References', 'a');
        add(EDITOR_MENU.find, EDITOR_COMMANDS.findAllImplementations.id, 'Find All Implementations', 'b');
        add(EDITOR_MENU.find, EDITOR_COMMANDS.showCallHierarchy.id, 'Show Call Hierarchy', 'c');

        const r = EDITOR_MENU.refactor;
        add(r, MONACO_ACTIONS.rename, 'Rename Symbol', 'a');
        add(r, MONACO_ACTIONS.changeAll, 'Change All Occurrences', 'b');
        add(r, MONACO_ACTIONS.format, 'Format Document', 'c');
        add(r, MONACO_ACTIONS.refactor, 'Refactor...', 'd');
        add(r, MONACO_ACTIONS.sourceAction, 'Source Action...', 'e');

        menus.registerSubmenu(EDITOR_SUBMENUS.openChanges, 'Open Changes', { sortString: 'a' });
        add(EDITOR_SUBMENUS.openChanges, EDITOR_COMMANDS.openChangesHead.id, 'Open Changes with HEAD', 'a');
        add(EDITOR_SUBMENUS.openChanges, EDITOR_COMMANDS.openChangesPrevious.id, 'Open Changes with Previous Revision', 'b');
        menus.registerSubmenu(EDITOR_SUBMENUS.openOnRemote, 'Open on Remote (Web)', { sortString: 'b' });
        add(EDITOR_SUBMENUS.openOnRemote, EDITOR_COMMANDS.openOnRemote.id, 'Open File on Remote', 'a');
        add(EDITOR_SUBMENUS.openOnRemote, EDITOR_COMMANDS.copyRemoteUrl.id, 'Copy Remote File URL', 'b');

        menus.registerSubmenu(EDITOR_SUBMENUS.annotations, 'File Annotations', { sortString: 'a' });
        add(EDITOR_SUBMENUS.annotations, EDITOR_COMMANDS.toggleBlame.id, 'Toggle Line Blame', 'a');
        add(EDITOR_SUBMENUS.annotations, EDITOR_COMMANDS.blameLine.id, 'Show Blame for Current Line', 'b');
        menus.registerSubmenu(EDITOR_SUBMENUS.fileHistory, 'File History', { sortString: 'b' });
        add(EDITOR_SUBMENUS.fileHistory, 'ingot.git.fileHistory', 'Show File History', 'a');
        add(EDITOR_SUBMENUS.fileHistory, EDITOR_COMMANDS.quickFileHistory.id, 'Quick File History…', 'b');
        menus.registerSubmenu(EDITOR_SUBMENUS.git, 'Git', { sortString: 'c' });
        this.gitActions.registerGitSubmenu(menus, EDITOR_SUBMENUS.git);

        const cl = EDITOR_MENU.clipboard;
        add(cl, CommonCommands.CUT.id, 'Cut', 'a');
        add(cl, CommonCommands.COPY.id, 'Copy', 'b');
        menus.registerSubmenu(EDITOR_SUBMENUS.copyAs, 'Copy As', { sortString: 'c' });
        add(EDITOR_SUBMENUS.copyAs, EDITOR_COMMANDS.copyPath.id, 'Copy Path', 'a');
        add(EDITOR_SUBMENUS.copyAs, EDITOR_COMMANDS.copyRelativePath.id, 'Copy Relative Path', 'b');
        add(EDITOR_SUBMENUS.copyAs, EDITOR_COMMANDS.copyReference.id, 'Copy Reference', 'c');
        add(EDITOR_SUBMENUS.copyAs, EDITOR_COMMANDS.copyMarkdown.id, 'Copy as Markdown', 'd');
        add(cl, CommonCommands.PASTE.id, 'Paste', 'd');

        add(EDITOR_MENU.palette, COMMAND_PALETTE, 'Command Palette...', 'a');
    }
}
