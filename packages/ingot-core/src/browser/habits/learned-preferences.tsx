import * as React from '@theia/core/shared/react';
import { LEARNED_FILE, LEARNED_KIND_LABELS } from '../../common/habits/learned.consts';
import { learnedLabel, learnedValue, supportOf } from '../../common/habits/learned.utils';
import type { LearnedHabitStore } from './learned-store';

interface LearnedPreferencesProps {
    readonly store: LearnedHabitStore;
    readonly modelLabel: (id: string) => string;
}

/** IDEA-305/306/307 on the Habits page: when you hand off to a fresh chat, plan templates and models you keep per task type. */
export class LearnedPreferences extends React.Component<LearnedPreferencesProps> {
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.store.onDidChange(() => this.forceUpdate());
        void this.props.store.load(true);
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    override render(): React.ReactNode {
        const { store, modelLabel } = this.props;
        const learned = [...store.learned].sort((a, b) => b.lastSeen - a.lastSeen);
        return <section className='ingot-settings-card ingot-learned-habits' id='ingot-learned-habits'>
            <div className='ingot-rules-head'><h3 className='ingot-settings-card-title'>Learned preferences</h3></div>
            <p className='ingot-dim ingot-rules-hint'>
                From your choices: when you start a fresh chat, the plans you approve per task type and the models you keep. Saved after {store.threshold} matching choices; kept in {LEARNED_FILE} (git-ignored).
            </p>
            {!learned.length && <div className='ingot-dim ingot-pick-empty'>{store.enabled ? 'Nothing learned yet.' : 'Turn on "Learn habits" to start.'}</div>}
            {learned.map(h => <div key={h.id} className={`ingot-learned-row${h.enabled ? '' : ' off'}`} data-learned={h.id}>
                <input type='checkbox' checked={h.enabled} aria-label={`Use ${learnedLabel(h, modelLabel)}`} onChange={e => void store.setEnabled(h.id, e.currentTarget.checked)} />
                <span className='codicon codicon-bookmark' aria-hidden='true' />
                <span className='ingot-habit-kind'>{LEARNED_KIND_LABELS[h.kind]}</span>
                <span className='ingot-learned-label' title={h.value}>{learnedLabel(h, modelLabel)}</span>
                <span className='ingot-learned-status' title={h.savedAs}>
                    {h.status === 'saved' ? `saved${h.savedAs ? ` · ${h.savedAs}` : ''}` : `learning · ${supportOf(h.kind, h.samples, learnedValue(h.kind, h.samples))}/${store.threshold}`}
                </span>
                <button type='button' className='codicon codicon-trash ingot-icon-button' aria-label={`Forget ${learnedLabel(h, modelLabel)}`} onClick={() => void store.remove(h.id)} />
            </div>)}
        </section>;
    }
}
