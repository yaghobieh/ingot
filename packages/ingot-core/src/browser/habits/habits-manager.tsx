import * as React from '@theia/core/shared/react';
import { HABIT_KIND_LABELS, HABIT_STATUS_LABELS, HABITS_FILE } from '../../common/habits/habits.consts';
import { MAKE_HABIT_LABEL, PLAYBOOK_SCOPE_HINTS, PLAYBOOK_SOURCE_LABELS } from '../../common/habits/playbook.consts';
import type { Habit } from '../../common/habits/habits.types';
import type { Playbook, PlaybookFileError, PlaybookList, PlaybookScope } from '../../common/habits/playbook.types';
import { draftFromLearned } from '../../common/habits/playbook-draft.utils';
import { blankDraft, playbookFileText } from '../../common/habits/playbook.utils';
import type { HabitStore } from './habit-store';
import type { PlaybookService } from './playbook-service';
import { PlaybookEditor } from './playbook-editor';
import type { LearnedHabitStore } from './learned-store';
import { LearnedPreferences } from './learned-preferences';

interface HabitsManagerProps {
    readonly store: HabitStore;
    readonly playbooks: PlaybookService;
    /** IDEA-305/306/307: preferences learned from your choices (handoff point, plan templates, models). */
    readonly learned?: LearnedHabitStore;
    readonly modelLabel?: (id: string) => string;
}

interface HabitsManagerState {
    enabled?: boolean;
    list?: PlaybookList;
    /** On/off clicks not yet written to the preferences, by habit id. */
    toggled?: Readonly<Record<string, boolean>>;
    /** Uri of the habit file being edited, with its text. */
    editing?: { uri: string; text: string; source: Playbook['source'] };
    adding?: { scope: PlaybookScope; text: string; learned?: Habit };
    saved?: string;
}

const SCOPE_TITLES: Readonly<Record<PlaybookScope, string>> = { project: 'Project habits', global: 'Global habits' };

/**
 * IDEA-296: the Habits page. Habits (scenario playbooks: project, global and `.cursor/habits`) with on/off, edit, add
 * and delete; below them the learned patterns with on/off, evidence, "Make it a habit" and delete.
 */
export class HabitsManager extends React.Component<HabitsManagerProps, HabitsManagerState> {
    override state: HabitsManagerState = {};
    protected listeners: { dispose(): void }[] = [];

    override componentDidMount(): void {
        this.listeners = [this.props.store.onDidChange(() => this.forceUpdate()), this.props.playbooks.onDidChange(() => this.refresh())];
        void this.props.store.load(true);
        this.refresh();
    }

    override componentWillUnmount(): void {
        this.listeners.forEach(l => l.dispose());
    }

    protected refresh(): void {
        void this.props.playbooks.list().then(list => this.setState({ list, toggled: undefined }), () => this.setState({ list: { playbooks: [], errors: [] }, toggled: undefined }));
    }

    protected toggle(p: Playbook, on: boolean): void {
        this.setState(s => ({ toggled: { ...s.toggled, [p.id]: on } }));
        void this.props.playbooks.setEnabled(p, on);
    }

    protected async edit(uri: string, source: Playbook['source']): Promise<void> {
        const text = await this.props.playbooks.readRaw(uri);
        this.setState({ editing: { uri, text, source }, adding: undefined, saved: undefined });
    }

    protected async saveEdit(text: string): Promise<readonly string[]> {
        const editing = this.state.editing;
        const errors = editing ? await this.props.playbooks.save(editing.uri, text, editing.source) : [];
        if (!errors.length) {
            this.setState({ editing: undefined });
        }
        return errors;
    }

    protected async add(text: string, scope: PlaybookScope): Promise<readonly string[]> {
        const learned = this.state.adding?.learned;
        const { path, errors } = await this.props.playbooks.create(scope, text);
        if (path) {
            if (learned) {
                await this.props.store.markSaved(learned, path);
            }
            this.setState({ adding: undefined, saved: path });
        }
        return errors;
    }

    protected renderEditor(): React.ReactNode {
        const { editing } = this.state;
        return editing && <PlaybookEditor key={editing.uri} id='ingot-playbook-edit' title='Edit habit' text={editing.text} saveLabel='Save'
            onSave={text => this.saveEdit(text)} onCancel={() => this.setState({ editing: undefined })} />;
    }

    protected renderRow(p: Playbook): React.ReactNode {
        if (this.state.editing?.uri === p.uri) {
            return <React.Fragment key={p.id}>{this.renderEditor()}</React.Fragment>;
        }
        const on = this.state.toggled?.[p.id] ?? this.props.playbooks.isEnabled(p);
        return <div key={p.id} className={`ingot-playbook-row${on ? '' : ' off'}`} data-habit-id={p.id} title={p.path}>
            <input type='checkbox' checked={on} aria-label={`Use habit ${p.name}`} onChange={e => this.toggle(p, e.currentTarget.checked)} />
            <span className='codicon codicon-checklist' aria-hidden='true' />
            <span className='ingot-rules-name'>{p.name}</span>
            <span className='ingot-rules-desc'>{p.when}</span>
            <span className='ingot-flex' />
            <span className='ingot-habit-count'>{p.steps.length} step{p.steps.length === 1 ? '' : 's'}</span>
            <span className='ingot-habit-source'>{PLAYBOOK_SOURCE_LABELS[p.source]}</span>
            {p.uri && <button type='button' className='codicon codicon-edit ingot-icon-button' aria-label={`Edit habit ${p.name}`} onClick={() => this.edit(p.uri!, p.source)} />}
            {p.uri && <button type='button' className='codicon codicon-trash ingot-icon-button' aria-label={`Delete habit ${p.name}`} onClick={() => this.props.playbooks.remove(p.uri!)} />}
        </div>;
    }

    protected renderError(e: PlaybookFileError): React.ReactNode {
        if (e.uri && this.state.editing?.uri === e.uri) {
            return <React.Fragment key={e.path}>{this.renderEditor()}</React.Fragment>;
        }
        return <div key={e.path} className='ingot-playbook-error' data-path={e.path}>
            <div className='ingot-rules-row-head'>
                <span className='codicon codicon-warning' aria-hidden='true' />
                <span className='ingot-rules-name'>{e.path}</span>
                <span className='ingot-flex' />
                {e.uri && <button type='button' className='codicon codicon-edit ingot-icon-button' aria-label={`Fix ${e.path}`} onClick={() => this.edit(e.uri!, e.source)} />}
            </div>
            {e.errors.map(text => <div key={text} className='ingot-rules-error'>{text}</div>)}
        </div>;
    }

    protected renderScope(scope: PlaybookScope, playbooks: readonly Playbook[]): React.ReactNode {
        const adding = this.state.adding?.scope === scope ? this.state.adding : undefined;
        const noProject = scope === 'project' && !this.props.playbooks.root;
        return <div className='ingot-playbook-scope' id={`ingot-playbooks-${scope}`}>
            <div className='ingot-rules-head'>
                <span className='ingot-playbook-scope-title'>{SCOPE_TITLES[scope]}</span>
                <span className='ingot-flex' />
                <button type='button' id={`ingot-playbooks-add-${scope}`} className='ingot-btn-ghost' disabled={noProject}
                    onClick={() => this.setState({ adding: { scope, text: playbookFileText(blankDraft()) }, editing: undefined, saved: undefined })}>+ Add</button>
            </div>
            <p className='ingot-dim ingot-rules-hint'>{noProject ? 'Open a project to add project habits.' : PLAYBOOK_SCOPE_HINTS[scope]}</p>
            {adding && <PlaybookEditor key={adding.text} id='ingot-playbook-new' title={adding.learned ? MAKE_HABIT_LABEL : 'New habit'} text={adding.text} saveLabel='Add habit'
                onSave={text => this.add(text, scope)} onCancel={() => this.setState({ adding: undefined })} />}
            {playbooks.map(p => this.renderRow(p))}
            {!playbooks.length && !adding && <div className='ingot-dim ingot-pick-empty'>No habits yet.</div>}
        </div>;
    }

    protected renderPlaybooks(): React.ReactNode {
        const list = this.state.list;
        const of = (source: Playbook['source']) => (list?.playbooks ?? []).filter(p => p.source === source);
        return <section className='ingot-settings-card ingot-playbooks' id='ingot-playbooks'>
            <div className='ingot-rules-head'><h3 className='ingot-settings-card-title'>Habits</h3></div>
            <p className='ingot-dim ingot-rules-hint'>
                What to do in which scenario: a trigger (when, keywords, globs, error pattern), ordered steps, allowed tools and done criteria.
                The agent picks a matching habit, shows it as a pill in the chat and ticks off its steps.
            </p>
            {!list && <div className='ingot-dim'>Loading habits…</div>}
            {this.state.saved && <div className='ingot-habit-saved' role='status'>Saved to {this.state.saved}.</div>}
            {list && this.renderScope('project', of('project'))}
            {list && this.renderScope('global', of('global'))}
            {of('cursor').length > 0 && <div className='ingot-playbook-scope' id='ingot-playbooks-cursor'>
                <div className='ingot-rules-head'><span className='ingot-playbook-scope-title'>Also read (.cursor/habits)</span></div>
                {of('cursor').map(p => this.renderRow(p))}
            </div>}
            {!!list?.errors.length && <div className='ingot-playbook-scope' id='ingot-playbooks-errors'>
                <div className='ingot-rules-head'><span className='ingot-playbook-scope-title'>Not loaded</span></div>
                {list.errors.map(e => this.renderError(e))}
            </div>}
        </section>;
    }

    protected renderLearned(): React.ReactNode {
        const { store } = this.props;
        const habits = [...store.habits].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
        const enabled = this.state.enabled ?? store.enabled;
        return <section className='ingot-settings-card ingot-habits-manager' id='ingot-habits-manager'>
            <div className='ingot-rules-head'>
                <h3 className='ingot-settings-card-title'>Learned patterns</h3>
                <span className='ingot-flex' />
                <label className='ingot-memories-generate'>
                    <input id='ingot-habits-enabled' type='checkbox' checked={enabled} onChange={e => { const on = e.currentTarget.checked; store.enabled = on; this.setState({ enabled: on }); }} /> Learn habits
                </label>
            </div>
            <p className='ingot-dim ingot-rules-hint'>Kept in {HABITS_FILE} of this project (git-ignored). Nothing leaves this machine.</p>
            {!habits.length && <div className='ingot-dim ingot-pick-empty'>{enabled ? 'Nothing learned yet. Repeat an instruction, command or rejected edit style and it shows up here.' : 'Turn on "Learn habits" to start.'}</div>}
            {habits.map(h => <div key={h.id} className={`ingot-habit-row${h.enabled ? '' : ' off'}`} data-habit={h.id}>
                <div className='ingot-habit-row-head'>
                    <input type='checkbox' checked={h.enabled} aria-label={`Track ${h.label}`} onChange={e => store.setHabitEnabled(h, e.currentTarget.checked)} />
                    <span className='ingot-habit-kind'>{HABIT_KIND_LABELS[h.kind]}</span>
                    <span className='ingot-habit-title'>{h.label}</span>
                    <span className='ingot-flex' />
                    <span className='ingot-habit-count'>{h.count}×</span>
                    <span className='ingot-habit-status' title={h.savedAs}>{h.savedAs ? `saved · ${h.savedAs}` : HABIT_STATUS_LABELS[h.status]}</span>
                    {!h.savedAs && <button type='button' className='codicon codicon-checklist ingot-icon-button' aria-label={`${MAKE_HABIT_LABEL}: ${h.label}`} title={MAKE_HABIT_LABEL}
                        onClick={() => this.setState({ adding: { scope: 'project', text: playbookFileText(draftFromLearned(h)), learned: h }, editing: undefined, saved: undefined })} />}
                    <button type='button' className='codicon codicon-trash ingot-icon-button' aria-label={`Delete habit ${h.label}`} onClick={() => store.remove(h)} />
                </div>
                {h.examples.length > 0 && <ul className='ingot-habit-examples'>{h.examples.map(e => <li key={e} title={e}>{e}</li>)}</ul>}
            </div>)}
        </section>;
    }

    override render(): React.ReactNode {
        return <div className='ingot-habits-page' id='ingot-habits-page'>
            {this.renderPlaybooks()}
            {this.renderLearned()}
            {this.props.learned && <LearnedPreferences store={this.props.learned} modelLabel={this.props.modelLabel ?? (id => id)} />}
        </div>;
    }
}
