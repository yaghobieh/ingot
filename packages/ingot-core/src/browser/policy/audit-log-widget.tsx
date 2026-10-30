import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { AUDIT_DECISION_LABELS, AUDIT_OUTCOME_LABELS } from '../../common/audit/agent-audit.consts';
import type { AuditEntry, AuditVerifyResult } from '../../common/audit/agent-audit.types';
import { formatAuditTime, formatDuration, matchesQuery } from '../../common/audit/agent-audit.utils';
import { POLICY_FILE } from '../../common/policy/agent-policy.consts';
import type { PolicyLoad } from '../../common/policy/agent-policy.types';
import { policySummary } from '../../common/policy/agent-policy.utils';
import { AgentAuditLog } from './agent-audit-log';
import { AgentPolicyService } from './agent-policy-service';
import { AUDIT_COLUMNS, AUDIT_REFRESH_DEBOUNCE_MS, AUDIT_TEXT, AUDIT_WIDGET_ID, AUDIT_WIDGET_LABEL, DECISION_FILTERS, POLICY_COMMANDS, type DecisionFilter } from './policy.consts';

/** IDEA-263: every agent tool call (newest first) with its decision and result, the chain check and the policy in force. */
@injectable()
export class IngotAuditLogWidget extends ReactWidget {

    @inject(AgentAuditLog) protected readonly audit: AgentAuditLog;
    @inject(AgentPolicyService) protected readonly policy: AgentPolicyService;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(FileService) protected readonly files: FileService;

    protected entries: AuditEntry[] = [];
    protected chain?: AuditVerifyResult;
    protected loadedPolicy?: PolicyLoad;
    protected location = '';
    protected query = '';
    protected decision: DecisionFilter = 'all';
    protected expanded = new Set<number>();
    protected loading = false;
    protected error?: string;
    protected refreshTimer?: ReturnType<typeof setTimeout>;

    @postConstruct()
    protected init(): void {
        this.id = AUDIT_WIDGET_ID;
        this.title.label = AUDIT_WIDGET_LABEL;
        this.title.caption = 'Every agent tool call: what, when, decision and result';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-shield';
        this.addClass('ingot-audit');
        this.node.tabIndex = 0;
        this.toDispose.push(this.audit.onDidAppend(() => this.scheduleRefresh()));
        this.toDispose.push(this.files.onDidFilesChange(event => {
            if (event.changes.some(change => change.resource.path.toString().endsWith(POLICY_FILE))) {
                this.scheduleRefresh();
            }
        }));
        this.toDispose.push({ dispose: () => this.refreshTimer && clearTimeout(this.refreshTimer) });
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.refresh();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected scheduleRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh();
        }, AUDIT_REFRESH_DEBOUNCE_MS);
    }

    async refresh(): Promise<void> {
        this.loading = true;
        this.update();
        try {
            const [entries, chain, location, loadedPolicy] = await Promise.all([
                this.audit.service.list(), this.audit.service.verify(), this.audit.service.location(), this.policy.load()
            ]);
            this.entries = entries.reverse();
            this.chain = chain;
            this.location = location;
            this.loadedPolicy = loadedPolicy;
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected toggle(seq: number): void {
        if (!this.expanded.delete(seq)) {
            this.expanded.add(seq);
        }
        this.update();
    }

    protected render(): React.ReactNode {
        const rows = this.entries.filter(entry => (this.decision === 'all' || entry.decision === this.decision) && matchesQuery(entry, this.query));
        return <div className='ingot-audit-root' id='ingot-audit'>
            {this.renderPolicy()}
            <div className='ingot-audit-toolbar'>
                <input id='ingot-audit-filter' className='theia-input ingot-audit-filter' placeholder={AUDIT_TEXT.filter} aria-label={AUDIT_TEXT.filter} value={this.query}
                    onChange={e => { this.query = e.currentTarget.value; this.update(); }} />
                <select id='ingot-audit-decision' className='theia-select ingot-audit-select' aria-label='Decision' value={this.decision}
                    onChange={e => { this.decision = e.currentTarget.value as DecisionFilter; this.update(); }}>
                    {DECISION_FILTERS.map(d => <option key={d} value={d}>{d === 'all' ? AUDIT_TEXT.allDecisions : AUDIT_DECISION_LABELS[d]}</option>)}
                </select>
                {this.renderChain()}
                <button type='button' id='ingot-audit-refresh' className='ingot-audit-iconbtn' title='Refresh' aria-label='Refresh audit log' onClick={() => this.refresh()}>
                    <span className={`codicon codicon-refresh ${this.loading ? 'codicon-modifier-spin' : ''}`} />
                </button>
            </div>
            {this.error && <div className='ingot-audit-error'>{this.error}</div>}
            <div className='ingot-audit-scroll'>
                <table className='ingot-audit-table' id='ingot-audit-table'>
                    <thead><tr><th>Time</th><th>Tool</th><th>Action</th><th>Decision</th><th>Result</th><th className='ingot-audit-num'>Duration</th></tr></thead>
                    <tbody>{rows.map(entry => this.renderRow(entry))}</tbody>
                </table>
                {!rows.length && !this.error && <div className='ingot-audit-empty' id='ingot-audit-empty'>{this.entries.length ? AUDIT_TEXT.noMatch : AUDIT_TEXT.empty}</div>}
            </div>
            <div className='ingot-audit-footer' title={this.location}>{AUDIT_TEXT.footer}{this.location ? ` · ${this.location}` : ''}</div>
        </div>;
    }

    protected renderPolicy(): React.ReactNode {
        const load = this.loadedPolicy;
        if (!load) {
            return undefined;
        }
        return <div className='ingot-audit-policy' id='ingot-audit-policy' data-exists={load.exists}>
            <span className='codicon codicon-law' aria-hidden='true' />
            <span className='ingot-audit-policy-title'>{load.exists ? POLICY_FILE : AUDIT_TEXT.noPolicy}</span>
            {policySummary(load.policy).map(line => <span key={line} className='ingot-audit-chip'>{line}</span>)}
            {!!load.errors.length && <span className='ingot-audit-policy-error' id='ingot-audit-policy-error'>{load.errors.join(' ')}</span>}
            <button type='button' id='ingot-audit-open-policy' className='ingot-audit-btn' onClick={() => this.commands.executeCommand(POLICY_COMMANDS.openPolicy.id)}>
                {load.exists ? AUDIT_TEXT.editPolicy : AUDIT_TEXT.createPolicy}
            </button>
        </div>;
    }

    protected renderChain(): React.ReactNode {
        const chain = this.chain;
        if (!chain) {
            return undefined;
        }
        return <span id='ingot-audit-chain' className={`ingot-audit-chain ${chain.ok ? 'ok' : 'broken'}`} title={chain.reason ?? 'Every line hashes to the next one'}>
            <span className={`codicon ${chain.ok ? 'codicon-verified' : 'codicon-warning'}`} aria-hidden='true' />
            {chain.ok ? `${AUDIT_TEXT.chainOk} · ${chain.count} ${chain.count === 1 ? 'entry' : 'entries'}` : `${AUDIT_TEXT.chainBroken} at line ${chain.brokenAt}`}
        </span>;
    }

    protected renderRow(entry: AuditEntry): React.ReactNode {
        const open = this.expanded.has(entry.seq);
        const now = new Date();
        const row = <tr key={entry.seq} className={`ingot-audit-row ${open ? 'open' : ''}`} data-seq={entry.seq} data-tool={entry.tool} data-decision={entry.decision} data-outcome={entry.outcome}
            tabIndex={0} aria-expanded={open} onClick={() => this.toggle(entry.seq)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(entry.seq))}>
            <td className='ingot-audit-time' title={entry.at}>{formatAuditTime(entry.at, now)}</td>
            <td className='ingot-audit-tool' title={entry.tool}>{entry.tool}</td>
            <td className='ingot-audit-summary' title={entry.summary}>
                {entry.summary}
                {entry.sandboxed && <span className='ingot-audit-tag'>{AUDIT_TEXT.sandboxed}</span>}
            </td>
            <td><span className={`ingot-audit-badge decision-${entry.decision}`}>{AUDIT_DECISION_LABELS[entry.decision]}</span></td>
            <td><span className={`ingot-audit-badge outcome-${entry.outcome}`}>{AUDIT_OUTCOME_LABELS[entry.outcome]}</span></td>
            <td className='ingot-audit-num'>{formatDuration(entry.durationMs)}</td>
        </tr>;
        if (!open) {
            return row;
        }
        return <React.Fragment key={entry.seq}>
            {row}
            <tr className='ingot-audit-details' data-seq={entry.seq}>
                <td colSpan={AUDIT_COLUMNS}>
                    <dl>
                        {entry.reason && <><dt>Reason</dt><dd className='ingot-audit-reason'>{entry.reason}</dd></>}
                        {entry.chat && <><dt>Chat</dt><dd>{entry.chat}</dd></>}
                        {entry.project && <><dt>Project</dt><dd>{entry.project}</dd></>}
                        <dt>Arguments</dt><dd><pre>{JSON.stringify(entry.args, undefined, 2)}</pre></dd>
                        {entry.output && <><dt>Output</dt><dd><pre>{entry.output}</pre></dd></>}
                        <dt>Entry</dt><dd className='ingot-audit-hash'>#{entry.seq} · {entry.at} · {entry.hash.slice(0, 16)}…</dd>
                    </dl>
                </td>
            </tr>
        </React.Fragment>;
    }
}
