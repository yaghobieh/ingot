import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { FileStat } from '@theia/filesystem/lib/common/files';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { GitService } from '../../common/git/git.types';
import { WELCOME_RECENT_VISIBLE } from '../../common/welcome/welcome.consts';
import type { RecentProject } from '../../common/welcome/welcome.types';
import { isCloneUrl, parseSshTarget, recentProjectLabel, recentProjectLocation, sshArgs, toRecentProjects, welcomePlanLabel } from '../../common/welcome/welcome.utils';
import { PRODUCT } from '../../common/product.consts';
import { IngotAccountService } from '../account/account-service';
import { AnimatedMark } from '../brand/animated-mark';
import { SETTINGS_OPEN_COMMAND } from '../settings/settings.browser-consts';
import {
    CLONE_INVALID, CLONE_PLACEHOLDER, CLONE_PROMPT, CLONE_TARGET_LABEL, CLONE_TARGET_TITLE, SSH_COMMAND, SSH_INVALID, SSH_PLACEHOLDER, SSH_PROMPT,
    WELCOME_CARDS, WELCOME_COMMANDS, WELCOME_MARK_SIZE, WELCOME_WIDGET_ID, WELCOME_WIDGET_LABEL
} from './ingot-welcome.consts';

type CardId = typeof WELCOME_CARDS[number]['id'];

/** IDEA-266: the empty-window welcome screen: logo and plan, Open project / Clone repo / Connect via SSH, recent projects. */
@injectable()
export class IngotWelcomeWidget extends ReactWidget {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(FileDialogService) protected readonly fileDialogs: FileDialogService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(GitService) protected readonly git: GitService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;

    protected recentUris: string[] = [];
    protected home?: string;
    protected homeUri?: string;
    protected cloning?: string;

    @postConstruct()
    protected init(): void {
        this.id = WELCOME_WIDGET_ID;
        this.title.label = WELCOME_WIDGET_LABEL;
        this.title.caption = WELCOME_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-project';
        this.addClass('ingot-welcome');
        this.toDispose.push(this.account.onDidChange(() => this.update()));
        void this.load();
    }

    protected async load(): Promise<void> {
        const [recent, homeUri] = await Promise.all([this.workspace.recentWorkspaces(), this.env.getHomeDirUri()]);
        this.recentUris = recent;
        this.homeUri = homeUri;
        this.home = new URI(homeUri).path.fsPath();
        this.update();
    }

    protected run(commandId: string): void {
        if (this.commands.getCommand(commandId)) {
            void this.commands.executeCommand(commandId);
        }
    }

    protected openProject(project: RecentProject): void {
        void this.workspace.open(new URI(project.uri), { preserveWindow: true });
    }

    /** Asks for the URL, then the parent folder, clones there and opens the new folder in this window. */
    async cloneRepository(): Promise<void> {
        const url = await this.quickInput.input({
            prompt: CLONE_PROMPT, placeHolder: CLONE_PLACEHOLDER,
            validateInput: async value => !value.trim() || isCloneUrl(value) ? undefined : CLONE_INVALID
        });
        if (!url || !isCloneUrl(url)) {
            return;
        }
        const parent = await this.fileDialogs.showOpenDialog({ title: CLONE_TARGET_TITLE, openLabel: CLONE_TARGET_LABEL, canSelectFolders: true, canSelectFiles: false, canSelectMany: false },
            this.homeUri ? await this.fileStat(this.homeUri) : undefined);
        if (!parent) {
            return;
        }
        this.cloning = url.trim();
        this.update();
        try {
            const target = await this.git.clone(url, parent.path.fsPath());
            await this.workspace.open(URI.fromFilePath(target), { preserveWindow: true });
        } catch (error) {
            void this.messages.error(`Clone failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.cloning = undefined;
            this.update();
        }
    }

    /** Asks for `user@host[:port]` and opens an ssh session in the Terminal (ssh runs directly, never through a shell). */
    async connectSsh(): Promise<void> {
        const value = await this.quickInput.input({
            prompt: SSH_PROMPT, placeHolder: SSH_PLACEHOLDER,
            validateInput: async input => !input.trim() || parseSshTarget(input) ? undefined : SSH_INVALID
        });
        const target = value ? parseSshTarget(value) : undefined;
        if (!target) {
            return;
        }
        const terminal = await this.terminals.newTerminal({
            title: `${SSH_COMMAND} ${target.destination}`, shellPath: SSH_COMMAND, shellArgs: sshArgs(target), cwd: this.homeUri, destroyTermOnClose: true, useServerTitle: false
        });
        await terminal.start();
        this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'activate' });
    }

    protected async fileStat(uri: string): Promise<FileStat | undefined> {
        return this.files.resolve(new URI(uri)).catch(() => undefined);
    }

    protected readonly cardActions: Record<CardId, () => void> = {
        'ingot-welcome-open': () => this.run(WELCOME_COMMANDS.openFolder),
        'ingot-welcome-clone': () => void this.cloneRepository(),
        'ingot-welcome-ssh': () => void this.connectSsh()
    };

    protected render(): React.ReactNode {
        return <div className='ingot-welcome-page'>
            <div className='ingot-welcome-column'>
                <header className='ingot-welcome-hero'>
                    <div className='ingot-welcome-brand'>
                        <span className='ingot-welcome-logo ingot-app-icon ingot-mark-host'><AnimatedMark size={WELCOME_MARK_SIZE} /></span>
                        <h1 className='ingot-welcome-title'>{PRODUCT.name}</h1>
                    </div>
                    <div className='ingot-welcome-plan'>
                        <span id='ingot-welcome-plan'>{welcomePlanLabel(this.account.snapshot)}</span>
                        <span aria-hidden='true'> · </span>
                        <button id='ingot-welcome-settings' type='button' className='ingot-welcome-link' onClick={() => this.run(SETTINGS_OPEN_COMMAND.id)}>Settings</button>
                    </div>
                </header>
                <div className='ingot-welcome-cards'>
                    {WELCOME_CARDS.map(card => {
                        const busy = card.id === 'ingot-welcome-clone' && !!this.cloning;
                        return <button key={card.id} id={card.id} type='button' className='ingot-welcome-card' disabled={busy} onClick={this.cardActions[card.id]}>
                            <span className={`codicon ${busy ? 'codicon-loading codicon-modifier-spin' : card.icon}`} />
                            <span className='ingot-welcome-card-label'>{busy ? 'Cloning…' : card.label}</span>
                        </button>;
                    })}
                </div>
                {this.renderRecent()}
            </div>
        </div>;
    }

    protected renderRecent(): React.ReactNode {
        const projects = toRecentProjects(this.recentUris, this.home);
        return <section className='ingot-welcome-recent' id='ingot-welcome-workspaces'>
            <div className='ingot-welcome-recent-head'>
                <h2>Recent projects</h2>
                {projects.length > 0 && <button id='ingot-welcome-view-all' type='button' className='ingot-welcome-link' onClick={() => this.run(WELCOME_COMMANDS.openRecent)}>
                    View all ({projects.length})
                </button>}
            </div>
            {projects.length === 0
                ? <div className='ingot-welcome-empty'>No recent projects yet.</div>
                : <ul className='ingot-welcome-list'>
                    {projects.slice(0, WELCOME_RECENT_VISIBLE).map(p => (
                        <li key={p.uri}>
                            <button type='button' className='ingot-welcome-project' title={p.path} onClick={() => this.openProject(p)}>
                                <span className='ingot-welcome-project-name'>{recentProjectLabel(p)}</span>
                                <span className='ingot-welcome-project-path'><bdi>{recentProjectLocation(p)}</bdi></span>
                            </button>
                        </li>
                    ))}
                </ul>}
        </section>;
    }
}
