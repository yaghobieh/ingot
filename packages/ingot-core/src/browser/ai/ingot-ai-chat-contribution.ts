import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { AI_CHAT_TOGGLE_COMMAND, AI_CHAT_WIDGET_ID, IngotAiChatWidget } from './ingot-ai-chat-widget';

@injectable()
export class IngotAiChatContribution extends AbstractViewContribution<IngotAiChatWidget> {
    constructor() {
        super({ widgetId: AI_CHAT_WIDGET_ID, widgetName: 'AI Chat', defaultWidgetOptions: { area: 'right', rank: 100 }, toggleCommandId: AI_CHAT_TOGGLE_COMMAND.id });
    }
}
