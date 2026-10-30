import * as React from '@theia/core/shared/react';
import { HABIT_KIND_LABELS, HABIT_STATUS_LABELS, HABITS_FILE } from '../../common/habits/habits.consts';
import type { HabitStore } from './habit-store';

/** IDEA-296: the Habits page: learned habits with on/off, evidence (count, examples) and delete. */
export class HabitsManager extends React.Component<{ store: HabitStore }> {
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.store.onDidChange(() => this.forceUpdate());
        void this.props.store.load(true);
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    override render(): React.ReactNode {
        const { store } = this.props;
        const habits = [...store.habits].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
        return <section className='ingot-settings-card ingot-habits-manager' id='ingot-habits-manager'>
            <div className='ingot-rules-head'>
                <h3 className='ingot-settings-card-title'>Learned habits</h3>
                <span className='ingot-flex' />
                <label className='ingot-memories-generate'>
                    <input id='ingot-habits-enabled' type='checkbox' checked={store.enabled} onChange={e => { store.enabled = e.currentTarget.checked; }} /> Learn habits
                </label>
            </div>
            <p className='ingot-dim ingot-rules-hint'>Kept in {HABITS_FILE} of this project (git-ignored). Nothing leaves this machine.</p>
            {!habits.length && <div className='ingot-dim ingot-pick-empty'>{store.enabled ? 'Nothing learned yet. Repeat an instruction, command or rejected edit style and it shows up here.' : 'Turn on "Learn habits" to start.'}</div>}
            {habits.map(h => <div key={h.id} className={`ingot-habit-row${h.enabled ? '' : ' off'}`} data-habit={h.id}>
                <div className='ingot-habit-row-head'>
                    <input type='checkbox' checked={h.enabled} aria-label={`Track ${h.label}`} onChange={e => store.setHabitEnabled(h, e.currentTarget.checked)} />
                    <span className='ingot-habit-kind'>{HABIT_KIND_LABELS[h.kind]}</span>
                    <span className='ingot-habit-title'>{h.label}</span>
                    <span className='ingot-flex' />
                    <span className='ingot-habit-count'>{h.count}×</span>
                    <span className='ingot-habit-status' title={h.savedAs}>{h.savedAs ? `saved · ${h.savedAs}` : HABIT_STATUS_LABELS[h.status]}</span>
                    <button type='button' className='codicon codicon-trash ingot-icon-button' aria-label={`Delete habit ${h.label}`} onClick={() => store.remove(h)} />
                </div>
                {h.examples.length > 0 && <ul className='ingot-habit-examples'>{h.examples.map(e => <li key={e} title={e}>{e}</li>)}</ul>}
            </div>)}
        </section>;
    }
}
