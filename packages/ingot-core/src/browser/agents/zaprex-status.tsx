import * as React from '@theia/core/shared/react';
import type { AgentSession } from '../../common/agents/agents.types';
import type { HarmonyPiece } from '../../common/agents/harmony';
import { Backdrop } from './chat-popovers';

export type PieceState = 'working' | 'review' | 'done';

export interface ZaprexStatusProps {
    readonly enabled: boolean;
    readonly offer?: HarmonyPiece;
    readonly pieces: readonly { readonly session: AgentSession; readonly state: PieceState }[];
    readonly onAccept: () => void;
    readonly onDismiss: () => void;
    readonly onTurnOn: () => void;
    readonly onOpenApp: () => void;
    readonly onClose: () => void;
}

const STATE_LABEL: Record<PieceState, string> = { working: 'Working', review: 'Waiting for review', done: 'Done' };

/** IDEA-180 / IDEA-184: what the composer T-rex opens: Harmony mode status, Zaprex's offer or pieces, and the Zaprex app. */
export const ZaprexStatus = (p: ZaprexStatusProps): React.ReactElement => <>
    <Backdrop onClose={p.onClose} />
    <div id='ingot-zaprex-status' className='ingot-popover ingot-zaprex-status' role='dialog' aria-label='Zaprex and Harmony mode'>
        <div className='ingot-zs-head'>
            <span className='ingot-zaprex-link-icon ingot-zaprex-trex' aria-hidden='true' />
            <span className='ingot-zs-title'>Zaprex</span>
            <span id='ingot-zs-mode' className={`ingot-zs-badge${p.enabled ? ' on' : ''}`}>Harmony {p.enabled ? 'on' : 'off'}</span>
        </div>
        {p.offer && <div className='ingot-zs-offer' id='ingot-zs-offer'>
            <div className='ingot-zs-offer-text'>{p.offer.offer}</div>
            <div className='ingot-zs-scope'><span className='codicon codicon-lock' /> Only {p.offer.scope.slice(0, 2).join(', ')}{p.offer.scope.length > 2 ? ', …' : ''}</div>
            <div className='ingot-zs-actions'>
                <button type='button' id='ingot-zs-dismiss' className='ingot-zs-ghost' onClick={p.onDismiss}>Dismiss</button>
                <button type='button' id='ingot-zs-accept' className='ingot-zs-primary' onClick={p.onAccept}>Accept</button>
            </div>
        </div>}
        {p.pieces.length > 0 && <ul className='ingot-zs-pieces' aria-label='Zaprex pieces'>
            {p.pieces.map(({ session, state }) => <li key={session.id} className={`ingot-zs-piece ${state}`}>
                <span className={`ingot-zs-dot ${state}`} aria-hidden='true' />
                <span className='ingot-zs-piece-title' title={session.title}>{session.title}</span>
                <span className='ingot-zs-piece-state'>{STATE_LABEL[state]}</span>
            </li>)}
        </ul>}
        {!p.offer && !p.pieces.length && <div className='ingot-zs-empty' id='ingot-zs-empty'>
            {p.enabled
                ? 'On a heavy agent run Zaprex offers to take one well-scoped piece (tests, docs or styling) and does it in parallel, with its own files and the same review.'
                : 'Harmony mode is off: Zaprex will not offer to help with heavy agent runs.'}
        </div>}
        <div className='ingot-zs-footer'>
            {!p.enabled && <button type='button' id='ingot-zs-turn-on' className='ingot-zs-ghost' onClick={p.onTurnOn}>Turn on Harmony mode</button>}
            <span className='ingot-flex' />
            <button type='button' id='ingot-zs-open' className='ingot-zs-ghost' onClick={p.onOpenApp}>Open Zaprex <span className='codicon codicon-link-external' /></button>
        </div>
    </div>
</>;
