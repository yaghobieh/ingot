import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { IngotArtifactsWidget } from './artifacts-widget';
import { ARTIFACTS_COMMANDS, ARTIFACTS_WIDGET_ID, ARTIFACTS_WIDGET_LABEL } from './artifacts.consts';

/** IDEA-290: Agents › Artifacts opens the viewer, optionally on one run (`ingot.artifacts.open <runId>`). */
@injectable()
export class IngotArtifactsContribution extends AbstractViewContribution<IngotArtifactsWidget> {

    constructor() {
        super({ widgetId: ARTIFACTS_WIDGET_ID, widgetName: ARTIFACTS_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' }, toggleCommandId: ARTIFACTS_COMMANDS.open.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(ARTIFACTS_COMMANDS.open, {
            execute: async (runId?: unknown) => (await this.openView({ activate: true, reveal: true })).openRun(typeof runId === 'string' ? runId : undefined)
        });
        registry.registerCommand(ARTIFACTS_COMMANDS.refresh, { execute: async () => (await this.openView({ activate: false, reveal: true })).reload() });
    }
}
