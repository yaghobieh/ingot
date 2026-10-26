import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { FileStat } from '@theia/filesystem/lib/common/files';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { AppearanceContribution } from '../theme/appearance-contribution';
import { GitService } from '../../common/git/git.types';
import { SUGGESTED_EXTENSIONS, WELCOME_WORKSPACES_VISIBLE, type SuggestedExtension } from '../../common/welcome/welcome.consts';
import type { RecentProject, SuggestionState } from '../../common/welcome/welcome.types';
import { isCloneUrl, openVsxParts, toRecentProjects, visibleWorkspaces } from '../../common/welcome/welcome.utils';
import { OPEN_VSX_API } from '../../common/theme/theme-store.consts';
import { PRODUCT } from '../../common/product.consts';
import { AnimatedMark } from '../brand/animated-mark';
import { CLONE_PLACEHOLDER, CLONE_PROMPT, CLONE_TARGET_LABEL, CLONE_TARGET_TITLE, THEME_CHOICES, WELCOME_COMMANDS, WELCOME_WIDGET_ID, WELCOME_WIDGET_LABEL } from './ingot-welcome.consts';

/** New-window welcome page (IDEA-165): logo, Open Folder / Clone Repository, recent Workspaces and suggested extensions. */
@injectable()
export class IngotWelcomeWidget extends ReactWidget {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(FileDialogService) protected readonly fileDialogs: FileDialogService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(AppearanceContribution) protected readonly appearance: AppearanceContribution;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(GitService) protected readonly git: GitService;
    @inject(PluginServer) protected readonly plugins: PluginServer;

    protected recentUris: string[] = [];
    protected home?: string;
    protected homeUri?: string;
    protected expanded = false;
    protected cloning?: string;
    protected icons = new Map<string, string>();
    protected suggestionStates = new Map<string, SuggestionState>();

    @postConstruct()
    protected init(): void {
        this.id = WELCOME_WIDGET_ID;
        this.title.label = WELCOME_WIDGET_LABEL;
        this.title.caption = WELCOME_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-project';
        this.addClass('ingot-welcome');
        this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
        void this.load();
        void this.loadSuggestions();
    }

    protected async load(): Promise<void> {
        const [recent, homeUri] = await Promise.all([this.workspace.recentWorkspaces(), this.env.getHomeDirUri()]);
        this.recentUris = recent;
        this.homeUri = homeUri;
        this.home = new URI(homeUri).path.fsPath();
        this.update();
    }

    /** Installed state from the plugin server, icons from Open VSX (best effort; the curated card shows without them). */
    protected async loadSuggestions(): Promise<void> {
        const installed = await this.plugins.getInstalledPlugins().catch(() => [] as readonly string[]);
        for (const s of SUGGESTED_EXTENSIONS) {
            if (installed.some(id => id.toLowerCase().startsWith(`${s.id.toLowerCase()}@`))) {
                this.suggestionStates.set(s.id, 'installed');
            }
        }
        this.update();
        await Promise.all(SUGGESTED_EXTENSIONS.map(async s => {
            const { namespace, name } = openVsxParts(s.id);
            try {
                const response = await fetch(`${OPEN_VSX_API}/${namespace}/${name}`);
                const icon = response.ok ? (await response.json() as { files?: { icon?: string } }).files?.icon : undefined;
                if (icon?.startsWith('https://')) {
                    this.icons.set(s.id, icon);
                }
            } catch {
                // Offline: keep the built-in icon.
            }
        }));
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
            validateInput: async value => !value.trim() || isCloneUrl(value) ? undefined : 'Enter an https or ssh Git URL.'
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

    protected async fileStat(uri: string): Promise<FileStat | undefined> {
        return this.files.resolve(new URI(uri)).catch(() => undefined);
    }

    protected async install(extension: SuggestedExtension): Promise<void> {
        this.suggestionStates.set(extension.id, 'installing');
        this.update();
        try {
            await this.plugins.install(`vscode:extension/${extension.id}`);
            this.suggestionStates.set(extension.id, 'installed');
        } catch (error) {
            this.suggestionStates.set(extension.id, 'failed');
            void this.messages.error(`Could not install ${extension.label}: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.update();
    }

    protected render(): React.ReactNode {
        return <div className='ingot-welcome-page'>
            <div className='ingot-welcome-column'>
                <header className='ingot-welcome-hero'>
                    <span className='ingot-welcome-logo ingot-app-icon ingot-mark-host'><AnimatedMark size={64} /></span>
                    <h1 className='ingot-welcome-title'>{PRODUCT.name}</h1>
                </header>
                <div className='ingot-welcome-buttons'>
                    <button id='ingot-welcome-open' type='button' className='ingot-welcome-btn primary' onClick={() => this.run(WELCOME_COMMANDS.openFolder)}>
                        <span className='codicon codicon-folder' />Open Folder
                    </button>
                    <button id='ingot-welcome-clone' type='button' className='ingot-welcome-btn secondary' disabled={!!this.cloning} onClick={() => void this.cloneRepository()}>
                        <span className={`codicon ${this.cloning ? 'codicon-loading codicon-modifier-spin' : 'codicon-repo-clone'}`} />{this.cloning ? 'Cloning…' : 'Clone Repository'}
                    </button>
                    <button id='ingot-welcome-open-workspace' type='button' className='ingot-welcome-link' onClick={() => this.run(WELCOME_COMMANDS.openWorkspace)}>Open Workspace…</button>
                </div>
                {this.renderWorkspaces()}
                {this.renderSuggestions()}
                {this.renderThemes()}
            </div>
        </div>;
    }

    protected renderWorkspaces(): React.ReactNode {
        const projects = toRecentProjects(this.recentUris, this.home);
        const { shown, more } = visibleWorkspaces(projects, this.expanded, WELCOME_WORKSPACES_VISIBLE);
        return <section className='ingot-welcome-block' id='ingot-welcome-workspaces'>
            <h2>Workspaces</h2>
            {projects.length === 0
                ? <div className='ingot-welcome-empty'>No recent workspaces yet. Open a folder or clone a repository to get started.</div>
                : <ul className='ingot-welcome-list'>
                    {shown.map(p => (
                        <li key={p.uri}>
                            <button type='button' className='ingot-welcome-project' title={p.path} onClick={() => this.openProject(p)}>
                                <span className='ingot-welcome-project-name'>{p.name}{p.kind !== 'folder' && <span className='ingot-welcome-kind'> ({p.kind === 'group' ? 'Group' : 'Workspace'})</span>}</span>
                                <span className='ingot-welcome-project-path'>{p.path}</span>
                            </button>
                        </li>
                    ))}
                </ul>}
            {more && <button id='ingot-welcome-more' type='button' className='ingot-welcome-more' onClick={() => { this.expanded = true; this.update(); }}>Show More...</button>}
        </section>;
    }

    protected renderSuggestions(): React.ReactNode {
        return <section className='ingot-welcome-block' id='ingot-welcome-suggested'>
            <h2>Suggested extensions</h2>
            <ul className='ingot-welcome-list'>
                {SUGGESTED_EXTENSIONS.map(s => {
                    const state = this.suggestionStates.get(s.id) ?? 'idle';
                    const icon = this.icons.get(s.id);
                    return <li key={s.id} className='ingot-welcome-ext' data-ext={s.id}>
                        {icon ? <img className='ingot-welcome-ext-icon' src={icon} alt='' /> : <span className={`ingot-welcome-ext-icon codicon ${s.icon}`} />}
                        <span className='ingot-welcome-ext-text'>
                            <span className='ingot-welcome-ext-name'>{s.label}</span>
                            <span className='ingot-welcome-ext-desc'>{s.description}</span>
                        </span>
                        <button type='button' className='ingot-welcome-install' disabled={state === 'installing' || state === 'installed'} onClick={() => void this.install(s)}>
                            {state === 'installing' ? 'Installing…' : state === 'installed' ? 'Installed' : state === 'failed' ? 'Retry' : 'Install'}
                        </button>
                    </li>;
                })}
            </ul>
            <button id='ingot-welcome-open-plugins' type='button' className='ingot-welcome-more' onClick={() => this.run(WELCOME_COMMANDS.plugins)}>Browse all extensions</button>
        </section>;
    }

    protected renderThemes(): React.ReactNode {
        const current = this.appearance.mode;
        return <div className='ingot-welcome-themes' role='group' aria-label='Theme'>
            {THEME_CHOICES.map(t => (
                <button key={t.id} id={`ingot-theme-${t.id}`} type='button' className={`ingot-welcome-theme ${current === t.id ? 'active' : ''}`}
                    onClick={async () => { await this.appearance.setMode(t.id); this.update(); }}>{t.label}</button>
            ))}
        </div>;
    }
}
