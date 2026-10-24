import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { IngotDatabaseWidget } from './database-widget';
import { IngotMcpWidget } from './mcp-widget';
import { IngotServicesWidget } from './services-widget';
import { DATABASE_WIDGET_ID, MCP_WIDGET_ID, SERVICES_WIDGET_ID, TOOL_WINDOW_COMMANDS } from './tool-windows.consts';

@injectable()
export class IngotDatabaseContribution extends AbstractViewContribution<IngotDatabaseWidget> {
    constructor() {
        super({ widgetId: DATABASE_WIDGET_ID, widgetName: 'Database', defaultWidgetOptions: { area: 'right', rank: 200 }, toggleCommandId: TOOL_WINDOW_COMMANDS.database.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(TOOL_WINDOW_COMMANDS.databaseRefresh, { execute: async () => (await this.openView({ activate: true })).refresh() });
    }
}

@injectable()
export class IngotMcpContribution extends AbstractViewContribution<IngotMcpWidget> {
    constructor() {
        super({ widgetId: MCP_WIDGET_ID, widgetName: 'Plugins & MCP', defaultWidgetOptions: { area: 'main' }, toggleCommandId: TOOL_WINDOW_COMMANDS.mcp.id });
    }
}

@injectable()
export class IngotServicesContribution extends AbstractViewContribution<IngotServicesWidget> {
    constructor() {
        super({ widgetId: SERVICES_WIDGET_ID, widgetName: 'Services', defaultWidgetOptions: { area: 'right', rank: 400 }, toggleCommandId: TOOL_WINDOW_COMMANDS.services.id });
    }
}
