import * as React from '@theia/core/shared/react';
import type { FrozenStore } from './frozen-store';

export interface FrozenSuggestionsProps {
    readonly store: FrozenStore;
    readonly onFreeze: (path: string) => void;
}

/** IDEA-303: "You always revert agent edits to X. Freeze it?" after the user rejected enough agent edits to one file. */
export class FrozenSuggestions extends React.Component<FrozenSuggestionsProps> {
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.store.onDidChange(() => this.forceUpdate());
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    override render(): React.ReactNode {
        const { store, onFreeze } = this.props;
        const paths = store.suggestions;
        if (!paths.length) {
            return undefined;
        }
        return <div className='ingot-habit-cards' id='ingot-frozen-suggestions'>
            {paths.map(path => <div key={path} className='ingot-habit-card ingot-frozen-suggestion' data-path={path} role='group' aria-label='Freeze suggestion'>
                <div className='ingot-habit-card-head'>
                    <span className='codicon codicon-snowflake' aria-hidden='true' />
                    <span className='ingot-habit-title'>You always revert agent edits to <code>{path}</code>. Freeze it?</span>
                </div>
                <div className='ingot-habit-evidence'>Agents will ask in the chat before changing it.</div>
                <div className='ingot-habit-actions'>
                    <button type='button' className='ingot-btn-primary ingot-frozen-freeze' onClick={() => onFreeze(path)}>
                        <span className='codicon codicon-snowflake' aria-hidden='true' /> Freeze
                    </button>
                    <span className='ingot-flex' />
                    <button type='button' className='ingot-btn-ghost ingot-habit-dismiss' onClick={() => void store.dismiss(path)}>Not now</button>
                </div>
            </div>)}
        </div>;
    }
}
