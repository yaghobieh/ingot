import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { IngotAgentManagerWidget } from './agent-manager-widget';
import { AGENT_MANAGER_COMMANDS, AGENT_MANAGER_WIDGET_ID, AGENT_MANAGER_WIDGET_LABEL } from './agent-manager.consts';

/** IDEA-291: Agents › Agent Manager and Jump to Next Agent Approval (Find Action and the Ingot keymap). */
@injectable()
export class IngotAgentManagerContribution extends AbstractViewContribution<IngotAgentManagerWidget> {

    constructor() {
        super({ widgetId: AGENT_MANAGER_WIDGET_ID, widgetName: AGENT_MANAGER_WIDGET_LABEL, defaultWidgetOptions: { area: 'bottom' }, toggleCommandId: AGENT_MANAGER_COMMANDS.toggle.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(AGENT_MANAGER_COMMANDS.nextApproval, {
            execute: async () => (await this.openView({ activate: true, reveal: true })).jumpToNextApproval()
        });
    }
}
