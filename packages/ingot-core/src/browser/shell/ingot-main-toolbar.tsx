import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { MAIN_MENU_BAR } from '@theia/core/lib/common/menu';
import { environment } from '@theia/core/shared/@theia/application-package/lib/environment';
import { isOSX } from '@theia/core/lib/common/os';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotBranchService } from '../vcs/ingot-branch-service';
import { MAIN_TOOLBAR_CLASS, MAIN_TOOLBAR_ID, NO_PROJECT_LABEL, NO_VCS_LABEL, RUN_CONFIGURATION_LABEL, TOOLBAR_COMMANDS } from './ingot-shell.consts';

interface ToolbarButtonProps {
    readonly id: string;
    readonly icon: string;
    readonly title: string;
    readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    readonly label?: string;
    readonly dropdown?: boolean;
    readonly className?: string;
}

const ToolbarButton = ({ id, icon, title, onClick, label, dropdown, className }: ToolbarButtonProps): React.ReactElement => (
    <button id={id} type='button' className={`ingot-tb-button ${label ? 'ingot-tb-widget' : ''} ${className ?? ''}`} title={title} aria-label={title} onClick={onClick}>
        <span className={`ingot-icon ingot-icon-${icon}`} />
        {label && <span className='ingot-tb-label'>{label}</span>}
        {dropdown && <span className='ingot-icon ingot-icon-chevron-down ingot-tb-chevron' />}
    </button>
);

/** JetBrains New UI-style main toolbar (IDEA-13). */
@injectable()
export class IngotMainToolbar extends ReactWidget {

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(ContextMenuRenderer)
    protected readonly contextMenu: ContextMenuRenderer;

    /** macOS Electron keeps the native menu bar; everywhere else the main menu sits behind a hamburger like JetBrains. */
    protected get showMainMenuButton(): boolean {
        return !(environment.electron.is() && isOSX);
    }

    protected openMainMenu(event: React.MouseEvent<HTMLButtonElement>): void {
        const rect = event.currentTarget.getBoundingClientRect();
        this.contextMenu.render({ menuPath: MAIN_MENU_BAR, anchor: { x: rect.left, y: rect.bottom }, context: event.currentTarget, includeAnchorArg: false });
    }

    @inject(IngotBranchService)
    protected readonly branches: IngotBranchService;

    @postConstruct()
    protected init(): void {
        this.id = MAIN_TOOLBAR_ID;
        this.addClass(MAIN_TOOLBAR_CLASS);
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.update()));
        this.toDispose.push(this.branches.onDidChange(() => this.update()));
        this.update();
    }

    protected run(commandId: string): void {
        if (this.commands.getCommand(commandId)) {
            this.commands.executeCommand(commandId);
        }
    }

    protected get projectLabel(): string {
        const [root] = this.workspace.tryGetRoots();
        return root ? root.resource.path.base : NO_PROJECT_LABEL;
    }

    protected get vcsLabel(): string {
        return this.branches.branch ?? NO_VCS_LABEL;
    }

    protected render(): React.ReactNode {
        return <div className='ingot-tb'>
            <div className='ingot-tb-left'>
                {this.showMainMenuButton && <ToolbarButton id='ingot-tb-menu' icon='menu' title='Main menu' onClick={e => this.openMainMenu(e)} className='ingot-tb-menu' />}
                <span className='ingot-tb-logo ingot-brand-mark' title='Ingot' />
                <ToolbarButton id='ingot-tb-project' icon='project' title='Project' label={this.projectLabel} dropdown onClick={() => this.run(this.workspace.opened ? TOOLBAR_COMMANDS.openRecent : TOOLBAR_COMMANDS.openFolder)} />
                <ToolbarButton id='ingot-tb-vcs' icon='branch' title='Version control' label={this.vcsLabel} dropdown onClick={() => this.run(TOOLBAR_COMMANDS.git)} />
            </div>
            <div className='ingot-tb-right'>
                <ToolbarButton id='ingot-tb-run-config' icon='run' title='Run/Debug configurations' label={RUN_CONFIGURATION_LABEL} dropdown className='ingot-tb-runconfig' onClick={() => this.run(TOOLBAR_COMMANDS.runTask)} />
                <ToolbarButton id='ingot-tb-run' icon='run' title='Run' className='ingot-tb-run' onClick={() => this.run(TOOLBAR_COMMANDS.runTask)} />
                <ToolbarButton id='ingot-tb-debug' icon='debug' title='Debug' onClick={() => this.run(TOOLBAR_COMMANDS.debugStart)} />
                <ToolbarButton id='ingot-tb-stop' icon='stop' title='Stop' onClick={() => this.run(TOOLBAR_COMMANDS.debugStop)} />
                <span className='ingot-tb-separator' />
                <ToolbarButton id='ingot-tb-search' icon='search' title='Search Everywhere (Double Shift)' onClick={() => this.run(TOOLBAR_COMMANDS.searchEverywhere)} />
                <ToolbarButton id='ingot-tb-plugins' icon='plugins' title='Plugins' onClick={() => this.run(TOOLBAR_COMMANDS.plugins)} />
                <ToolbarButton id='ingot-tb-settings' icon='settings' title='Settings' onClick={() => this.run(TOOLBAR_COMMANDS.settings)} />
            </div>
        </div>;
    }
}
