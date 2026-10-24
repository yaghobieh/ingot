import * as React from '@theia/core/shared/react';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

export const AI_CHAT_WIDGET_ID = 'ingot-ai-chat';
export const AI_CHAT_TOGGLE_COMMAND = { id: 'ingot.aiChat.toggle', label: 'AI Chat', category: 'View' } as const;

/** Right-stripe AI Chat tool window. The agent chat itself lands in IDEA-27..29. */
@injectable()
export class IngotAiChatWidget extends ReactWidget {

    @postConstruct()
    protected init(): void {
        this.id = AI_CHAT_WIDGET_ID;
        this.title.label = 'AI Chat';
        this.title.caption = 'AI Chat';
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-ai';
        this.addClass('ingot-ai-chat');
        this.update();
    }

    protected render(): React.ReactNode {
        return <div className='ingot-ai-chat-empty'>
            <span className='ingot-icon ingot-icon-ai ingot-ai-chat-hero' />
            <h3>Ingot AI</h3>
            <p>Agent chat with / commands, rules and skills from <code>.alloy</code> and <code>.cursor</code> is coming in the next PRs.</p>
        </div>;
    }
}
