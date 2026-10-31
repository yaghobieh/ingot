import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { Message } from '@theia/core/lib/browser/widgets';
import { DEFAULT_PRUNE_DAYS, PRUNE_ACTION_LABELS, PRUNE_LABELS } from '../../common/rules-kit';
import type { PruneCandidate, PrunePlan } from '../../common/rules-kit';
import { PRUNE_MAX_DAYS, PRUNE_MIN_DAYS } from '../../common/rules-tools/rules-tools.consts';

export interface RulesPruneDialogProps {
    readonly plan: (days: number) => Promise<PrunePlan>;
    readonly apply: (days: number, only: readonly string[]) => Promise<PrunePlan>;
}

/** IDEA-323: Prune Stale Rules. A dry run first; only the checked rules are deleted or have their dead globs dropped. */
export class RulesPruneDialog extends ReactDialog<number> {

    protected days = DEFAULT_PRUNE_DAYS;
    protected current?: PrunePlan;
    protected selected = new Set<string>();
    protected busy = false;
    protected error?: string;
    protected applied = 0;
    protected readonly applyButton: HTMLButtonElement;

    constructor(protected readonly pruneProps: RulesPruneDialogProps) {
        super({ title: 'Prune Stale Rules' });
        this.node.id = 'ingot-rules-prune-dialog';
        this.node.classList.add('ingot-rules-dialog');
        this.appendCloseButton('Close');
        this.applyButton = this.createButton('Apply');
        this.applyButton.id = 'ingot-rules-prune-apply';
        this.applyButton.classList.add('main');
        this.controlPanel.appendChild(this.applyButton);
        this.addAction(this.applyButton, () => this.runApply(), 'click');
    }

    /** How many rules were changed. */
    get value(): number {
        return this.applied;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        void this.refresh();
    }

    protected actionable(plan: PrunePlan | undefined): PruneCandidate[] {
        return plan?.candidates.filter(candidate => candidate.action !== 'review') ?? [];
    }

    protected async refresh(): Promise<void> {
        this.busy = true;
        this.update();
        try {
            this.current = await this.pruneProps.plan(this.days);
            this.selected = new Set(this.actionable(this.current).map(candidate => candidate.path));
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.busy = false;
        this.update();
    }

    protected async runApply(): Promise<void> {
        if (this.busy || !this.selected.size) {
            return;
        }
        this.busy = true;
        this.update();
        try {
            const only = [...this.selected];
            this.current = await this.pruneProps.apply(this.days, only);
            this.applied += only.length;
            this.selected = new Set(this.actionable(this.current).map(candidate => candidate.path));
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.busy = false;
        this.update();
    }

    protected toggle(file: string): void {
        if (!this.selected.delete(file)) {
            this.selected.add(file);
        }
        this.update();
    }

    protected override onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.applyButton.disabled = this.busy || !this.selected.size;
        this.applyButton.textContent = this.selected.size ? `Apply to ${this.selected.size} rule${this.selected.size === 1 ? '' : 's'}` : 'Apply';
    }

    protected status(): { text: string; state: string } {
        const plan = this.current;
        if (this.error) {
            return { text: this.error, state: 'error' };
        }
        if (!plan) {
            return { text: 'Checking .ingot/rules…', state: '' };
        }
        if (!plan.candidates.length) {
            return { text: this.applied ? `Done. ${this.applied} rule${this.applied === 1 ? '' : 's'} pruned; the rest look current.` : `No stale rules among ${plan.rules}.`, state: 'ok' };
        }
        return { text: `${plan.candidates.length} of ${plan.rules} rules look stale.`, state: 'warn' };
    }

    protected render(): React.ReactNode {
        const plan = this.current;
        const status = this.status();
        return <div className='ingot-rules-body'>
            <p className='ingot-rules-lead'>
                Rules that no agent used lately, whose globs match nothing, or that mention deleted files or removed packages. Nothing changes until you apply;
                undo with <code>git checkout -- .ingot/rules</code>.
            </p>
            <div className='ingot-rules-row'>
                <label>Unused for
                    <input type='number' id='ingot-rules-prune-days' min={PRUNE_MIN_DAYS} max={PRUNE_MAX_DAYS} value={this.days} disabled={this.busy}
                        onChange={e => { this.days = Math.min(Math.max(Math.round(Number(e.currentTarget.value)) || PRUNE_MIN_DAYS, PRUNE_MIN_DAYS), PRUNE_MAX_DAYS); void this.refresh(); }} />
                    days
                </label>
                {plan?.usageWindowShort && <span className='ingot-rules-item-meta' id='ingot-rules-prune-window'>
                    {plan.trackingSince ? `Usage tracked since ${plan.trackingSince.slice(0, 10)}` : 'No usage data yet'}, so "unused" is not checked.
                </span>}
            </div>
            <div className={`ingot-rules-status ${status.state}`} id='ingot-rules-prune-status'>
                {this.busy && <span className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />} {status.text}
            </div>
            {plan && plan.candidates.length > 0 && <ul className='ingot-rules-list' id='ingot-rules-prune-candidates'>
                {plan.candidates.map(candidate => <li key={candidate.path} className='ingot-rules-item' data-path={candidate.path} data-action={candidate.action}>
                    <label className='ingot-rules-item-head'>
                        <input type='checkbox' className='ingot-rules-prune-check' checked={this.selected.has(candidate.path)}
                            disabled={this.busy || candidate.action === 'review'} onChange={() => this.toggle(candidate.path)} />
                        <span className='ingot-rules-item-name'>{candidate.rule}</span>
                        <span className='ingot-rules-item-meta'>{candidate.path}</span>
                        <span className={`ingot-rules-pill ${candidate.action === 'delete' ? 'fail' : candidate.action === 'review' ? 'ok' : 'warn'}`}>{PRUNE_ACTION_LABELS[candidate.action]}</span>
                    </label>
                    <ul className='ingot-rules-findings'>
                        {candidate.findings.map(finding => <li key={finding.reason} data-reason={finding.reason}><b>{PRUNE_LABELS[finding.reason]}</b>: {finding.detail}</li>)}
                        {candidate.action === 'remove-globs' && <li>keeps {candidate.keepGlobs?.join(', ')}</li>}
                    </ul>
                </li>)}
            </ul>}
            <p className='ingot-rules-hint'>From a terminal: <code>npx @ingotide/cli rules prune</code> (add <code>--apply</code> to change files).</p>
        </div>;
    }
}
