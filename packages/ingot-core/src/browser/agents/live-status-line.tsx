import * as React from '@theia/core/shared/react';
import { holdRemaining } from '../../common/agents/live-status';
import { LIVE_STATUS_MIN_MS } from '../../common/agents/live-status.consts';
import type { LiveStatus } from '../../common/agents/live-status.types';

export interface LiveStatusLineProps {
    readonly status?: LiveStatus;
}

const keyOf = (status: LiveStatus | undefined): string => status ? `${status.kind}:${status.label}` : '';

const TypingDots = (): React.ReactElement => <span className='ingot-typing-dots' id='ingot-chat-typing' aria-hidden='true'><i /><i /><i /></span>;

/**
 * The shimmering status line at the end of a running chat. It follows `status`, but keeps each line up for
 * LIVE_STATUS_MIN_MS so a burst of quick steps reads as steps, and the next line fades in over the last one.
 */
export const LiveStatusLine = ({ status }: LiveStatusLineProps): React.ReactElement | null => {
    const [shown, setShown] = React.useState<LiveStatus | undefined>(status);
    const shownAt = React.useRef(Date.now());
    const latest = React.useRef(status);
    latest.current = status;
    const wanted = keyOf(status);
    React.useEffect(() => {
        if (wanted === keyOf(shown)) {
            return undefined;
        }
        const wait = shown ? holdRemaining(shownAt.current, Date.now(), LIVE_STATUS_MIN_MS) : 0;
        const timer = setTimeout(() => {
            shownAt.current = Date.now();
            setShown(latest.current);
        }, wait);
        return () => clearTimeout(timer);
    }, [wanted, shown]);
    if (!shown) {
        return null;
    }
    return <div className='ingot-chat-working' id='ingot-chat-working' role='status' aria-live='polite' data-kind={shown.kind}>
        {shown.kind === 'waiting' && <TypingDots />}
        <span key={keyOf(shown)} className='ingot-chat-working-text ingot-live-status-in'>
            <span className='ingot-shimmer'>{shown.label}</span>
        </span>
    </div>;
};
