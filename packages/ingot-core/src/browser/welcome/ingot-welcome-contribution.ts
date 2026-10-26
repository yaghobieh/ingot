import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, CommonMenus, type FrontendApplication, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { INGOT_SHELL_COMMANDS } from '../shell/ingot-shell.consts';
import { IngotWelcomeWidget } from './ingot-welcome-widget';
import { WELCOME_WIDGET_ID, WELCOME_WIDGET_LABEL } from './ingot-welcome.consts';

@injectable()
export class IngotWelcomeContribution extends AbstractViewContribution<IngotWelcomeWidget> implements FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(IngotAgentsContribution)
    protected readonly agents: IngotAgentsContribution;

    constructor() {
        super({ widgetId: WELCOME_WIDGET_ID, widgetName: WELCOME_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        await this.workspace.ready;
        if (!this.workspace.opened) {
            // IDEA-165: a window without a folder opens on the welcome page with the agent chat on the right.
            await this.openView({ activate: true, reveal: true });
            await this.agents.openView({ activate: false, reveal: true });
            await this.shell.collapsePanel('left');
        }
    }

    override registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_SHELL_COMMANDS.showWelcome, { execute: () => this.openView({ activate: true, reveal: true }) });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, { commandId: INGOT_SHELL_COMMANDS.showWelcome.id, label: INGOT_SHELL_COMMANDS.showWelcome.label, order: '0' });
    }
}
