import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { Message } from '@theia/core/lib/browser/widgets';
import { EXPORT_TARGET_LABELS, EXPORT_TARGETS } from '../../common/rules-kit';
import type { ExportPlan, ExportTarget } from '../../common/rules-kit';
import { EXPORT_ACTION_LABELS } from '../../common/rules-tools/rules-tools.consts';

export interface RulesExportDialogProps {
    readonly plan: (targets: readonly ExportTarget[], force: boolean) => Promise<ExportPlan>;
    readonly apply: (targets: readonly ExportTarget[], force: boolean) => Promise<ExportPlan>;
}

/** IDEA-319: Export Rules to Other Tools. Shows what `ingot export` would write per target, then writes it. */
export class RulesExportDialog extends ReactDialog<boolean> {

    protected targets = new Set<ExportTarget>(EXPORT_TARGETS);
    protected force = false;
    protected current?: ExportPlan;
    protected busy = false;
    protected error?: string;
    protected exported = false;
    protected readonly exportButton: HTMLButtonElement;

    constructor(protected readonly exportProps: RulesExportDialogProps) {
        super({ title: 'Export Rules to Other Tools' });
        this.node.id = 'ingot-rules-export-dialog';
        this.node.classList.add('ingot-rules-dialog');
        this.appendCloseButton('Close');
        this.exportButton = this.createButton('Export');
        this.exportButton.id = 'ingot-rules-export-apply';
        this.exportButton.classList.add('main');
        this.controlPanel.appendChild(this.exportButton);
        this.addAction(this.exportButton, () => this.runExport(), 'click');
    }

    get value(): boolean {
        return this.exported;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        void this.refresh();
    }

    protected selected(): ExportTarget[] {
        return EXPORT_TARGETS.filter(target => this.targets.has(target));
    }

    protected async refresh(): Promise<void> {
        this.busy = true;
        this.update();
        try {
            this.current = await this.exportProps.plan(this.selected(), this.force);
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.busy = false;
        this.update();
    }

    protected async runExport(): Promise<void> {
        if (this.busy || !this.current?.drift) {
            return;
        }
        this.busy = true;
        this.update();
        try {
            this.current = await this.exportProps.apply(this.selected(), this.force);
            this.exported = true;
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.busy = false;
        this.update();
    }

    protected toggle(target: ExportTarget): void {
        if (!this.targets.delete(target)) {
            this.targets.add(target);
        }
        void this.refresh();
    }

    protected override onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.exportButton.disabled = this.busy || !this.current?.drift;
    }

    protected render(): React.ReactNode {
        const plan = this.current;
        const changed = plan?.files.filter(f => f.action === 'create' || f.action === 'update' || f.action === 'delete') ?? [];
        const status = this.error ? this.error
            : !plan ? 'Reading .ingot/rules…'
                : !plan.rules ? 'No rules in .ingot/rules to export yet.'
                    : changed.length ? `${changed.length} file${changed.length === 1 ? '' : 's'} will change.`
                        : this.exported ? 'Exported. Every tool now reads the same rules.' : 'Up to date: the exported files match .ingot/rules.';
        return <div className='ingot-rules-body'>
            <p className='ingot-rules-lead'>
                Write the {plan?.rules ?? ''} rules in <code>.ingot/rules</code> to the files other AI tools read. Your own text in AGENTS.md and
                CLAUDE.md stays; hand-written rule files are never overwritten. Add <code>export: false</code> to a rule to keep it private.
            </p>
            <div className='ingot-rules-targets' role='group' aria-label='Targets'>
                {EXPORT_TARGETS.map(target => {
                    const count = plan?.files.filter(f => f.target === target && f.action !== 'unchanged' && f.action !== 'skipped').length ?? 0;
                    return <label key={target} className='ingot-rules-target' data-target={target}>
                        <input type='checkbox' id={`ingot-rules-export-target-${target}`} checked={this.targets.has(target)} disabled={this.busy} onChange={() => this.toggle(target)} />
                        <span>{EXPORT_TARGET_LABELS[target]}</span>
                        {this.targets.has(target) && plan && <span className={`ingot-rules-pill ${count ? 'warn' : 'ok'}`}>{count ? `${count} to update` : 'up to date'}</span>}
                    </label>;
                })}
            </div>
            <div className={`ingot-rules-status ${this.error ? 'error' : changed.length ? 'warn' : 'ok'}`} id='ingot-rules-export-status'>
                {this.busy && <span className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />} {status}
            </div>
            {plan && plan.files.length > 0 && <ul className='ingot-rules-files' id='ingot-rules-export-files'>
                {plan.files.map(file => <li key={file.path} className={`ingot-rules-file ${file.action}`} data-path={file.path} data-action={file.action} title={file.reason}>
                    <span className={`ingot-rules-action ${file.action}`}>{EXPORT_ACTION_LABELS[file.action]}</span>
                    <code className='ingot-rules-path'>{file.path}</code>
                    {file.action !== 'unchanged' && file.action !== 'skipped' && <span className='ingot-rules-delta'><span className='add'>+{file.added}</span> <span className='del'>−{file.removed}</span></span>}
                    {file.reason && <span className='ingot-rules-reason'>{file.reason}</span>}
                </li>)}
            </ul>}
            {plan?.files.some(f => f.action === 'skipped') && <label className='ingot-rules-force'>
                <input type='checkbox' id='ingot-rules-export-force' checked={this.force} onChange={() => { this.force = !this.force; void this.refresh(); }} /> Overwrite hand-written files
            </label>}
            <p className='ingot-rules-hint'>In CI, <code>npx @ingotide/cli export --check</code> fails when these files drift from <code>.ingot/rules</code>.</p>
        </div>;
    }
}
