import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { IngotBotWidget } from './bot-widget';
import { BOT_TOGGLE_COMMAND, BOT_WIDGET_ID, BOT_WIDGET_LABEL } from './bot.browser-consts';

/** IDEA-154: View → Ingot Bot (right side, next to Agents). */
@injectable()
export class IngotBotContribution extends AbstractViewContribution<IngotBotWidget> {
    constructor() {
        super({ widgetId: BOT_WIDGET_ID, widgetName: BOT_WIDGET_LABEL, defaultWidgetOptions: { area: 'right', rank: 110 }, toggleCommandId: BOT_TOGGLE_COMMAND.id });
    }
}
