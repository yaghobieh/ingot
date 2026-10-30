import * as React from '@theia/core/shared/react';
import { HABIT_OFF_LABEL, HABIT_PILL_PREFIX, PLAYBOOK_SOURCE_LABELS } from '../../common/habits/playbook.consts';
import type { ActiveHabit, HabitCheck, Playbook } from '../../common/habits/playbook.types';
import { habitProgress } from '../../common/habits/playbook.utils';

const PICKED_BY = { auto: 'matched automatically', agent: 'picked by the agent', user: 'chosen by you' } as const;

export interface HabitPillProps {
    readonly habit: ActiveHabit;
    readonly load: () => Promise<readonly Playbook[]>;
    /** A habit id, or undefined to turn the habit off for this chat. */
    readonly onChoose: (id: string | undefined) => void;
}

interface HabitPillState {
    open: boolean;
    choices?: readonly Playbook[];
}

/** IDEA-296: "Using habit: Payments bug · 1/3" above the composer; click to switch habits or turn it off. */
export class HabitPill extends React.Component<HabitPillProps, HabitPillState> {
    override state: HabitPillState = { open: false };

    protected toggle(): void {
        const open = !this.state.open;
        this.setState({ open });
        if (open) {
            void this.props.load().then(choices => this.setState({ choices }), () => this.setState({ choices: [] }));
        }
    }

    protected choose(id: string | undefined): void {
        this.setState({ open: false });
        this.props.onChoose(id);
    }

    override render(): React.ReactNode {
        const { habit } = this.props;
        const why = habit.off ? 'Turned off for this chat' : `${PICKED_BY[habit.pickedBy]}${habit.reason && habit.pickedBy === 'auto' ? `: ${habit.reason}` : ''} · ${habit.path}`;
        return <div className='ingot-habit-pill-wrap'>
            <button type='button' id='ingot-habit-pill' className={`ingot-habit-pill${habit.off ? ' off' : ''}`} aria-haspopup='menu' aria-expanded={this.state.open}
                title={`${why}. Click to switch or turn off.`} onClick={() => this.toggle()}>
                <span className='codicon codicon-checklist' aria-hidden='true' />
                {habit.off ? <span>{HABIT_OFF_LABEL}</span> : <span>{HABIT_PILL_PREFIX} <b>{habit.name}</b></span>}
                {!habit.off && habit.steps.length > 0 && <span className='ingot-habit-pill-progress'>{habitProgress(habit)}</span>}
                <span className='codicon codicon-chevron-down' aria-hidden='true' />
            </button>
            {this.state.open && <div className='ingot-habit-menu' id='ingot-habit-menu' role='menu'>
                {!this.state.choices && <div className='ingot-dim ingot-habit-menu-empty'>Loading habits…</div>}
                {this.state.choices?.map(p => <button key={p.id} type='button' role='menuitemradio' aria-checked={!habit.off && p.id === habit.id} data-habit-id={p.id}
                    className={`ingot-habit-menu-item${!habit.off && p.id === habit.id ? ' selected' : ''}`} title={p.when} onClick={() => this.choose(p.id)}>
                    <span className={`codicon codicon-${!habit.off && p.id === habit.id ? 'check' : 'blank'}`} aria-hidden='true' />
                    <span className='ingot-habit-menu-name'>{p.name}</span>
                    <span className='ingot-habit-menu-when'>{p.when}</span>
                    <span className='ingot-habit-source'>{PLAYBOOK_SOURCE_LABELS[p.source]}</span>
                </button>)}
                {!habit.off && <button type='button' role='menuitem' id='ingot-habit-off' className='ingot-habit-menu-item ingot-habit-menu-off' onClick={() => this.choose(undefined)}>
                    <span className='codicon codicon-circle-slash' aria-hidden='true' /><span className='ingot-habit-menu-name'>Turn off habit for this chat</span>
                </button>}
            </div>}
        </div>;
    }
}

const mark = (items: readonly HabitCheck[], c: HabitCheck, i: number): string =>
    c.done ? '✓' : items.findIndex(x => !x.done) === i ? '●' : '○';

/** IDEA-296: the habit's steps as a live checklist (and its done criteria) in the agent's reply. */
export const HabitChecklist = ({ habit }: { habit: ActiveHabit }): React.ReactElement =>
    <div className='ingot-habit-checklist' id='ingot-habit-checklist' aria-label={`Habit ${habit.name}`}>
        <div className='ingot-habit-checklist-head'>
            <span className='codicon codicon-checklist' aria-hidden='true' />
            <span>Habit · <b>{habit.name}</b></span>
            <span className='ingot-flex' />
            <span className='ingot-habit-count'>{habitProgress(habit)}</span>
        </div>
        {habit.steps.map((s, i) => <div key={`s${i}`} className={`ingot-habit-check${s.done ? ' done' : ''}`} data-step={i + 1}>
            <span className='ingot-habit-check-mark'>{mark(habit.steps, s, i)}</span><span>{s.text}</span>
        </div>)}
        {habit.criteria.length > 0 && <div className='ingot-habit-criteria-head'>Done when</div>}
        {habit.criteria.map((c, i) => <div key={`c${i}`} className={`ingot-habit-check ingot-habit-criterion${c.done ? ' done' : ''}`} data-criterion={i + 1}>
            <span className='ingot-habit-check-mark'>{c.done ? '✓' : '○'}</span><span>{c.text}</span>
        </div>)}
    </div>;
