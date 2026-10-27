import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { HarmonyPiece } from '../../common/agents/harmony';

/**
 * IDEA-180: Zaprex's Harmony mode offer. Drawn in a portal on document.body (the title bar clips overflow) and
 * pinned under the T-rex button; follows it on resize.
 */
export const HarmonyBubble = ({ anchorId, piece, onAccept, onDismiss }: {
    anchorId: string; piece: HarmonyPiece; onAccept: () => void; onDismiss: () => void;
}): React.ReactElement => {
    const [pos, setPos] = React.useState<{ top: number; right: number } | undefined>();
    React.useLayoutEffect(() => {
        const place = (): void => {
            const rect = document.getElementById(anchorId)?.getBoundingClientRect();
            if (rect) {
                setPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right - 8) });
            }
        };
        place();
        window.addEventListener('resize', place);
        const timer = setInterval(place, 500);
        return () => { window.removeEventListener('resize', place); clearInterval(timer); };
    }, [anchorId]);
    return createPortal(
        <div id='ingot-harmony-bubble' className='ingot-harmony-bubble' role='dialog' aria-label='Zaprex Harmony mode offer'
            style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}>
            <div className='ingot-harmony-head'><span className='ingot-harmony-badge'>Harmony</span><span className='ingot-harmony-who'>Zaprex</span></div>
            <div className='ingot-harmony-text' id='ingot-harmony-text'>{piece.offer}</div>
            <div className='ingot-harmony-task' title={piece.task}>{piece.task}</div>
            <div className='ingot-harmony-scope' title={piece.scope.join(', ')}><span className='codicon codicon-lock' /> Only {piece.scope.slice(0, 2).join(', ')}{piece.scope.length > 2 ? ', …' : ''} · reviewed like the agent</div>
            <div className='ingot-harmony-actions'>
                <button type='button' id='ingot-harmony-dismiss' className='ingot-harmony-dismiss' onClick={onDismiss}>Dismiss</button>
                <button type='button' id='ingot-harmony-accept' className='ingot-harmony-accept' onClick={onAccept}>Accept</button>
            </div>
        </div>, document.body);
};
