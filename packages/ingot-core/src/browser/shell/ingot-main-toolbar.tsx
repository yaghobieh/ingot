import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { MAIN_MENU_BAR } from '@theia/core/lib/common/menu';
import { environment } from '@theia/core/shared/@theia/application-package/lib/environment';
import { isOSX } from '@theia/core/lib/common/os';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { AgentStore } from '../agents/agent-store';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { pickRunScript } from '../../common/vcs/vcs.utils';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { toRecentProjects } from '../../common/welcome/welcome.utils';
import type { RecentProject } from '../../common/welcome/welcome.types';
import { projectDisplayName } from '../../common/workspace/workspace.utils';
import { PROJECT_POPUP_ACTIONS, PROJECT_POPUP_RECENT_LIMIT } from './ingot-shell.consts';
import { MAIN_TOOLBAR_CLASS, MAIN_TOOLBAR_ID, NO_PROJECT_LABEL, NO_VCS_LABEL, RUN_CONFIGURATION_LABEL, TOOLBAR_COMMANDS } from './ingot-shell.consts';

interface ToolbarButtonProps {
    readonly id: string;
    readonly title: string;
    readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    readonly icon?: string;
    readonly label?: string;
    readonly dropdown?: boolean;
    readonly className?: string;
}

/** Monochrome Ingot mark drawn on the accent logo square. */
const LOGO_GLYPH = <svg viewBox='0 0 256 256' width='14' height='14' aria-hidden='true'>
    <polygon points='88,76 168,76 186,110 70,110' fill='currentColor' opacity='.75' />
    <polygon points='70,110 186,110 210,190 46,190' fill='currentColor' />
</svg>;

const ToolbarButton = ({ id, icon, title, onClick, label, dropdown, className }: ToolbarButtonProps): React.ReactElement => (
    <button id={id} type='button' className={`ingot-tb-button ${label ? 'ingot-tb-widget' : ''} ${className ?? ''}`} title={title} aria-label={title} onClick={onClick}>
        {icon && <span className={`ingot-icon ingot-icon-${icon}`} />}
        {label && <span className='ingot-tb-label'>{label}</span>}
        {dropdown && <span className='ingot-tb-caret'>▾</span>}
    </button>
);

/** Slim Ingot UI main toolbar matching docs/design/ide-reference.png (IDEA-13). */
@injectable()
export class IngotMainToolbar extends ReactWidget {

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;
    @inject(IngotBranchService) protected readonly branches: IngotBranchService;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected runScript?: string;
    protected projectPopupOpen = false;
    protected recentProjects: RecentProject[] = [];
    protected popupAnchor = { left: 0, top: 0 };

    protected readonly closeOnOutsideClick = (event: MouseEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target && !target.closest('#ingot-project-popup, #ingot-tb-project')) {
            this.closeProjectPopup();
        }
    };

    protected readonly closeOnEscape = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            this.closeProjectPopup();
        }
    };

    @postConstruct()
    protected init(): void {
        this.id = MAIN_TOOLBAR_ID;
        this.addClass(MAIN_TOOLBAR_CLASS);
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.loadRunScript()));
        this.toDispose.push(this.workspace.onWorkspaceLocationChanged(() => this.update()));
        this.toDispose.push(this.branches.onDidChange(() => this.update()));
        this.toDispose.push(this.agents.onDidChange(() => this.update()));
        this.loadRunScript();
        this.toDispose.push({ dispose: () => this.removePopupListeners() });
    }

    protected async toggleProjectPopup(): Promise<void> {
        if (this.projectPopupOpen) {
            this.closeProjectPopup();
            return;
        }
        const [recent, homeUri] = await Promise.all([this.workspace.recentWorkspaces(), this.env.getHomeDirUri()]);
        const current = this.workspace.workspace?.resource.toString();
        this.recentProjects = toRecentProjects(recent.filter(uri => uri !== current), new URI(homeUri).path.fsPath()).slice(0, PROJECT_POPUP_RECENT_LIMIT);
        const rect = document.getElementById('ingot-tb-project')?.getBoundingClientRect();
        this.popupAnchor = { left: rect?.left ?? 0, top: (rect?.bottom ?? 0) + 4 };
        this.projectPopupOpen = true;
        document.addEventListener('mousedown', this.closeOnOutsideClick, true);
        document.addEventListener('keydown', this.closeOnEscape, true);
        this.update();
    }

    protected closeProjectPopup(): void {
        this.projectPopupOpen = false;
        this.removePopupListeners();
        this.update();
    }

    protected removePopupListeners(): void {
        document.removeEventListener('mousedown', this.closeOnOutsideClick, true);
        document.removeEventListener('keydown', this.closeOnEscape, true);
    }

    protected openRecent(project: RecentProject): void {
        this.closeProjectPopup();
        this.workspace.open(new URI(project.uri), { preserveWindow: true });
    }

    protected runFromPopup(commandId: string): void {
        this.closeProjectPopup();
        this.run(commandId);
    }

    protected renderProjectPopup(): React.ReactNode {
        if (!this.projectPopupOpen) {
            return undefined;
        }
        return <div id='ingot-project-popup' className='ingot-project-popup' role='menu' style={{ left: this.popupAnchor.left, top: this.popupAnchor.top }}>
            {this.recentProjects.length > 0 && <div className='ingot-project-popup-heading'>Recent projects</div>}
            {this.recentProjects.map(p => (
                <button key={p.uri} type='button' role='menuitem' className='ingot-project-popup-item ingot-project-popup-recent' title={p.path} onClick={() => this.openRecent(p)}>
                    <span className='ingot-welcome-initials'>{p.initials}</span>
                    <span className='ingot-project-popup-text'>
                        <span className='ingot-project-popup-name'>{p.name}{p.kind !== 'folder' && <span className='ingot-badge'>{p.kind}</span>}</span>
                        <span className='ingot-project-popup-path'>{p.path}</span>
                    </span>
                </button>
            ))}
            {this.recentProjects.length > 0 && <div className='ingot-project-popup-separator' />}
            {PROJECT_POPUP_ACTIONS.filter(a => !a.requiresWorkspace || this.workspace.opened).map(a => (
                <button key={a.id} id={`ingot-project-action-${a.id}`} type='button' role='menuitem' className='ingot-project-popup-item' onClick={() => this.runFromPopup(a.command)}>{a.label}</button>
            ))}
        </div>;
    }

    /** Uses the project's `dev`/`start` npm script as the default run configuration, like a full IDE. */
    protected async loadRunScript(): Promise<void> {
        const [root] = this.workspace.tryGetRoots();
        this.runScript = undefined;
        if (root) {
            try {
                const content = await this.files.read(root.resource.resolve('package.json'));
                this.runScript = pickRunScript(content.value);
            } catch {
                this.runScript = undefined;
            }
        }
        this.update();
    }

    protected run(commandId: string, ...args: unknown[]): void {
        if (this.commands.getCommand(commandId)) {
            this.commands.executeCommand(commandId, ...args);
        }
    }

    protected get showMainMenuButton(): boolean {
        return !(environment.electron.is() && isOSX);
    }

    protected openMainMenu(event: React.MouseEvent<HTMLButtonElement>): void {
        const rect = event.currentTarget.getBoundingClientRect();
        this.contextMenu.render({ menuPath: MAIN_MENU_BAR, anchor: { x: rect.left, y: rect.bottom }, context: event.currentTarget, includeAnchorArg: false });
    }

    protected get projectLabel(): string {
        const workspaceFile = this.workspace.saved ? this.workspace.workspace : undefined;
        if (workspaceFile && !workspaceFile.isDirectory) {
            return projectDisplayName(workspaceFile.resource.path.toString());
        }
        const [root] = this.workspace.tryGetRoots();
        return root ? root.resource.path.base : NO_PROJECT_LABEL;
    }

    protected render(): React.ReactNode {
        const active = this.agents.activeCount;
        return <div className='ingot-tb'>
            <div className='ingot-tb-left'>
                {this.showMainMenuButton
                    ? <button id='ingot-tb-menu' type='button' className='ingot-tb-logo' title='Main menu' aria-label='Main menu' onClick={e => this.openMainMenu(e)}>{LOGO_GLYPH}</button>
                    : <span className='ingot-tb-logo' title='Ingot'>{LOGO_GLYPH}</span>}
                <ToolbarButton id='ingot-tb-project' title='Project' label={this.projectLabel} dropdown onClick={() => this.toggleProjectPopup()} />
                {this.renderProjectPopup()}
                <ToolbarButton id='ingot-tb-vcs' icon='branch' title='Git branch' label={this.branches.branch ?? NO_VCS_LABEL} dropdown onClick={() => this.run(this.branches.branch ? TOOLBAR_COMMANDS.branches : TOOLBAR_COMMANDS.git)} />
            </div>
            <div className='ingot-tb-right'>
                <ToolbarButton id='ingot-tb-run-config' icon='run' title='Run configuration' label={this.runScript ?? RUN_CONFIGURATION_LABEL} className='ingot-tb-run' onClick={() => this.run(TOOLBAR_COMMANDS.runTask)} />
                <button id='ingot-tb-search' type='button' className='ingot-tb-search' title='Search Everywhere (Double Shift)' onClick={() => this.run(TOOLBAR_COMMANDS.searchEverywhere)}>
                    <span className='ingot-icon ingot-icon-search' />
                    <span className='ingot-tb-search-text'>Search everywhere</span>
                    <span className='ingot-tb-search-kbd'>Shift Shift</span>
                </button>
                <button id='ingot-tb-agents' type='button' className='ingot-tb-agents' title='Agents' onClick={() => this.run(AGENT_COMMANDS.toggle.id)}>
                    Agents{active ? ` · ${active}` : ''}
                </button>
                <button id='ingot-tb-theme' type='button' className='ingot-tb-button' title='Theme: Light, Dark or System' aria-label='Theme' onClick={() => this.run(TOOLBAR_COMMANDS.theme)}>
                    <span className='codicon codicon-color-mode' />
                </button>
                <ToolbarButton id='ingot-tb-settings' icon='settings' title='Settings' onClick={() => this.run(TOOLBAR_COMMANDS.settings)} />
            </div>
        </div>;
    }
}
