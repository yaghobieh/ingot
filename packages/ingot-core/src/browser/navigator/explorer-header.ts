import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EXPLORER_ACTIONS, EXPLORER_COLLAPSED_KEY, EXPLORER_CONTAINER_ID, EXPLORER_HEADER_TEXT, FILE_NAVIGATOR_WIDGET_ID } from './navigator.consts';

/**
 * Explorer header (IDEA-93): the project name with a chevron that folds the file tree, and New File, New Folder,
 * Refresh and Collapse All icons. Both live in the left side panel title bar and only show while the Project view is
 * the current one.
 */
@injectable()
export class IngotExplorerHeader {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    protected toggle?: HTMLButtonElement;

    attach(): void {
        const bar = this.shell.leftPanelHandler.toolBar.node;
        if (this.toggle || !bar) {
            return;
        }
        const button = document.createElement('button');
        button.id = 'ingot-explorer-toggle';
        button.type = 'button';
        button.className = 'ingot-explorer-toggle codicon codicon-chevron-down';
        button.addEventListener('click', () => this.setCollapsed(!this.collapsed));
        bar.insertBefore(button, bar.firstChild);
        this.toggle = button;
        bar.appendChild(this.renderActions());
        this.setCollapsed(localStorage.getItem(EXPLORER_COLLAPSED_KEY) === 'true');
        // Clicking the project name folds the tree too, like the root node of a project tree.
        bar.querySelector('.theia-sidepanel-title')?.addEventListener('click', () => {
            if (this.isExplorerCurrent()) {
                this.setCollapsed(!this.collapsed);
            }
        });
        // Re-read after the side panel has switched views (the signals fire mid-switch).
        const apply = () => document.body.classList.toggle('ingot-explorer-current', this.isExplorerCurrent());
        const sync = () => { apply(); requestAnimationFrame(apply); setTimeout(apply, 100); };
        this.shell.leftPanelHandler.tabBar.currentChanged.connect(sync);
        this.shell.leftPanelHandler.dockPanel.layoutModified.connect(sync);
        this.shell.onDidChangeCurrentWidget(sync);
        this.shell.onDidChangeActiveWidget(sync);
        sync();
    }

    protected renderActions(): HTMLElement {
        const actions = document.createElement('div');
        actions.className = 'ingot-explorer-actions';
        for (const action of EXPLORER_ACTIONS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.id = `ingot-explorer-${action.id}`;
            b.className = `ingot-explorer-action codicon codicon-${action.icon}`;
            b.title = action.title;
            b.setAttribute('aria-label', action.title);
            b.addEventListener('click', () => this.run(action.command));
            actions.appendChild(b);
        }
        return actions;
    }

    protected async run(command: string): Promise<void> {
        if (this.collapsed) {
            this.setCollapsed(false);
        }
        const navigator = await this.widgets.getWidget(FILE_NAVIGATOR_WIDGET_ID);
        await this.commands.executeCommand(command, navigator);
    }

    get collapsed(): boolean {
        return document.body.classList.contains('ingot-explorer-collapsed');
    }

    setCollapsed(collapsed: boolean): void {
        document.body.classList.toggle('ingot-explorer-collapsed', collapsed);
        localStorage.setItem(EXPLORER_COLLAPSED_KEY, String(collapsed));
        if (this.toggle) {
            const label = collapsed ? EXPLORER_HEADER_TEXT.expand : EXPLORER_HEADER_TEXT.collapse;
            this.toggle.title = label;
            this.toggle.setAttribute('aria-label', label);
            this.toggle.setAttribute('aria-expanded', String(!collapsed));
        }
    }

    protected isExplorerCurrent(): boolean {
        const handler = this.shell.leftPanelHandler;
        return handler.tabBar.currentTitle?.owner.id === EXPLORER_CONTAINER_ID && this.shell.isExpanded('left');
    }
}
