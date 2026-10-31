import * as React from '@theia/core/shared/react';
import { DECISIONS_FILE } from '../../common/decisions/decisions.consts';
import type { Decision } from '../../common/decisions/decisions.types';
import type { DecisionLedger } from './decision-ledger';

interface DecisionsManagerProps {
    readonly ledger: DecisionLedger;
}

interface DecisionsManagerState {
    draft: string;
    /** Lock clicks not written to the ledger yet, by decision id. */
    toggled?: Readonly<Record<string, boolean>>;
}

/** IDEA-302: Settings › Decisions. Lock / unlock, delete and add decisions of the open project. */
export class DecisionsManager extends React.Component<DecisionsManagerProps, DecisionsManagerState> {
    override state: DecisionsManagerState = { draft: '' };
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.ledger.onDidChange(() => this.setState(s => ({ toggled: this.pendingToggles(s.toggled) })));
        void this.props.ledger.load();
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    protected async add(): Promise<void> {
        const text = this.state.draft.trim();
        if (text) {
            await this.props.ledger.lock(text);
            this.setState({ draft: '' });
        }
    }

    override render(): React.ReactNode {
        const { ledger } = this.props;
        const decisions = ledger.decisions;
        const noProject = !ledger.root;
        return <section className='ingot-settings-card ingot-habits-manager' id='ingot-decisions-manager'>
            <div className='ingot-rules-head'><h3 className='ingot-settings-card-title'>Decisions</h3></div>
            <p className='ingot-dim ingot-rules-hint'>Kept in {DECISIONS_FILE} (commit it to share). Agents follow locked decisions and ask in the chat before going against one.</p>
            <form className='ingot-decision-add' onSubmit={e => { e.preventDefault(); void this.add(); }}>
                <input id='ingot-decision-input' className='theia-input' placeholder={noProject ? 'Open a project to lock decisions' : 'Lock a decision, e.g. Use pnpm, not npm'}
                    disabled={noProject} value={this.state.draft} onChange={e => this.setState({ draft: e.currentTarget.value })} />
                <button type='submit' id='ingot-decision-add' className='ingot-btn-primary' disabled={noProject || !this.state.draft.trim()}>
                    <span className='codicon codicon-lock' aria-hidden='true' /> Lock
                </button>
            </form>
            {!decisions.length && <div className='ingot-dim ingot-pick-empty'>No decisions yet. Confirm a decision in the chat or lock one here.</div>}
            {decisions.map(d => this.renderRow(d))}
        </section>;
    }

    /** Keeps only clicks the ledger does not show yet (a re-read before the write would flip the box back). */
    protected pendingToggles(toggled: DecisionsManagerState['toggled']): DecisionsManagerState['toggled'] {
        const decisions = this.props.ledger.decisions;
        return toggled && Object.fromEntries(Object.entries(toggled).filter(([id, locked]) => decisions.find(d => d.id === id)?.locked !== locked && decisions.some(d => d.id === id)));
    }

    protected toggle(id: string, locked: boolean): void {
        this.setState(s => ({ toggled: { ...s.toggled, [id]: locked } }));
        void this.props.ledger.setLocked(id, locked);
    }

    protected renderRow(d: Decision): React.ReactNode {
        const locked = this.state.toggled?.[d.id] ?? d.locked;
        return <div key={d.id} className={`ingot-habit-row ingot-decision-row${locked ? '' : ' off'}`} data-decision={d.id}>
            <div className='ingot-habit-row-head'>
                <input type='checkbox' checked={locked} aria-label={`Lock ${d.text}`} title={locked ? 'Locked' : 'Unlocked'}
                    onChange={e => this.toggle(d.id, e.currentTarget.checked)} />
                <span className={`codicon codicon-${locked ? 'lock' : 'unlock'}`} aria-hidden='true' />
                <span className='ingot-habit-title'>{d.text}</span>
                <span className='ingot-flex' />
                <span className='ingot-habit-count' title='Times confirmed'>{d.confirmed}×</span>
                <span className='ingot-habit-status' title={d.habit}>{d.habit ? `habit · ${d.habit}` : d.at}</span>
                <button type='button' className='codicon codicon-trash ingot-icon-button' aria-label={`Delete decision ${d.text}`} onClick={() => void this.props.ledger.remove(d.id)} />
            </div>
        </div>;
    }
}
