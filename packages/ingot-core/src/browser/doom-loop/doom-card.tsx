import * as React from '@theia/core/shared/react';
import { DOOM_ACTIONS, DOOM_KIND_LABELS } from '../../common/doom-loop/doom-loop.consts';
import type { DoomVerdict } from '../../common/doom-loop/doom-loop.types';

export type DoomAction = keyof typeof DOOM_ACTIONS;

export interface DoomCardProps {
    readonly verdict: DoomVerdict;
    readonly onAction: (action: DoomAction) => void;
}

const ACTION_ORDER: readonly DoomAction[] = ['different', 'reset', 'keep', 'stop'];
const ACTION_ICONS: Readonly<Record<DoomAction, string>> = { different: 'lightbulb', reset: 'discard', keep: 'debug-continue', stop: 'debug-stop' };

/** IDEA-304: the paused run above the composer: why, "Here's what I tried", and how to go on. */
export const DoomCard = ({ verdict, onAction }: DoomCardProps): React.ReactElement =>
    <div className='ingot-doom-card' id='ingot-doom' role='group' aria-label='Agent paused' data-kind={verdict.kind}>
        <div className='ingot-doom-head'>
            <span className='codicon codicon-debug-pause' aria-hidden='true' />
            <span className='ingot-doom-title'>Paused · {DOOM_KIND_LABELS[verdict.kind]}</span>
        </div>
        <div className='ingot-doom-reason'>{verdict.reason}</div>
        {verdict.tried.length > 0 && <div className='ingot-doom-tried'>
            <div className='ingot-doom-tried-title'>Here&apos;s what I tried</div>
            <ol>{verdict.tried.map((step, i) => <li key={i}>{step}</li>)}</ol>
        </div>}
        <div className='ingot-doom-actions'>
            {ACTION_ORDER.map((action, i) => <button key={action} type='button' id={`ingot-doom-${action}`}
                className={i === 0 ? 'ingot-btn-primary' : 'ingot-btn-ghost'} onClick={() => onAction(action)}>
                <span className={`codicon codicon-${ACTION_ICONS[action]}`} aria-hidden='true' /> {DOOM_ACTIONS[action]}
            </button>)}
        </div>
    </div>;
