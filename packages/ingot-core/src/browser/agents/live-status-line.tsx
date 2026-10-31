import * as React from '@theia/core/shared/react';
import { holdRemaining, liveKey, nextStep } from '../../common/agents/live-status';
import { LIVE_STATUS_MIN_MS } from '../../common/agents/live-status.consts';
import type { LiveStep } from '../../common/agents/live-status.types';

export interface LiveStatusLineProps {
    /** The chat's recent status lines, oldest first, recorded as the store announced them. */
    readonly log: readonly LiveStep[];
}

const TypingDots = (): React.ReactElement => <span className='ingot-typing-dots' id='ingot-chat-typing' aria-hidden='true'><i /><i /><i /></span>;

/**
 * The shimmering status line at the end of a running chat. Each line stays up for LIVE_STATUS_MIN_MS; a step that
 * came and went meanwhile (a 5 ms grep) is still shown next, then the line catches up with the run.
 * The next line fades in over the last one.
 */
export const LiveStatusLine = ({ log }: LiveStatusLineProps): React.ReactElement | null => {
    const [shown, setShown] = React.useState<LiveStep | undefined>(log[log.length - 1]);
    const shownAt = React.useRef(Date.now());
    const latest = React.useRef(log);
    latest.current = log;
    const head = log[log.length - 1]?.seq ?? 0;
    React.useEffect(() => {
        const shownSeq = shown?.seq ?? 0;
        if (head <= shownSeq) {
            return undefined;
        }
        const wait = shown?.status ? holdRemaining(shownAt.current, Date.now(), LIVE_STATUS_MIN_MS) : 0;
        const timer = setTimeout(() => {
            const next = nextStep(latest.current, shownSeq);
            if (next) {
                shownAt.current = Date.now();
                setShown(next);
            }
        }, wait);
        return () => clearTimeout(timer);
    }, [head, shown]);
    const status = shown?.status;
    if (!status) {
        return null;
    }
    return <div className='ingot-chat-working' id='ingot-chat-working' role='status' aria-live='polite' data-kind={status.kind}>
        {status.kind === 'waiting' && <TypingDots />}
        <span key={liveKey(status)} className='ingot-chat-working-text ingot-live-status-in'>
            <span className='ingot-shimmer'>{status.label}</span>
        </span>
    </div>;
};
