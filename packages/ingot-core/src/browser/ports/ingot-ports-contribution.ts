import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { IngotPortsWidget } from './ingot-ports-widget';
import { PORTS_REFRESH_COMMAND, PORTS_TOGGLE_COMMAND, PORTS_WIDGET_ID, PORTS_WIDGET_LABEL } from './ingot-ports.consts';

@injectable()
export class IngotPortsContribution extends AbstractViewContribution<IngotPortsWidget> {

    constructor() {
        super({ widgetId: PORTS_WIDGET_ID, widgetName: PORTS_WIDGET_LABEL, defaultWidgetOptions: { area: 'bottom' }, toggleCommandId: PORTS_TOGGLE_COMMAND.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(PORTS_REFRESH_COMMAND, { execute: async () => (await this.openView({ activate: true })).refresh() });
    }
}
