import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { GroupChannel } from './group-channel';
import { IngotGroupChatWidget } from './group-chat-widget';
import { GROUP_CHAT_LABEL, GROUP_CHAT_TOGGLE_COMMAND, GROUP_CHAT_WIDGET_ID } from './groups.browser-consts';

@injectable()
export class IngotGroupChatContribution extends AbstractViewContribution<IngotGroupChatWidget> implements FrontendApplicationContribution {

    @inject(GroupChannel) protected readonly channel: GroupChannel;

    constructor() {
        super({ widgetId: GROUP_CHAT_WIDGET_ID, widgetName: GROUP_CHAT_LABEL, defaultWidgetOptions: { area: 'bottom', rank: 300 }, toggleCommandId: GROUP_CHAT_TOGGLE_COMMAND.id });
    }

    onStart(): void {
        this.channel.start();
        // Approval requests and questions should never go unnoticed: reveal Group Chat when one arrives.
        this.channel.onDidChange(message => {
            if (message && (message.kind === 'edit' || message.kind === 'ask')) {
                this.openView({ reveal: true, activate: false });
            }
        });
    }
}
