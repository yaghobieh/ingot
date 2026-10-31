import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { Message } from '@theia/core/lib/browser/widgets';
import { DEFAULT_MAX_COST_USD, DEFAULT_TEST_MODEL, formatUsd, isMockModel, MAX_COST_CEILING_USD, PERCENT } from '../../common/rules-kit';
import type { RuleTestReport, RuleTestResult } from '../../common/rules-kit';
import { CAP_DIGITS, COST_STEP_USD, MOCK_MODEL_LABEL, NO_KEY_MESSAGE, RULE_TEST_MODELS } from '../../common/rules-tools/rules-tools.consts';
import type { RuleTestListing, RuleTestRequest } from '../../common/rules-tools/rules-tools.types';

export interface RulesTestDialogProps {
    readonly list: () => Promise<RuleTestListing>;
    readonly run: (request: RuleTestRequest) => Promise<RuleTestReport>;
}

const percent = (rate: number): string => `${Math.round(rate * PERCENT)}%`;

const resultState = (result: RuleTestResult): 'ok' | 'warn' | 'fail' =>
    result.passed === result.runs.length + result.skipped && result.runs.length ? 'ok' : result.passed ? 'warn' : 'fail';

/** IDEA-320: Test Rules. Runs `.ingot/tests/*.yaml` against the project's rules with a cheap model under a hard cost cap. */
export class RulesTestDialog extends ReactDialog<boolean> {

    protected listing?: RuleTestListing;
    protected report?: RuleTestReport;
    protected model = DEFAULT_TEST_MODEL;
    protected maxCostUsd = DEFAULT_MAX_COST_USD;
    protected busy = false;
    protected error?: string;
    protected readonly runButton: HTMLButtonElement;

    constructor(protected readonly testProps: RulesTestDialogProps) {
        super({ title: 'Test Rules' });
        this.node.id = 'ingot-rules-test-dialog';
        this.node.classList.add('ingot-rules-dialog');
        this.appendCloseButton('Close');
        this.runButton = this.createButton('Run Tests');
        this.runButton.id = 'ingot-rules-test-run';
        this.runButton.classList.add('main');
        this.controlPanel.appendChild(this.runButton);
        this.addAction(this.runButton, () => this.runTests(), 'click');
    }

    get value(): boolean {
        return !!this.report;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        void this.load();
    }

    protected async load(): Promise<void> {
        this.busy = true;
        this.update();
        try {
            this.listing = await this.testProps.list();
            this.report = this.listing.lastReport;
            if (!this.listing.keyConfigured) {
                this.model = RULE_TEST_MODELS[0];
            }
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.busy = false;
        this.update();
    }

    protected async runTests(): Promise<void> {
        if (this.busy || !this.listing?.cases.length) {
            return;
        }
        this.busy = true;
        this.error = undefined;
        this.update();
        try {
            this.report = await this.testProps.run({ model: this.model, maxCostUsd: this.maxCostUsd });
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.busy = false;
        this.update();
    }

    protected override onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.runButton.disabled = this.busy || !this.listing?.cases.length || (!isMockModel(this.model) && !this.listing.keyConfigured);
    }

    protected status(): { text: string; state: string } {
        const report = this.report;
        if (this.error) {
            return { text: this.error, state: 'error' };
        }
        if (this.busy) {
            return { text: this.listing ? `Running ${this.listing.cases.length} test${this.listing.cases.length === 1 ? '' : 's'} with ${this.model}…` : 'Reading .ingot/tests…', state: '' };
        }
        if (this.listing && !this.listing.cases.length) {
            return { text: 'No tests yet. Add a .yaml file to .ingot/tests (see the Rules docs).', state: 'warn' };
        }
        if (!isMockModel(this.model) && this.listing && !this.listing.keyConfigured) {
            return { text: NO_KEY_MESSAGE, state: 'warn' };
        }
        if (!report) {
            return { text: `${this.listing?.cases.length ?? ''} tests ready. Nothing has been sent yet.`, state: '' };
        }
        if (report.capped) {
            return { text: `Cost cap reached: ${report.skipped} run${report.skipped === 1 ? '' : 's'} not made. Raise the cap or run fewer tests.`, state: 'warn' };
        }
        return { text: report.passRate === 1 ? 'All tests passed.' : `${report.total - report.passed} of ${report.total} runs failed.`, state: report.passRate === 1 ? 'ok' : 'error' };
    }

    protected render(): React.ReactNode {
        const listing = this.listing;
        const report = this.report;
        const status = this.status();
        return <div className='ingot-rules-body'>
            <p className='ingot-rules-lead'>
                Each test in <code>.ingot/tests/*.yaml</code> sends a prompt with your rules and checks the reply. Runs use a cheap model and stop
                before they could cross the cost cap.
            </p>
            <div className='ingot-rules-row'>
                <label>Model
                    <select id='ingot-rules-test-model' value={this.model} disabled={this.busy} onChange={e => { this.model = e.currentTarget.value; this.update(); }}>
                        {RULE_TEST_MODELS.map(model => <option key={model} value={model}>{isMockModel(model) ? MOCK_MODEL_LABEL : model}</option>)}
                    </select>
                </label>
                <label>Cost cap ($)
                    <input type='number' id='ingot-rules-test-cap' min={0} max={MAX_COST_CEILING_USD} step={COST_STEP_USD} value={this.maxCostUsd} disabled={this.busy || isMockModel(this.model)}
                        onChange={e => { this.maxCostUsd = Math.min(Math.max(Number(e.currentTarget.value) || 0, 0), MAX_COST_CEILING_USD); this.update(); }} />
                </label>
                <span className='ingot-rules-item-meta'>at most ${MAX_COST_CEILING_USD.toFixed(CAP_DIGITS)} per run</span>
            </div>
            <div className={`ingot-rules-status ${status.state}`} id='ingot-rules-test-status'>
                {this.busy && <span className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />} {status.text}
            </div>
            {report && <div id='ingot-rules-test-summary' className='ingot-rules-row' data-pass-rate={report.passRate}>
                <b id='ingot-rules-test-rate'>{percent(report.passRate)}</b>
                <span>passed ({report.passed}/{report.total} runs)</span>
                <span className='ingot-rules-item-meta' id='ingot-rules-test-cost'>{report.model} · {formatUsd(report.costUsd)} of {formatUsd(report.maxCostUsd)}</span>
            </div>}
            {report && <div className={`ingot-rules-meter ${report.passRate < 1 ? 'fail' : ''}`}><span style={{ width: percent(report.passRate) }} /></div>}
            {report && report.results.length > 0 && <ul className='ingot-rules-list' id='ingot-rules-test-results'>
                {report.results.map(result => {
                    const state = resultState(result);
                    const failed = result.runs.find(run => !run.passed);
                    return <li key={result.id} className='ingot-rules-item' data-test={result.name} data-state={state}>
                        <div className='ingot-rules-item-head'>
                            <span className={`codicon codicon-${state === 'ok' ? 'pass' : state === 'warn' ? 'warning' : 'error'} ingot-rules-pill-icon ${state}`} aria-hidden='true' />
                            <span className='ingot-rules-item-name'>{result.name}</span>
                            <span className='ingot-rules-item-meta'>{result.file}</span>
                            <span className={`ingot-rules-pill ${state}`}>{result.passed}/{result.runs.length + result.skipped}{result.skipped ? ` · ${result.skipped} skipped` : ''}</span>
                        </div>
                        {failed && <ul className='ingot-rules-findings'>{failed.failures.map(failure => <li key={failure}>{failure}</li>)}</ul>}
                        {failed && <div className='ingot-rules-reply'>{failed.reply}</div>}
                    </li>;
                })}
            </ul>}
            {[...(listing?.errors ?? []), ...(report?.errors ?? [])].filter((e, i, all) => all.indexOf(e) === i).map(error =>
                <div key={error} className='ingot-rules-status error'>{error}</div>)}
            <p className='ingot-rules-hint'>In CI, <code>npx @ingotide/cli rules test --mock</code> runs the same tests for free.</p>
        </div>;
    }
}
