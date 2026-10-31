import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { MAIN_MENU_BAR } from '@theia/core/lib/common/menu';
import { environment } from '@theia/core/shared/@theia/application-package/lib/environment';
import { isOSX } from '@theia/core/lib/common/os';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { AgentStore } from '../agents/agent-store';
import type { HarmonyPiece } from '../../common/agents/harmony';
import { HarmonyBubble } from '../agents/harmony-bubble';
import { AGENT_COMMANDS, AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ZAPREX_LINK_LABEL } from '../agents/zaprex-link.consts';
import { ZaprexLauncher } from '../agents/zaprex-launcher';
import { IngotAccountService } from '../account/account-service';
import { IngotPlanService } from '../plan/plan-service';
import { PLAN_COMMANDS, PLAN_TEXT } from '../plan/plan.browser-consts';
import { TITLEBAR_COMMANDS, TITLEBAR_REFRESH_DELAYS_MS, TITLEBAR_TEXT, TOGGLE_BOTTOM_PANEL_COMMAND } from '../workbench/titlebar.consts';
import { pickRunScript } from '../../common/vcs/vcs.utils';
import { IngotDebugLauncher } from '../debug/ingot-debug-launcher';
import { DebugState } from '@theia/debug/lib/browser/debug-session';
import { DEBUG_SESSION_COMMANDS, INGOT_DEBUG_COMMANDS } from '../../common/debug/debug.consts';
import { DEBUG_TOOLBAR_TEXT } from '../debug/debug.browser-consts';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { toRecentProjects } from '../../common/welcome/welcome.utils';
import type { RecentProject } from '../../common/welcome/welcome.types';
import { projectDisplayName } from '../../common/workspace/workspace.utils';
import { PROJECT_POPUP_ACTIONS, PROJECT_POPUP_RECENT_LIMIT } from './ingot-shell.consts';
import { MAIN_TOOLBAR_CLASS, MAIN_TOOLBAR_ID, NO_PROJECT_LABEL, NO_VCS_LABEL, RUN_CONFIGURATION_LABEL, TOOLBAR_COMMANDS, TOOLBAR_LOGO_SIZE } from './ingot-shell.consts';
import { RexMark } from '../brand/rex-mark';

interface ToolbarButtonProps {
    readonly id: string;
    readonly title: string;
    readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    readonly icon?: string;
    readonly label?: string;
    readonly dropdown?: boolean;
    readonly className?: string;
}

/** The Rex </> glyph of the app icon, no tile behind it. */
const LOGO_GLYPH = <RexMark size={TOOLBAR_LOGO_SIZE} />;

const ToolbarButton = ({ id, icon, title, onClick, label, dropdown, className }: ToolbarButtonProps): React.ReactElement => (
    <button id={id} type='button' className={`ingot-tb-button ${label ? 'ingot-tb-widget' : ''} ${className ?? ''}`} title={title} aria-label={title} onClick={onClick}>
        {icon && <span className={`ingot-icon ingot-icon-${icon}`} />}
        {label && <span className='ingot-tb-label'>{label}</span>}
        {dropdown && <span className='ingot-tb-caret'>▾</span>}
    </button>
);

interface IconButtonProps {
    readonly id: string;
    readonly codicon: string;
    readonly title: string;
    readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    readonly disabled?: boolean;
    readonly className?: string;
    readonly pressed?: boolean;
}

const IconButton = ({ id, codicon, title, onClick, disabled, className, pressed }: IconButtonProps): React.ReactElement => (
    <button id={id} type='button' className={`ingot-tb-button ingot-tb-icon ${pressed ? 'pressed' : ''} ${className ?? ''}`} title={title} aria-label={title}
        aria-pressed={pressed} disabled={disabled} onClick={onClick}>
        <span className={`codicon codicon-${codicon}`} />
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
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(ZaprexLauncher) protected readonly zaprex: ZaprexLauncher;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(IngotDebugLauncher) protected readonly debugLauncher: IngotDebugLauncher;
    @inject(IngotPlanService) protected readonly plan: IngotPlanService;

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
        this.toDispose.push(this.account.onDidChange(() => this.update()));
        this.toDispose.push(this.debugLauncher.onDidChange(() => this.update()));
        this.toDispose.push(this.plan.onDidChange(() => this.update()));
        // Stop is enabled only while a run session is alive.
        this.toDispose.push(this.commands.onDidExecuteCommand(() => this.update()));
        this.loadRunScript();
        this.toDispose.push({ dispose: () => this.removePopupListeners() });
        // The panel and chat toggles show whether their panel is open.
        this.toDispose.push(this.shell.onDidChangeActiveWidget(() => this.refreshSoon()));
        this.toDispose.push(this.shell.onDidChangeCurrentWidget(() => this.refreshSoon()));
        this.shell.bottomPanel.layoutModified.connect(() => this.update());
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

    /** Selected run/debug configuration, else the project's npm script, else the first detected configuration. */
    protected get runConfigurationLabel(): string {
        return this.debugLauncher.explicitName ?? this.runScript ?? this.debugLauncher.selectedName ?? RUN_CONFIGURATION_LABEL;
    }

    /** Step controls while a debug session runs (IDEA-138): Resume / Pause, Step Over, Into, Out, Restart. */
    protected renderDebugControls(): React.ReactNode {
        const session = this.debugLauncher.currentSession;
        if (!session) {
            return undefined;
        }
        const paused = session.state === DebugState.Stopped;
        const t = DEBUG_TOOLBAR_TEXT;
        return <div className='ingot-tb-debug-controls' id='ingot-tb-debug-controls' role='toolbar' aria-label={t.controls}>
            {paused
                ? <IconButton id='ingot-tb-dbg-continue' codicon='debug-continue' title={t.resume} className='ingot-tb-dbg-continue' onClick={() => this.run(DEBUG_SESSION_COMMANDS.continue)} />
                : <IconButton id='ingot-tb-dbg-pause' codicon='debug-pause' title={t.pause} onClick={() => this.run(DEBUG_SESSION_COMMANDS.pause)} />}
            <IconButton id='ingot-tb-dbg-step-over' codicon='debug-step-over' title={t.stepOver} disabled={!paused} onClick={() => this.run(DEBUG_SESSION_COMMANDS.stepOver)} />
            <IconButton id='ingot-tb-dbg-step-into' codicon='debug-step-into' title={t.stepInto} disabled={!paused} onClick={() => this.run(DEBUG_SESSION_COMMANDS.stepInto)} />
            <IconButton id='ingot-tb-dbg-step-out' codicon='debug-step-out' title={t.stepOut} disabled={!paused} onClick={() => this.run(DEBUG_SESSION_COMMANDS.stepOut)} />
            <IconButton id='ingot-tb-dbg-restart' codicon='debug-restart' title={t.restart} onClick={() => this.run(DEBUG_SESSION_COMMANDS.restart)} />
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

    protected refreshSoon(): void {
        this.update();
        for (const delay of TITLEBAR_REFRESH_DELAYS_MS) {
            setTimeout(() => !this.isDisposed && this.update(), delay);
        }
    }

    protected get bottomPanelOpen(): boolean {
        return this.shell.isExpanded('bottom');
    }

    protected get chatOpen(): boolean {
        const chat = this.shell.getWidgetById(AGENTS_WIDGET_ID);
        return !!chat?.isVisible;
    }

    protected toggle(commandId: string): void {
        this.run(commandId);
        this.refreshSoon();
    }

    /**
     * IDEA-179: the one Zaprex entry point in the IDE (the Manage gear stays at the bottom of the left stripe).
     * A transparent T-rex that idles with a slow sway; it opens the separate Zaprex app.
     */
    protected renderZaprex(): React.ReactNode {
        const offer = this.agents.harmonyEnabled ? this.agents.harmonyOffer : undefined;
        const busy = this.agents.zaprexBusy;
        const label = busy ? `${ZAPREX_LINK_LABEL} · Zaprex is working on a piece (Harmony mode)` : ZAPREX_LINK_LABEL;
        return <span className='ingot-tb-zaprex-anchor'>
            <button id='ingot-tb-zaprex' type='button' className={`ingot-tb-button ingot-tb-icon ingot-tb-zaprex${offer || busy ? ' thinking' : ''}`} title={label} aria-label={label}
                onClick={() => void this.zaprex.openApp()}>
                <span className='ingot-zaprex-link-icon ingot-zaprex-trex' aria-hidden='true' />
                {busy && <span className='ingot-tb-zaprex-busy' aria-hidden='true' />}
            </button>
            {offer && this.renderHarmonyBubble(offer.sessionId, offer.piece)}
        </span>;
    }

    /** IDEA-180 Harmony mode: Zaprex offers ONE scoped piece of a heavy agent run, right under the T-rex. */
    protected renderHarmonyBubble(sessionId: string, piece: HarmonyPiece): React.ReactNode {
        if (this.zaprex.installed === undefined) {
            void this.zaprex.info().then(() => this.update());
        }
        return <HarmonyBubble anchorId='ingot-tb-zaprex' piece={piece} desktop={this.zaprex.installed} onGetApp={() => this.zaprex.openWeb()}
            onAccept={() => this.agents.acceptHarmony(sessionId)} onDismiss={() => this.agents.dismissHarmony(sessionId)} />;
    }

    /** Bottom panel and chat icons, the Zaprex T-rex (PRO+ only), then the Agents Window pill (IDEA-118, IDEA-179). On free: one "Upgrade to Pro" pill (IDEA-271). */
    protected renderWindowActions(): React.ReactNode {
        const panel = <IconButton id='ingot-tb-panel' codicon='layout-panel' title={TITLEBAR_TEXT.bottomPanel} pressed={this.bottomPanelOpen} onClick={() => this.toggle(TOGGLE_BOTTOM_PANEL_COMMAND)} />;
        if (!this.plan.can('chat')) {
            return <div className='ingot-tb-window-actions'>
                {panel}
                <button id='ingot-tb-upgrade' type='button' className='ingot-tb-pill' title={PLAN_TEXT.statusTooltip} onClick={() => this.run(PLAN_COMMANDS.upgrade.id)}>
                    <span className='codicon codicon-sparkle' aria-hidden='true' /><span>{PLAN_TEXT.upgrade}</span>
                </button>
            </div>;
        }
        return <div className='ingot-tb-window-actions'>
            {panel}
            <IconButton id='ingot-tb-chat' codicon='comment' title={TITLEBAR_TEXT.chat} pressed={this.chatOpen} onClick={() => this.toggle(AGENT_COMMANDS.toggle.id)} />
            {this.agents.zaprexButtonVisible && this.account.proPlus && this.plan.can('rex') && this.renderZaprex()}
            {this.agents.zaprexButtonVisible && this.plan.can('rex') && this.renderZaprex()}
            <button id='ingot-tb-agents-window' type='button' className='ingot-tb-pill' title={TITLEBAR_TEXT.agentsWindowTitle} onClick={() => this.run(TITLEBAR_COMMANDS.agentsWindow.id)}>
                <span>{TITLEBAR_TEXT.agentsWindow}</span><span className='ingot-tb-pill-arrow' aria-hidden='true'>↗</span>
            </button>
        </div>;
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
                <ToolbarButton id='ingot-tb-project' icon='project' title='Project' label={this.projectLabel} dropdown onClick={() => this.toggleProjectPopup()} />
                {this.renderProjectPopup()}
                <ToolbarButton id='ingot-tb-vcs' icon='branch' title='Git branch' label={this.branches.branch ?? NO_VCS_LABEL} dropdown onClick={() => this.run(this.branches.branch ? TOOLBAR_COMMANDS.branches : TOOLBAR_COMMANDS.git)} />
            </div>
            <div className='ingot-tb-right'>
                <ToolbarButton id='ingot-tb-run-config' icon='run' title={DEBUG_TOOLBAR_TEXT.selectConfiguration} label={this.runConfigurationLabel} dropdown className='ingot-tb-run'
                    onClick={() => this.run(INGOT_DEBUG_COMMANDS.selectConfiguration.id)} />
                <div className='ingot-tb-run-group'>
                    <IconButton id='ingot-tb-run' codicon='play' title={`Run '${this.runConfigurationLabel}'`} className='ingot-tb-play' onClick={() => this.run(TOOLBAR_COMMANDS.run)} />
                    <IconButton id='ingot-tb-debug' codicon='debug-alt-small' title={`Debug '${this.runConfigurationLabel}'`} className='ingot-tb-debug' onClick={() => this.run(TOOLBAR_COMMANDS.debug)} />
                    <IconButton id='ingot-tb-stop' codicon='debug-stop' title='Stop' disabled={!this.commands.isEnabled(TOOLBAR_COMMANDS.stop)} onClick={() => this.run(TOOLBAR_COMMANDS.stop)} />
                </div>
                {this.renderDebugControls()}
                <span className='ingot-tb-sep' />
                <button id='ingot-tb-search' type='button' className='ingot-tb-search' title='Search Everywhere (Double Shift)' onClick={() => this.run(TOOLBAR_COMMANDS.searchEverywhere)}>
                    <span className='ingot-icon ingot-icon-search' />
                    <span className='ingot-tb-search-text'>Search everywhere</span>
                    <span className='ingot-tb-search-kbd'>Shift Shift</span>
                    {active > 0 && <span className='ingot-tb-running' title={`${active} agent${active === 1 ? '' : 's'} running`}>{active}</span>}
                </button>
                {this.renderWindowActions()}
            </div>
        </div>;
    }
}
