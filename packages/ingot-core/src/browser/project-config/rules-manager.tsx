import * as React from '@theia/core/shared/react';
import type { ProjectRule, RuleKind } from '../../common/project-config/project-config.types';
import { RULE_KIND_LABELS } from '../../common/project-config/project-config.consts';
import { ruleKindLabel } from '../../common/project-config/project-config.utils';
import type { UserRulesService } from './user-rules-service';
import type { RuleScope, UserRulesList } from './user-rules.types';

interface RulesManagerState {
    list?: UserRulesList;
    editing?: string;
    draftText: string;
    adding?: RuleScope;
    name: string;
    kind: RuleKind;
    detail: string;
    body: string;
    error?: string;
}

const EMPTY_FORM = { name: '', kind: 'always' as RuleKind, detail: '', body: '', error: undefined };

/** IDEA-295: User Rules settings page: global rules (every project) and project rules, edit in place and add. */
export class RulesManager extends React.Component<{ service: UserRulesService }, RulesManagerState> {
    override state: RulesManagerState = { draftText: '', ...EMPTY_FORM };
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.service.onDidChange(() => this.refresh());
        this.refresh();
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    protected refresh(): void {
        void this.props.service.list().then(list => this.setState({ list }));
    }

    protected async edit(rule: ProjectRule): Promise<void> {
        const draftText = await this.props.service.readRaw(rule);
        this.setState({ editing: rule.path, draftText, adding: undefined });
    }

    protected async saveEdit(rule: ProjectRule): Promise<void> {
        await this.props.service.save(rule, this.state.draftText);
        this.setState({ editing: undefined });
    }

    protected async add(scope: RuleScope): Promise<void> {
        const { name, kind, detail, body } = this.state;
        const error = await this.props.service.create(scope, { name, kind, body, ...(kind === 'agent' ? { description: detail } : kind === 'auto' ? { globs: detail } : {}) });
        if (error) {
            this.setState({ error });
        } else {
            this.setState({ adding: undefined, ...EMPTY_FORM });
        }
    }

    protected renderRow(rule: ProjectRule): React.ReactNode {
        if (this.state.editing === rule.path) {
            return <div key={rule.path} className='ingot-rules-edit' data-rule={rule.name}>
                <div className='ingot-rules-row-head'><span className='codicon codicon-law' /><span className='ingot-rules-name'>{rule.path}</span></div>
                <textarea id='ingot-rules-edit-text' className='ingot-input' rows={8} autoFocus value={this.state.draftText}
                    onChange={e => this.setState({ draftText: e.currentTarget.value })}
                    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); this.setState({ editing: undefined }); } }} />
                <div className='ingot-rules-bar'>
                    <span className='ingot-flex' />
                    <button type='button' className='ingot-btn-ghost' onClick={() => this.setState({ editing: undefined })}>Cancel</button>
                    <button type='button' id='ingot-rules-edit-save' className='ingot-btn-primary' onClick={() => this.saveEdit(rule)}>Save</button>
                </div>
            </div>;
        }
        return <div key={rule.path} className='ingot-rules-row' data-rule={rule.name} title={rule.path}>
            <span className='codicon codicon-law' />
            <span className='ingot-rules-name'>{rule.name}</span>
            <span className='ingot-rules-kind'>{ruleKindLabel(rule)}</span>
            {rule.description && <span className='ingot-rules-desc'>{rule.description}</span>}
            <span className='ingot-flex' />
            <button type='button' className='codicon codicon-edit ingot-icon-button' aria-label={`Edit ${rule.name}`} onClick={() => this.edit(rule)} />
            <button type='button' className='codicon codicon-trash ingot-icon-button' aria-label={`Delete ${rule.name}`} onClick={() => this.props.service.remove(rule)} />
        </div>;
    }

    protected renderForm(scope: RuleScope): React.ReactNode {
        const { kind } = this.state;
        return <div className='ingot-rules-edit' id='ingot-rules-new'>
            <div className='ingot-rules-bar'>
                <input id='ingot-rules-new-name' className='ingot-input' placeholder='Rule name (e.g. api-style)' value={this.state.name} autoFocus
                    onChange={e => this.setState({ name: e.currentTarget.value })} />
                <select id='ingot-rules-new-kind' className='ingot-select' aria-label='When it applies' value={kind} onChange={e => this.setState({ kind: e.currentTarget.value as RuleKind })}>
                    {(Object.keys(RULE_KIND_LABELS) as RuleKind[]).map(k => <option key={k} value={k}>{RULE_KIND_LABELS[k]}</option>)}
                </select>
            </div>
            {(kind === 'agent' || kind === 'auto') && <input id='ingot-rules-new-detail' className='ingot-input'
                placeholder={kind === 'agent' ? 'Description: when should the agent read it?' : 'Globs, comma separated (src/**/*.ts)'}
                value={this.state.detail} onChange={e => this.setState({ detail: e.currentTarget.value })} />}
            <textarea id='ingot-rules-new-body' className='ingot-input' rows={5} placeholder='The rule, in plain words.' value={this.state.body}
                onChange={e => this.setState({ body: e.currentTarget.value })} />
            {this.state.error && <div className='ingot-rules-error' role='alert'>{this.state.error}</div>}
            <div className='ingot-rules-bar'>
                <span className='ingot-flex' />
                <button type='button' className='ingot-btn-ghost' onClick={() => this.setState({ adding: undefined, ...EMPTY_FORM })}>Cancel</button>
                <button type='button' id='ingot-rules-new-save' className='ingot-btn-primary' onClick={() => this.add(scope)}>Add rule</button>
            </div>
        </div>;
    }

    protected renderSection(scope: RuleScope, title: string, hint: string, rules: readonly ProjectRule[]): React.ReactNode {
        return <section className='ingot-settings-card ingot-rules-section' id={`ingot-rules-${scope}`}>
            <div className='ingot-rules-head'>
                <h3 className='ingot-settings-card-title'>{title}</h3>
                <span className='ingot-flex' />
                <button type='button' id={`ingot-rules-add-${scope}`} className='ingot-btn-ghost' onClick={() => this.setState({ adding: scope, editing: undefined, ...EMPTY_FORM })}>+ Add</button>
            </div>
            <p className='ingot-dim ingot-rules-hint'>{hint}</p>
            {this.state.adding === scope && this.renderForm(scope)}
            {rules.map(r => this.renderRow(r))}
            {!rules.length && this.state.adding !== scope && <div className='ingot-dim ingot-pick-empty'>No rules yet.</div>}
        </section>;
    }

    override render(): React.ReactNode {
        const list = this.state.list;
        if (!list) {
            return <div className='ingot-dim'>Loading rules…</div>;
        }
        return <div id='ingot-rules-manager' className='ingot-rules-manager'>
            {this.renderSection('global', 'Global rules', 'Saved in ~/.ingot/rules. They apply in every project.', list.global)}
            {this.renderSection('project', 'Project rules', this.props.service.root ? 'Saved in .ingot/rules of this project (and its AGENTS.md); commit them to share.' : 'Open a project to add project rules.', list.project)}
            {list.other.length > 0 && <section className='ingot-settings-card ingot-rules-section' id='ingot-rules-other'>
                <h3 className='ingot-settings-card-title'>Also read</h3>
                <p className='ingot-dim ingot-rules-hint'>Rules from other editors' folders and subfolders. Edit them where they live.</p>
                {list.other.map(r => <div key={r.path} className='ingot-rules-row' title={r.path}>
                    <span className='codicon codicon-law' /><span className='ingot-rules-name'>{r.name}</span><span className='ingot-rules-kind'>{ruleKindLabel(r)}</span>
                </div>)}
            </section>}
        </div>;
    }
}
