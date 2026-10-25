import { inject, injectable } from '@theia/core/shared/inversify';
import { KeybindingRegistry, OpenerService, QuickInputService, SHELL_TABBAR_CONTEXT_MENU, open, type FrontendApplicationContribution, type KeybindingContribution } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { CommandRegistry, type Command, type CommandContribution } from '@theia/core/lib/common/command';
import { MenuModelRegistry, type MenuContribution, type MenuPath } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { isOSX } from '@theia/core/lib/common/os';
import URI from '@theia/core/lib/common/uri';
import { NAVIGATOR_CONTEXT_MENU } from '@theia/navigator/lib/browser/navigator-contribution';
import { GitService } from '../../common/git/git.types';
import { remoteFileUrl } from '../../common/git/git.utils';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { IngotGitActionsContribution } from '../git/git-actions-contribution';
import { GIT_FILE_COMMANDS } from '../git/git-actions.consts';
import { DELEGATES, FILE_MENU_COMMANDS } from './file-menus.consts';

const TREE = (group: string): MenuPath => [...NAVIGATOR_CONTEXT_MENU, group];
const TAB = (group: string): MenuPath => [...SHELL_TABBAR_CONTEXT_MENU, group];

/**
 * Project tree file menu (IDEA-70) and editor tab menu (IDEA-58), grouped like the reference with separators and
 * shortcuts, sharing one item set and the full Git submenu. Items resolve their file from the clicked tab, the
 * tree selection or the current editor, then run Ingot or core commands with that URI.
 */
@injectable()
export class IngotFileMenusContribution implements CommandContribution, MenuContribution, KeybindingContribution, FrontendApplicationContribution {

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(MenuModelRegistry) protected readonly menus: MenuModelRegistry;
    @inject(IngotGitActionsContribution) protected readonly targets: IngotGitActionsContribution;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(ClipboardService) protected readonly clipboard: ClipboardService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(GitService) protected readonly git: GitService;
    @inject(IngotAgentsContribution) protected readonly agents: IngotAgentsContribution;

    protected pruning = false;

    onStart(): void {
        this.prune();
        this.menus.onDidChange(() => this.prune());
    }

    /** The tree menu is curated like the editor menu: drop default/plugin groups so nothing appears twice. */
    protected prune(): void {
        if (this.pruning) {
            return;
        }
        const root = this.menus.getMenu(NAVIGATOR_CONTEXT_MENU) as { children?: readonly { id: string }[]; removeNode?: (node: unknown) => void } | undefined;
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

    protected uri(args: unknown[]): URI | undefined {
        return this.targets.targetUri(args);
    }

    protected delegate(id: string, args: unknown[]): unknown {
        const uri = this.uri(args);
        return uri ? this.commands.executeCommand(id, uri) : undefined;
    }

    protected async remoteUrl(args: unknown[], ref?: string): Promise<string | undefined> {
        const t = this.targets.target(args);
        if (!t?.relative) {
            return undefined;
        }
        const remote = await this.git.remote(t.rootPath);
        const url = remote && remoteFileUrl(remote.url, ref ?? remote.branch ?? remote.commit, t.relative);
        if (!url) {
            this.messages.warn('This repository has no web remote (origin).');
        }
        return url;
    }

    protected async addToChat(args: unknown[], fresh: boolean): Promise<void> {
        const t = this.targets.target(args);
        if (!t?.uri) {
            return;
        }
        if (fresh) {
            await this.commands.executeCommand(AGENT_COMMANDS.newAgent.id);
        }
        const widget = await this.agents.openView({ activate: true, reveal: true });
        widget.addContext(`@${t.relative ?? t.uri.path.base}`);
    }

    registerCommands(registry: CommandRegistry): void {
        const F = FILE_MENU_COMMANDS;
        const reg = (command: Command, execute: (args: unknown[]) => unknown, enabled: (args: unknown[]) => boolean = args => !!this.uri(args)) =>
            registry.registerCommand(command, { isEnabled: (...args: unknown[]) => enabled(args), isVisible: (...args: unknown[]) => enabled(args), execute: (...args: unknown[]) => execute(args) });
        const has = (id: string) => (args: unknown[]) => !!this.commands.getCommand(id) && !!this.uri(args);

        reg(F.openToSide, args => { const uri = this.uri(args); return uri && open(this.opener, uri, { widgetOptions: { mode: 'split-right' } }); });
        reg(F.openInBrowser, args => { const uri = this.uri(args); return uri && this.windows.openNewWindow(uri.toString(), { external: true }); });
        reg(F.openWith, args => this.delegate(DELEGATES.openWith, args), has(DELEGATES.openWith));
        registry.registerCommand({ ...F.revealInOS, label: isOSX ? 'Reveal in Finder' : 'Reveal in File Explorer' }, {
            isEnabled: (...args: unknown[]) => has(DELEGATES.revealInOS)(args), isVisible: (...args: unknown[]) => has(DELEGATES.revealInOS)(args),
            execute: (...args: unknown[]) => this.delegate(DELEGATES.revealInOS, args)
        });
        reg(F.openInTerminal, args => this.delegate(DELEGATES.openInTerminal, args), has(DELEGATES.openInTerminal));
        reg(F.selectForCompare, args => this.delegate(DELEGATES.compareFirst, args), has(DELEGATES.compareFirst));
        reg(F.compareWithSelected, args => this.delegate(DELEGATES.compareSecond, args), args => has(DELEGATES.compareSecond)(args) && this.commands.isEnabled(DELEGATES.compareSecond, this.uri(args)));
        reg(F.addToChat, args => this.addToChat(args, false));
        reg(F.addToNewChat, args => this.addToChat(args, true));
        reg(F.openTimeline, args => this.commands.executeCommand(GIT_FILE_COMMANDS.showHistory.id, this.uri(args)));
        reg(F.quickHistory, args => this.commands.executeCommand(GIT_FILE_COMMANDS.compareWithRevision.id, this.uri(args)));
        reg(F.copyPath, args => { const uri = this.uri(args); return uri && this.clipboard.writeText(uri.path.fsPath()); });
        reg(F.copyRelativePath, args => { const t = this.targets.target(args); return t?.uri && this.clipboard.writeText(t.relative ?? t.uri.path.base); });
        reg(F.copyRemoteUrl, async args => { const url = await this.remoteUrl(args); if (url) { await this.clipboard.writeText(url); } });
        reg(F.copyRemoteUrlFrom, async args => {
            const t = this.targets.target(args);
            if (!t) {
                return;
            }
            const branches = await this.git.branches(t.rootPath).catch(() => []);
            const picked = await this.quickInput.showQuickPick([
                ...branches.filter(b => !b.remote).map(b => ({ label: b.name, description: 'branch', id: b.name })),
                { label: 'Current commit (permalink)', id: 'HEAD' }
            ], { title: 'Copy Remote File URL From…' });
            const ref = picked?.id === 'HEAD' ? (await this.git.remote(t.rootPath))?.commit : picked?.id;
            const url = ref && await this.remoteUrl(args, ref);
            if (url) {
                await this.clipboard.writeText(url);
            }
        });
        reg(F.rename, args => this.delegate(DELEGATES.rename, args), has(DELEGATES.rename));
        reg(F.delete, args => this.delegate(DELEGATES.delete, args), has(DELEGATES.delete));
        reg(F.revealInProject, args => this.delegate(DELEGATES.reveal, args), has(DELEGATES.reveal));
    }

    /** The shared item set, laid out at `group(n)` paths with separators between groups. */
    protected registerItems(menus: MenuModelRegistry, group: (name: string) => MenuPath, kind: 'tree' | 'tab'): void {
        const F = FILE_MENU_COMMANDS;
        const G = GIT_FILE_COMMANDS;
        const add = (path: MenuPath, items: (Command | [string, string])[]) => items.forEach((item, i) => {
            const [commandId, label] = Array.isArray(item) ? item : [item.id, item.label];
            menus.registerMenuAction(path, { commandId, label, order: String.fromCharCode(97 + i) });
        });
        if (kind === 'tree') {
            add(group('ingot_0_new'), [[DELEGATES.newFile, 'New File…'], [DELEGATES.newFolder, 'New Folder…']]);
        }
        add(group('ingot_1_open'), [F.openToSide, F.openInBrowser, F.openWith, F.revealInOS, ...(kind === 'tab' ? [F.revealInProject] : [])]);
        add(group('ingot_2_compare'), [F.openInTerminal, F.selectForCompare, F.compareWithSelected]);
        add(group('ingot_3_agent'), [F.addToChat, F.addToNewChat]);
        const changes = [...group('ingot_4_remote'), 'ingot_open_changes'];
        menus.registerSubmenu(changes, 'Open Changes', { sortString: 'a' });
        add(changes, [[G.showDiff.id, 'Open Changes with HEAD'], [G.compareWithRevision.id, 'Open Changes with Revision…'], [G.compareWithBranch.id, 'Open Changes with Branch…']]);
        const remote = [...group('ingot_4_remote'), 'ingot_open_remote'];
        menus.registerSubmenu(remote, 'Open on Remote (Web)', { sortString: 'b' });
        add(remote, [[G.openOnRemote.id, 'Open File on Remote'], F.copyRemoteUrl]);
        const history = [...group('ingot_5_history'), 'ingot_file_history'];
        menus.registerSubmenu(history, 'File History', { sortString: 'a' });
        add(history, [[G.showHistory.id, 'Show File History'], F.quickHistory, [G.showHistoryForSelection.id, 'Show History for Selection']]);
        menus.registerMenuAction(group('ingot_5_history'), { commandId: F.openTimeline.id, label: F.openTimeline.label, order: 'b' });
        if (kind === 'tree') {
            add(group('ingot_6_clipboard'), [[DELEGATES.cut, 'Cut'], [DELEGATES.copy, 'Copy'], [DELEGATES.paste, 'Paste']]);
        }
        add(group('ingot_7_copy'), [F.copyPath, F.copyRelativePath, F.copyRemoteUrl, F.copyRemoteUrlFrom]);
        add(group('ingot_8_modify'), [F.rename, F.delete]);
        const git = [...group('ingot_9_git'), 'ingot_git'];
        menus.registerSubmenu(git, 'Git', { sortString: 'a' });
        this.targets.registerGitSubmenu(menus, git);
    }

    registerMenus(menus: MenuModelRegistry): void {
        this.registerItems(menus, TREE, 'tree');
        this.registerItems(menus, TAB, 'tab');
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        const F = FILE_MENU_COMMANDS;
        const tree = 'filesExplorerFocus && !inputFocus';
        keybindings.registerKeybindings(
            { command: F.revealInOS.id, keybinding: 'ctrlcmd+alt+r', when: tree },
            { command: F.copyPath.id, keybinding: 'ctrlcmd+alt+c', when: tree },
            { command: F.copyRelativePath.id, keybinding: 'ctrlcmd+alt+shift+c', when: tree },
            { command: F.rename.id, keybinding: isOSX ? 'enter' : 'f2', when: tree },
            { command: F.delete.id, keybinding: isOSX ? 'ctrlcmd+backspace' : 'delete', when: tree }
        );
    }
}
