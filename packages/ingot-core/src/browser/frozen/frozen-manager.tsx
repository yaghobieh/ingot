import * as React from '@theia/core/shared/react';
import { FROZEN_COMMANDS, FROZEN_FILE, FROZEN_SOURCE_LABELS } from '../../common/frozen/frozen.consts';
import { zoneLabel } from '../../common/frozen/frozen.utils';
import type { FrozenStore } from './frozen-store';

interface FrozenManagerProps {
    readonly store: FrozenStore;
    readonly runCommand: (id: string) => void;
}

/** IDEA-303: Settings › Frozen Zones. The frozen files and functions of the open project, unfreeze, infer. */
export class FrozenManager extends React.Component<FrozenManagerProps> {
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.store.onDidChange(() => this.forceUpdate());
        void this.props.store.load();
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    override render(): React.ReactNode {
        const { store, runCommand } = this.props;
        const zones = store.zones;
        const tests = store.lastTests;
        return <section className='ingot-settings-card ingot-habits-manager' id='ingot-frozen-manager'>
            <div className='ingot-rules-head'>
                <h3 className='ingot-settings-card-title'>Frozen zones</h3>
                <span className='ingot-flex' />
                <button type='button' id='ingot-frozen-infer' className='ingot-btn-ghost' disabled={!store.root} onClick={() => runCommand(FROZEN_COMMANDS.infer.id)}>
                    <span className='codicon codicon-beaker' aria-hidden='true' /> Freeze stable files…
                </button>
            </div>
            <p className='ingot-dim ingot-rules-hint'>
                Kept in {FROZEN_FILE}. Agents ask in the chat before changing a frozen file or function. Freeze from the project tree, a tab or the editor menu.
                {tests && <> Last tests: <code>{tests.command}</code> {tests.passed ? 'green' : 'failing'}.</>}
            </p>
            {!zones.length && <div className='ingot-dim ingot-pick-empty'>Nothing frozen yet.</div>}
            {zones.map(z => <div key={z.id} className='ingot-habit-row ingot-frozen-row' data-zone={z.id}>
                <div className='ingot-habit-row-head'>
                    <span className='codicon codicon-snowflake' aria-hidden='true' />
                    <span className='ingot-habit-title'>{zoneLabel(z)}</span>
                    <span className='ingot-flex' />
                    <span className='ingot-habit-kind' title={z.reason}>{FROZEN_SOURCE_LABELS[z.source]}</span>
                    <button type='button' className='ingot-btn-ghost ingot-frozen-unfreeze' aria-label={`Unfreeze ${zoneLabel(z)}`} onClick={() => void store.unfreeze(z.id)}>Unfreeze</button>
                </div>
            </div>)}
        </section>;
    }
}
