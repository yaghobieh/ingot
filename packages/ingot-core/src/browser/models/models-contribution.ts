import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { IngotModelsWidget } from './models-widget';
import { MODELS_OPEN_COMMAND, MODELS_WIDGET_ID, MODELS_WIDGET_LABEL } from './models.browser-consts';

/** Settings › Models. Inline predictions, their status item and keys live in the Tab unit (IDEA-285). */
@injectable()
export class IngotModelsContribution extends AbstractViewContribution<IngotModelsWidget> {

    constructor() {
        super({ widgetId: MODELS_WIDGET_ID, widgetName: MODELS_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(MODELS_OPEN_COMMAND, { execute: () => this.openView({ activate: true }) });
    }
}
