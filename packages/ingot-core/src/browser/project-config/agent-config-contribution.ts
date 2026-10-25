import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotMcpClient } from './mcp-client';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { IngotAgentConfigWidget } from './agent-config-widget';
import { AGENT_CONFIG_OPEN_COMMAND, AGENT_CONFIG_WIDGET_ID, AGENT_CONFIG_WIDGET_LABEL } from './project-config.browser-consts';

@injectable()
export class IngotAgentConfigContribution extends AbstractViewContribution<IngotAgentConfigWidget> implements FrontendApplicationContribution {

    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    constructor() {
        super({ widgetId: AGENT_CONFIG_WIDGET_ID, widgetName: AGENT_CONFIG_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    /** Starts the MCP servers the user already enabled for this project. */
    async onStart(): Promise<void> {
        await this.workspace.ready;
        await this.mcp.refresh();
    }

    override registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AGENT_CONFIG_OPEN_COMMAND, { execute: () => this.openView({ activate: true, reveal: true }) });
    }
}
