import * as React from '@theia/core/shared/react';
import { TEAM_RULES_TEXT } from '../../common/team-rules/team-rules-admin.consts';
import type { TeamRuleDraft, TeamRulesState } from '../../common/team-rules/team-rules-admin.types';
import { teamRuleError, upsertTeamRule } from '../../common/team-rules/team-rules-admin.utils';
import type { TeamRulesAdminService } from './team-rules-admin-service';

interface TeamRulesEditorState {
    loaded?: TeamRulesState;
    /** Name of the rule being edited, '' for a new one. */
    editing?: string;
    form: TeamRuleDraft;
    error?: string;
    saving: boolean;
}

const EMPTY_RULE: TeamRuleDraft = { name: '', body: '', description: '', globs: '', alwaysApply: false, enforced: false, enabled: true };

/** IDEA-287: Settings › Team Rules (admins): add, edit, enable, enforce and delete the team's rules. */
export class TeamRulesEditor extends React.Component<{ service: TeamRulesAdminService }, TeamRulesEditorState> {
    override state: TeamRulesEditorState = { form: EMPTY_RULE, saving: false };

    override componentDidMount(): void {
        void this.props.service.load().then(loaded => this.setState({ loaded, error: loaded.error }));
    }

    protected async persist(rules: readonly TeamRuleDraft[]): Promise<boolean> {
        const store = this.state.loaded?.store ?? 'local';
        this.setState({ saving: true });
        const loaded = await this.props.service.save(rules, store);
        this.setState({ saving: false, loaded: loaded.error ? this.state.loaded : loaded, error: loaded.error });
        return !loaded.error;
    }

    protected async submit(): Promise<void> {
        const rules = this.state.loaded?.rules ?? [];
        const previous = this.state.editing || undefined;
        const error = teamRuleError(this.state.form, rules, previous);
        if (error) {
            this.setState({ error });
            return;
        }
        if (await this.persist(upsertTeamRule(rules, this.state.form, previous))) {
            this.setState({ editing: undefined, form: EMPTY_RULE });
        }
    }

    protected remove(rule: TeamRuleDraft): void {
        void this.persist((this.state.loaded?.rules ?? []).filter(r => r.name !== rule.name));
    }

    protected set(patch: Partial<TeamRuleDraft>): void {
        this.setState({ form: { ...this.state.form, ...patch }, error: undefined });
    }

    protected renderForm(): React.ReactNode {
        const { form, saving } = this.state;
        return <div className='ingot-rules-edit' id='ingot-team-rules-form'>
            <div className='ingot-rules-bar'>
                <input id='ingot-team-rule-name' className='ingot-input' placeholder='Rule name (e.g. api-style)' value={form.name} autoFocus
                    onChange={e => this.set({ name: e.currentTarget.value })} />
                <input id='ingot-team-rule-globs' className='ingot-input' placeholder='Globs, comma separated (empty: every conversation)' value={form.globs ?? ''}
                    onChange={e => this.set({ globs: e.currentTarget.value })} />
            </div>
            <input id='ingot-team-rule-description' className='ingot-input' placeholder='Description (optional): when should the agent read it?' value={form.description ?? ''}
                onChange={e => this.set({ description: e.currentTarget.value })} />
            <textarea id='ingot-team-rule-body' className='ingot-input' rows={5} placeholder='The rule, in plain words.' value={form.body}
                onChange={e => this.set({ body: e.currentTarget.value })} />
            <div className='ingot-team-rules-flags'>
                <label><input id='ingot-team-rule-enabled' type='checkbox' checked={form.enabled} onChange={e => this.set({ enabled: e.currentTarget.checked })} /> Enable this rule now</label>
                <label><input id='ingot-team-rule-enforced' type='checkbox' checked={!!form.enforced} onChange={e => this.set({ enforced: e.currentTarget.checked })} /> Enforce (members can't turn it off)</label>
                <label><input id='ingot-team-rule-always' type='checkbox' checked={!!form.alwaysApply} onChange={e => this.set({ alwaysApply: e.currentTarget.checked })} /> Always apply</label>
            </div>
            {this.state.error && <div className='ingot-rules-error' role='alert'>{this.state.error}</div>}
            <div className='ingot-rules-bar'>
                <span className='ingot-flex' />
                <button type='button' className='ingot-btn-ghost' onClick={() => this.setState({ editing: undefined, form: EMPTY_RULE, error: undefined })}>Cancel</button>
                <button type='button' id='ingot-team-rule-save' className='ingot-btn-primary' disabled={saving} onClick={() => this.submit()}>
                    {this.state.editing ? 'Save rule' : 'Add rule'}
                </button>
            </div>
        </div>;
    }

    protected renderRow(rule: TeamRuleDraft): React.ReactNode {
        if (this.state.editing === rule.name) {
            return <React.Fragment key={rule.name}>{this.renderForm()}</React.Fragment>;
        }
        return <div key={rule.name} className='ingot-rules-row' data-team-rule={rule.name} title={rule.body}>
            <span className='codicon codicon-law' />
            <span className='ingot-rules-name'>{rule.name}</span>
            <span className='ingot-rules-kind'>{rule.alwaysApply ? 'Always' : rule.globs ? rule.globs : rule.description ? 'Agent decides' : 'Every conversation'}</span>
            {rule.enforced && <span className='ingot-team-rule-badge enforced'>enforced</span>}
            {!rule.enabled && <span className='ingot-team-rule-badge'>draft</span>}
            <span className='ingot-flex' />
            <button type='button' className='codicon codicon-edit ingot-icon-button' aria-label={`Edit team rule ${rule.name}`}
                onClick={() => this.setState({ editing: rule.name, form: { ...EMPTY_RULE, ...rule }, error: undefined })} />
            <button type='button' className='codicon codicon-trash ingot-icon-button' aria-label={`Delete team rule ${rule.name}`} onClick={() => this.remove(rule)} />
        </div>;
    }

    override render(): React.ReactNode {
        const { loaded } = this.state;
        if (!loaded) {
            return <div className='ingot-dim'>Loading team rules…</div>;
        }
        if (!this.props.service.isAdmin) {
            return <div className='ingot-dim' id='ingot-team-rules-editor'>{TEAM_RULES_TEXT.notAdmin}</div>;
        }
        return <div id='ingot-team-rules-editor' className='ingot-rules-manager'>
            <div id='ingot-team-rules-store' className={`ingot-team-rules-store ${loaded.store}`}>
                <span className={`codicon ${loaded.store === 'server' ? 'codicon-cloud' : 'codicon-warning'}`} />
                <span>{TEAM_RULES_TEXT[loaded.store]}</span>
            </div>
            <section className='ingot-settings-card ingot-rules-section'>
                <div className='ingot-rules-head'>
                    <h3 className='ingot-settings-card-title'>Team rules</h3>
                    <span className='ingot-flex' />
                    <button type='button' id='ingot-team-rules-add' className='ingot-btn-ghost' onClick={() => this.setState({ editing: '', form: EMPTY_RULE, error: undefined })}>+ Add</button>
                </div>
                <p className='ingot-dim ingot-rules-hint'>Every member's agent follows enabled rules in all of the team's projects. Team rules come before project and user rules.</p>
                {this.state.editing === '' && this.renderForm()}
                {loaded.rules.map(rule => this.renderRow(rule))}
                {!loaded.rules.length && this.state.editing !== '' && <div className='ingot-dim ingot-pick-empty'>No team rules yet.</div>}
                {this.state.error && this.state.editing === undefined && <div className='ingot-rules-error' role='alert'>{this.state.error}</div>}
            </section>
        </div>;
    }
}
