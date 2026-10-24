import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { AppearanceContribution } from '../theme/appearance-contribution';
import { WELCOME_TABS } from '../../common/welcome/welcome.consts';
import type { RecentProject, WelcomeTab } from '../../common/welcome/welcome.types';
import { repoNameFromUrl, toRecentProjects } from '../../common/welcome/welcome.utils';
import { PRODUCT } from '../../common/product.consts';
import { CLONE_PROMPT, CLONE_TERMINAL_TITLE, LEARN_LINKS, WELCOME_COMMANDS, WELCOME_WIDGET_ID, WELCOME_WIDGET_LABEL } from './ingot-welcome.consts';

const THEME_CHOICES = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' }
] as const;

/** IDE-style Welcome screen: Projects, Customize, Plugins, Learn (IDEA-15). */
@injectable()
export class IngotWelcomeWidget extends ReactWidget {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(AppearanceContribution) protected readonly appearance: AppearanceContribution;
    @inject(WindowService) protected readonly windows: WindowService;

    protected tab: WelcomeTab = 'projects';
    protected filter = '';
    protected recentUris: string[] = [];
    protected home?: string;

    @postConstruct()
    protected init(): void {
        this.id = WELCOME_WIDGET_ID;
        this.title.label = WELCOME_WIDGET_LABEL;
        this.title.caption = WELCOME_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-project';
        this.addClass('ingot-welcome');
        this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
        this.load();
    }

    protected async load(): Promise<void> {
        const [recent, homeUri] = await Promise.all([this.workspace.recentWorkspaces(), this.env.getHomeDirUri()]);
        this.recentUris = recent;
        this.home = new URI(homeUri).path.fsPath();
        this.update();
    }

    protected run(commandId: string): void {
        if (this.commands.getCommand(commandId)) {
            this.commands.executeCommand(commandId);
        }
    }

    protected openProject(project: RecentProject): void {
        this.workspace.open(new URI(project.uri), { preserveWindow: true });
    }

    protected async cloneRepository(): Promise<void> {
        const url = await this.quickInput.input({ prompt: CLONE_PROMPT, placeHolder: 'https://github.com/owner/repo.git' });
        if (!url) {
            return;
        }
        const target = this.home ? `${this.home}/${repoNameFromUrl(url)}` : repoNameFromUrl(url);
        const terminal = await this.terminals.newTerminal({ title: CLONE_TERMINAL_TITLE, cwd: this.home });
        await terminal.start();
        this.terminals.open(terminal);
        terminal.sendText(`git clone ${JSON.stringify(url.trim())} ${JSON.stringify(target)}\r`);
    }

    protected setTab(tab: WelcomeTab): void {
        this.tab = tab;
        this.update();
    }

    protected render(): React.ReactNode {
        return <div className='ingot-welcome-root'>
            <nav className='ingot-welcome-nav'>
                <div className='ingot-welcome-brand'>
                    <span className='ingot-welcome-logo ingot-app-icon' />
                    <div>
                        <div className='ingot-welcome-name'>{PRODUCT.name}</div>
                        <div className='ingot-welcome-version'>{PRODUCT.version}</div>
                    </div>
                </div>
                {WELCOME_TABS.map(t => (
                    <button key={t.id} id={`ingot-welcome-tab-${t.id}`} type='button' className={`ingot-welcome-navitem ${this.tab === t.id ? 'active' : ''}`} onClick={() => this.setTab(t.id)}>{t.label}</button>
                ))}
            </nav>
            <main className='ingot-welcome-main'>{this.renderTab()}</main>
        </div>;
    }

    protected renderTab(): React.ReactNode {
        switch (this.tab) {
            case 'customize': return this.renderCustomize();
            case 'plugins': return this.renderPlugins();
            case 'learn': return this.renderLearn();
            default: return this.renderProjects();
        }
    }

    protected renderProjects(): React.ReactNode {
        const projects = toRecentProjects(this.recentUris, this.home, this.filter);
        return <div className='ingot-welcome-projects'>
            <div className='ingot-welcome-actions'>
                <input id='ingot-welcome-search' className='theia-input ingot-welcome-search' placeholder='Search projects' value={this.filter}
                    onChange={e => { this.filter = e.currentTarget.value; this.update(); }} />
                <button id='ingot-welcome-new' type='button' className='theia-button secondary' onClick={() => this.run(WELCOME_COMMANDS.newFile)}>New File</button>
                <button id='ingot-welcome-open' type='button' className='theia-button secondary' onClick={() => this.run(WELCOME_COMMANDS.openFolder)}>Open</button>
                <button id='ingot-welcome-open-workspace' type='button' className='theia-button secondary' onClick={() => this.run(WELCOME_COMMANDS.openWorkspace)}>Open Workspace</button>
                <button id='ingot-welcome-clone' type='button' className='theia-button secondary' onClick={() => this.cloneRepository()}>Get from VCS</button>
            </div>
            {projects.length === 0
                ? <div className='ingot-welcome-empty'>No recent projects yet. Open a folder or clone a repository to get started.</div>
                : <ul className='ingot-welcome-list'>
                    {projects.map(p => (
                        <li key={p.uri}>
                            <button type='button' className='ingot-welcome-project' title={p.path} onClick={() => this.openProject(p)}>
                                <span className='ingot-welcome-initials'>{p.initials}</span>
                                <span className='ingot-welcome-project-text'>
                                    <span className='ingot-welcome-project-name'>{p.name}{p.kind !== 'folder' && <span className='ingot-badge'>{p.kind}</span>}</span>
                                    <span className='ingot-welcome-project-path'>{p.path}</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>}
        </div>;
    }

    protected renderCustomize(): React.ReactNode {
        const current = this.appearance.mode;
        return <div className='ingot-welcome-section'>
            <h2>Color theme</h2>
            <div className='ingot-welcome-themes'>
                {THEME_CHOICES.map(t => (
                    <button key={t.id} id={`ingot-theme-${t.id}`} type='button' className={`ingot-welcome-theme ${t.id} ${current === t.id ? 'active' : ''}`} onClick={async () => { await this.appearance.setMode(t.id); this.update(); }}>
                        <span className='ingot-welcome-theme-preview' />
                        <span>{t.label}</span>
                    </button>
                ))}
            </div>
            <h2>Keymap</h2>
            <p>Ingot ({navigator.platform.toLowerCase().includes('mac') ? 'macOS' : 'Windows/Linux'}) is the default keymap.</p>
            <button type='button' className='theia-button secondary' onClick={() => this.run(WELCOME_COMMANDS.keymap)}>Configure keymap</button>
            <button type='button' className='theia-button secondary' onClick={() => this.run(WELCOME_COMMANDS.settings)}>All settings…</button>
        </div>;
    }

    protected renderPlugins(): React.ReactNode {
        return <div className='ingot-welcome-section'>
            <h2>Plugins</h2>
            <p>Install themes, languages and tools from Open VSX.</p>
            <button id='ingot-welcome-open-plugins' type='button' className='theia-button' onClick={() => this.run(WELCOME_COMMANDS.plugins)}>Open Plugins</button>
        </div>;
    }

    protected renderLearn(): React.ReactNode {
        return <div className='ingot-welcome-section'>
            <h2>Learn</h2>
            <ul className='ingot-welcome-links'>
                {LEARN_LINKS.map(l => <li key={l.url}><a href={l.url} onClick={e => { e.preventDefault(); this.windows.openNewWindow(l.url, { external: true }); }}>{l.label}</a></li>)}
            </ul>
        </div>;
    }
}
