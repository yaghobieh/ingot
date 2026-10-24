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

const ToolbarButton = ({ id, icon, title, onClick, label, dropdown, className }: ToolbarButtonProps): React.ReactElement => (
    <button id={id} type='button' className={`ingot-tb-button ${label ? 'ingot-tb-widget' : ''} ${className ?? ''}`} title={title} aria-label={title} onClick={onClick}>
        {icon && <span className={`ingot-icon ingot-icon-${icon}`} />}
        {label && <span className='ingot-tb-label'>{label}</span>}
        {dropdown && <span className='ingot-tb-caret'>▾</span>}
    </button>
);

/** Slim JetBrains New UI main toolbar matching docs/design/ide-reference.png (IDEA-13). */
@injectable()
export class IngotMainToolbar extends ReactWidget {

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;
    @inject(IngotBranchService) protected readonly branches: IngotBranchService;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(FileService) protected readonly files: FileService;

    protected runScript?: string;

    @postConstruct()
    protected init(): void {
        this.id = MAIN_TOOLBAR_ID;
        this.addClass(MAIN_TOOLBAR_CLASS);
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.loadRunScript()));
        this.toDispose.push(this.branches.onDidChange(() => this.update()));
        this.toDispose.push(this.agents.onDidChange(() => this.update()));
        this.loadRunScript();
    }

    /** Uses the project's `dev`/`start` npm script as the default run configuration, like WebStorm. */
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
        const [root] = this.workspace.tryGetRoots();
        return root ? root.resource.path.base : NO_PROJECT_LABEL;
    }

    protected render(): React.ReactNode {
        const active = this.agents.activeCount;
        return <div className='ingot-tb'>
            <div className='ingot-tb-left'>
                {this.showMainMenuButton && <ToolbarButton id='ingot-tb-menu' icon='menu' title='Main menu' onClick={e => this.openMainMenu(e)} className='ingot-tb-menu' />}
                <span className='ingot-tb-logo ingot-brand-mark' title='Ingot' />
                <ToolbarButton id='ingot-tb-project' title='Project' label={this.projectLabel} dropdown onClick={() => this.run(this.workspace.opened ? TOOLBAR_COMMANDS.openRecent : TOOLBAR_COMMANDS.openFolder)} />
                <ToolbarButton id='ingot-tb-vcs' icon='branch' title='Git branch' label={this.branches.branch ?? NO_VCS_LABEL} dropdown onClick={() => this.run(TOOLBAR_COMMANDS.git)} />
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
                <ToolbarButton id='ingot-tb-settings' icon='settings' title='Settings' onClick={() => this.run(TOOLBAR_COMMANDS.settings)} />
            </div>
        </div>;
    }
}
