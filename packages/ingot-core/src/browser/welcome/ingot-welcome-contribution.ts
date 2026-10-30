import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, CommonMenus, type FrontendApplication, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { isAgentsWindow } from '../workbench/agents-window';
import { INGOT_SHELL_COMMANDS } from '../shell/ingot-shell.consts';
import { IngotWelcomeWidget } from './ingot-welcome-widget';
import { NO_FOLDER_BODY_CLASS, WELCOME_WIDGET_ID, WELCOME_WIDGET_LABEL } from './ingot-welcome.consts';

const SIDE_AREAS = ['left', 'right', 'bottom'] as const;

@injectable()
export class IngotWelcomeContribution extends AbstractViewContribution<IngotWelcomeWidget> implements FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    constructor() {
        super({ widgetId: WELCOME_WIDGET_ID, widgetName: WELCOME_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    onStart(_app: FrontendApplication): void {
        void this.workspace.ready.then(() => document.body.classList.toggle(NO_FOLDER_BODY_CLASS, !this.workspace.opened && !isAgentsWindow()));
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        await this.workspace.ready;
        if (this.workspace.opened || isAgentsWindow()) {
            return;
        }
        // IDEA-266: a window without a folder (File > New Window) is only the welcome screen: no agent chat until a folder opens.
        this.shell.getWidgetById(AGENTS_WIDGET_ID)?.close();
        await this.openView({ activate: true, reveal: true });
        for (const area of SIDE_AREAS) {
            await this.shell.collapsePanel(area);
        }
    }

    override registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_SHELL_COMMANDS.showWelcome, { execute: () => this.openView({ activate: true, reveal: true }) });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, { commandId: INGOT_SHELL_COMMANDS.showWelcome.id, label: INGOT_SHELL_COMMANDS.showWelcome.label, order: '0' });
    }
}
