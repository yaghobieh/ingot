import * as React from '@theia/core/shared/react';
import { HABIT_TARGET_LABELS } from '../../common/habits/habits.consts';
import { habitTargets, habitTitle } from '../../common/habits/habits.utils';
import type { HabitStore } from './habit-store';

/** IDEA-296: "You often X. Make it a rule / command / hook?" cards in the agent chat. */
export class HabitCards extends React.Component<{ store: HabitStore }, { saved?: string }> {
    override state: { saved?: string } = {};
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.store.onDidChange(() => this.forceUpdate());
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    override render(): React.ReactNode {
        const { store } = this.props;
        const proposals = store.proposals;
        if (!proposals.length && !this.state.saved) {
            return undefined;
        }
        return <div className='ingot-habit-cards' id='ingot-habit-cards'>
            {proposals.map(habit => <div key={habit.id} className='ingot-habit-card' data-habit={habit.id} role='group' aria-label='Habit suggestion'>
                <div className='ingot-habit-card-head'>
                    <span className='codicon codicon-lightbulb' aria-hidden='true' />
                    <span className='ingot-habit-title'>{habitTitle(habit)}</span>
                    <span className='ingot-flex' />
                    <span className='ingot-habit-count'>{habit.count}×</span>
                </div>
                {habit.examples.length > 0 && <div className='ingot-habit-evidence' title={habit.examples.join('\n')}>e.g. {habit.examples[habit.examples.length - 1]}</div>}
                <div className='ingot-habit-actions'>
                    {habitTargets(habit).map((target, i) => <button key={target} type='button' data-target={target}
                        className={i === 0 ? 'ingot-btn-primary' : 'ingot-btn-ghost'}
                        onClick={async () => { const saved = await store.accept(habit, target); this.setState({ saved }); }}>
                        {HABIT_TARGET_LABELS[target]}
                    </button>)}
                    <span className='ingot-flex' />
                    <button type='button' className='ingot-btn-ghost ingot-habit-dismiss' onClick={() => store.dismiss(habit)}>Not now</button>
                </div>
            </div>)}
            {this.state.saved && <div className='ingot-habit-saved' role='status'>
                Saved to {this.state.saved}. <a href='#' onClick={e => { e.preventDefault(); this.setState({ saved: undefined }); }}>OK</a>
            </div>}
        </div>;
    }
}
