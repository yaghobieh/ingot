import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { GroupChannel } from './group-channel';
import { IngotGroupService } from './ingot-group-service';
import { describeMessage } from '../../common/groups/channel.utils';
import { relativeTime } from '../../common/agents/agents.utils';
import { GROUP_CHAT_LABEL, GROUP_CHAT_WIDGET_ID } from './groups.browser-consts';

/** Group Chat tool window: every cross-project message, with approve / deny for edits (IDEA-53). */
@injectable()
export class IngotGroupChatWidget extends ReactWidget {

    @inject(GroupChannel) protected readonly channel: GroupChannel;
    @inject(IngotGroupService) protected readonly groups: IngotGroupService;

    @postConstruct()
    protected init(): void {
        this.id = GROUP_CHAT_WIDGET_ID;
        this.title.label = GROUP_CHAT_LABEL;
        this.title.caption = GROUP_CHAT_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-services';
        this.addClass('ingot-group-chat');
        this.toDispose.push(this.channel.onDidChange(() => this.update()));
        this.toDispose.push(this.groups.onDidChange(() => this.update()));
        this.update();
    }

    protected render(): React.ReactNode {
        if (!this.groups.isGroup) {
            return <div className='ingot-group-chat-empty'>Open a project group to let agents in different projects talk to each other.</div>;
        }
        const now = Date.now();
        const messages = this.channel.messages;
        return <div className='ingot-group-chat-root'>
            <div className='ingot-group-chat-hint'>
                In an agent composer: <code>/ask &lt;project&gt; …</code> · <code>/notify &lt;project&gt; …</code> · <code>/reply …</code> · <code>/edit &lt;project&gt; &lt;file&gt; …</code>
            </div>
            {messages.length === 0 && <div className='ingot-group-chat-empty'>No messages between projects yet.</div>}
            {messages.map(m => (
                <div key={m.id} id={`ingot-gc-${m.id}`} className={`ingot-gc-msg ingot-gc-${m.kind}`}>
                    <div className='ingot-gc-head'>
                        <span className={`ingot-gc-kind ingot-gc-kind-${m.kind}`}>{m.kind}</span>
                        <span className='ingot-gc-who'>{describeMessage(m)}</span>
                        <span className='ingot-flex' />
                        <span className='ingot-gc-time'>{relativeTime(m.at, now)}</span>
                    </div>
                    <div className='ingot-gc-text'>{m.text}</div>
                    {m.edit && <div className='ingot-gc-edit'>
                        <span className={`ingot-gc-status ingot-gc-status-${m.edit.status}`}>{m.edit.status === 'pending' ? 'Needs your approval' : m.edit.status}</span>
                        <span className='ingot-flex' />
                        {m.edit.status === 'pending' && <>
                            <button type='button' className='ingot-btn-ghost ingot-gc-deny' onClick={() => this.channel.deny(m.id)}>Deny</button>
                            <button type='button' className='ingot-btn-primary ingot-gc-approve' onClick={() => this.channel.approve(m.id)}>Approve</button>
                        </>}
                    </div>}
                </div>
            ))}
        </div>;
    }
}
