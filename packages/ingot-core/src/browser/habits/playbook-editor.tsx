import * as React from '@theia/core/shared/react';
import { PLAYBOOK_SOURCE_LABELS } from '../../common/habits/playbook.consts';
import type { PlaybookScope } from '../../common/habits/playbook.types';
import { parsePlaybook } from '../../common/habits/playbook.utils';

const EDITOR_ROWS = 14;
const SCOPES: readonly PlaybookScope[] = ['project', 'global'];

export interface PlaybookEditorProps {
    /** DOM id prefix: `<id>`, `<id>-text`, `<id>-scope`, `<id>-save`. */
    readonly id: string;
    readonly title: string;
    readonly text: string;
    /** Shows the Project / Global choice for new habits. */
    readonly scope?: PlaybookScope;
    readonly saveLabel: string;
    readonly hint?: string;
    /** Returns the errors that kept it from saving (none: saved). */
    readonly onSave: (text: string, scope: PlaybookScope) => Promise<readonly string[]>;
    readonly onCancel: () => void;
}

interface PlaybookEditorState {
    text: string;
    scope: PlaybookScope;
    errors: readonly string[];
    saving: boolean;
}

/** IDEA-296: edits a habit file (frontmatter + notes) with live validation; used in the chat and on the Habits page. */
export class PlaybookEditor extends React.Component<PlaybookEditorProps, PlaybookEditorState> {
    override state: PlaybookEditorState = { text: this.props.text, scope: this.props.scope ?? 'project', errors: [], saving: false };

    protected async save(): Promise<void> {
        this.setState({ saving: true });
        const errors = await this.props.onSave(this.state.text, this.state.scope).catch((e: unknown) => [e instanceof Error ? e.message : String(e)]);
        this.setState({ errors, saving: false });
    }

    override render(): React.ReactNode {
        const { id, title, hint, scope, saveLabel } = this.props;
        const live = parsePlaybook(this.state.text, { path: 'habit.md', source: this.state.scope });
        const problems = this.state.errors.length ? this.state.errors : live.errors;
        return <div className='ingot-playbook-editor' id={id} role='group' aria-label={title}>
            <div className='ingot-rules-bar'>
                <span className='codicon codicon-checklist' aria-hidden='true' />
                <span className='ingot-playbook-editor-title'>{title}</span>
                <span className='ingot-flex' />
                {scope && <select id={`${id}-scope`} className='ingot-select' aria-label='Save to' value={this.state.scope}
                    onChange={e => this.setState({ scope: e.currentTarget.value as PlaybookScope })}>
                    {SCOPES.map(s => <option key={s} value={s}>{PLAYBOOK_SOURCE_LABELS[s]}</option>)}
                </select>}
            </div>
            {hint && <p className='ingot-dim ingot-rules-hint'>{hint}</p>}
            <textarea id={`${id}-text`} className='ingot-input' rows={EDITOR_ROWS} spellCheck={false} autoFocus value={this.state.text}
                onChange={e => this.setState({ text: e.currentTarget.value, errors: [] })}
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); this.props.onCancel(); } }} />
            {problems.map(e => <div key={e} className='ingot-rules-error' role='alert'>{e}</div>)}
            {!problems.length && live.warnings.map(w => <div key={w} className='ingot-dim ingot-playbook-warning'>{w}</div>)}
            {!problems.length && live.playbook && <div className='ingot-dim ingot-playbook-summary'>
                {live.playbook.steps.length} step{live.playbook.steps.length === 1 ? '' : 's'}
                {live.playbook.doneCriteria.length ? ` · ${live.playbook.doneCriteria.length} done criteria` : ''}
                {live.playbook.allowedTools.length ? ` · tools: ${live.playbook.allowedTools.join(', ')}` : ''}
            </div>}
            <div className='ingot-rules-bar'>
                <span className='ingot-flex' />
                <button type='button' className='ingot-btn-ghost' onClick={() => this.props.onCancel()}>Cancel</button>
                <button type='button' id={`${id}-save`} className='ingot-btn-primary' disabled={this.state.saving || live.errors.length > 0} onClick={() => this.save()}>{saveLabel}</button>
            </div>
        </div>;
    }
}
