import * as React from '@theia/core/shared/react';
import { HABIT_TARGET_LABELS } from '../../common/habits/habits.consts';
import { MAKE_HABIT_LABEL } from '../../common/habits/playbook.consts';
import type { Habit } from '../../common/habits/habits.types';
import { habitTargets, habitTitle } from '../../common/habits/habits.utils';
import type { HabitStore } from './habit-store';

export interface HabitCardsProps {
    readonly store: HabitStore;
    /** IDEA-296 v2: opens the habit editor with a playbook drafted from the learned pattern. */
    readonly onMakeHabit?: (habit: Habit) => void;
}

/** IDEA-296: "You often X. Make it a rule / command / hook / habit?" cards in the agent chat. */
export class HabitCards extends React.Component<HabitCardsProps, { saved?: string }> {
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
                    {this.props.onMakeHabit && <button type='button' data-target='habit' className='ingot-btn-ghost' onClick={() => this.props.onMakeHabit!(habit)}>
                        <span className='codicon codicon-checklist' aria-hidden='true' /> {MAKE_HABIT_LABEL}
                    </button>}
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
