import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { BOT_STATUS_LABELS } from '../../common/bot/bot.consts';
import type { BotApproval, BotDecision, BotEvent, BotMessage, BotRun } from '../../common/bot/bot.types';
import { eventLine, formatMinutes, isActiveRun, mascotPose, modeNotice, prLinkIn } from '../../common/bot/bot.utils';
import { IngotAccountService } from '../account/account-service';
import { IngotBotService } from './bot-service';
import { BOT_COMPOSER_PLACEHOLDER, BOT_WIDGET_ID, BOT_WIDGET_LABEL } from './bot.browser-consts';
import { ZaprexMascotView } from './zaprex-mascot-view';

/**
 * IDEA-154: Zaprex panel. Reuses the chat look (messages, agent head), the approval card and the processes list
 * for runs, over the same `/api/bot` thread as the website.
 */
@injectable()
export class IngotBotWidget extends ReactWidget {

    @inject(IngotBotService) protected readonly bot: IngotBotService;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;

    protected draft = '';
    protected error = '';
    protected busy = false;
    protected openRun: string | undefined;
    protected runLog: BotEvent[] = [];

    @postConstruct()
    protected init(): void {
        this.id = BOT_WIDGET_ID;
        this.title.label = BOT_WIDGET_LABEL;
        this.title.caption = BOT_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-zaprex-tab-icon';
        this.addClass('ingot-agents');
        this.addClass('ingot-bot');
        this.toDispose.push(this.bot.onDidChange(() => this.update()));
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.bot.setVisible(true);
    }

    protected override onAfterHide(msg: Message): void {
        super.onAfterHide(msg);
        this.bot.setVisible(false);
    }

    protected async act(work: () => Promise<string | void>): Promise<void> {
        this.busy = true;
        this.error = '';
        this.update();
        this.error = (await work()) || '';
        this.busy = false;
        this.update();
    }

    protected send(): void {
        const text = this.draft;
        if (!text.trim() || this.busy) { return; }
        this.draft = '';
        void this.act(() => this.bot.send(text));
    }

    protected async toggleRun(run: BotRun): Promise<void> {
        this.openRun = this.openRun === run.id ? undefined : run.id;
        this.runLog = this.openRun ? await this.bot.events(run.id) : [];
        this.update();
    }

    protected render(): React.ReactNode {
        const state = this.bot.snapshot;
        return <div className='ingot-agents-root ingot-bot-root' id='ingot-bot-root'>
            <div className='ingot-agents-header'>
                <span className='ingot-bot-title'><ZaprexMascotView pose={mascotPose(state.runs)} size={28} /> Zaprex</span>
                {modeNotice(state) === 'test' && <span className='ingot-badge' id='ingot-bot-test-mode' title='Runs use a local sandbox and the mock model'>Test mode</span>}
                {modeNotice(state) === 'sandbox' && <span className='ingot-badge' id='ingot-bot-sandbox-mode' title='Runs use a scratch sandbox on the live model'>Sandbox</span>}
                <span className='ingot-flex' />
                {state.repos.length > 0 && <select className='theia-select ingot-bot-repo' id='ingot-bot-repo' aria-label='Repository' value={state.repoId} onChange={e => this.bot.selectRepo(e.target.value)}>
                    <option value=''>No repository</option>
                    {state.repos.map(repo => <option key={repo.id} value={repo.id}>{repo.fullName}</option>)}
                </select>}
                <button type='button' className='ingot-icon-button codicon codicon-refresh' id='ingot-bot-refresh' title='Refresh' aria-label='Refresh' onClick={() => void this.bot.refresh()} />
                <button type='button' className='ingot-icon-button codicon codicon-link-external' id='ingot-bot-open-web' title='Routines, memory and GitHub on the website' aria-label='Open on the website' onClick={() => this.bot.openOnWebsite()} />
            </div>
            {this.renderBody()}
        </div>;
    }

    protected renderBody(): React.ReactNode {
        const state = this.bot.snapshot;
        if (!state.signedIn) {
            return <div className='ingot-agents-hint' id='ingot-bot-signed-out'>
                Sign in to Ingot to give Zaprex background tasks.
                <div><button type='button' className='theia-button main' id='ingot-bot-sign-in' onClick={() => void this.account.signIn(this.account.devSignInAvailable)}>Sign in</button></div>
            </div>;
        }
        if (state.loading) {
            return <div className='ingot-agents-hint'>Loading…</div>;
        }
        if (state.error && !state.entitlement) {
            return <div className='ingot-agents-hint ingot-bot-error' id='ingot-bot-error'>{state.error}</div>;
        }
        if (state.entitlement && !state.entitlement.enabled) {
            return <div className='ingot-agents-hint' id='ingot-bot-upsell'>
                {state.entitlement.reason === 'kill_switch' ? 'Zaprex is paused by the Ingot team right now.' : 'Zaprex is part of Pro+ and Ultra. It fixes tests overnight and opens a draft PR.'}
                {state.entitlement.reason !== 'kill_switch' && <div><button type='button' className='theia-button main' id='ingot-bot-upgrade' onClick={() => this.account.openBilling()}>See plans</button></div>}
            </div>;
        }
        const pending = state.approvals.filter(a => a.status === 'pending');
        return <>
            {state.usage && <div className='ingot-bot-usage ingot-dim' id='ingot-bot-usage'>
                {state.usage.minutesUsed}{state.usage.minutesLimit ? ` / ${state.usage.minutesLimit}` : ''} min this month · {state.usage.activeRuns}{state.usage.concurrentLimit ? ` / ${state.usage.concurrentLimit}` : ''} running
            </div>}
            <div className='ingot-agents-chat' id='ingot-bot-thread'>
                {state.messages.length ? state.messages.map(m => this.renderMessage(m)) : <div className='ingot-agents-hint'>Try “Fix the failing tests”. Zaprex works in a sandbox and opens a draft PR. Nothing is pushed to protected branches.</div>}
            </div>
            {this.renderRuns(state.runs)}
            {pending.map(a => this.renderApproval(a))}
            {this.error && <div className='ingot-bot-error' id='ingot-bot-send-error' role='alert'>{this.error}</div>}
            <div className='ingot-composer ingot-bot-composer'>
                <textarea className='ingot-bot-input' id='ingot-bot-input' placeholder={BOT_COMPOSER_PLACEHOLDER} value={this.draft} rows={3}
                    onChange={e => { this.draft = e.target.value; this.update(); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }} />
                <button type='button' className='theia-button main' id='ingot-bot-send' disabled={this.busy || !this.draft.trim()} onClick={() => this.send()}>Send</button>
            </div>
        </>;
    }

    protected renderMessage(m: BotMessage): React.ReactNode {
        if (m.kind === 'approval') {
            return <div key={m.id} className='ingot-chat-msg ingot-chat-agent ingot-bot-approval-note'><span className='codicon codicon-shield' /> {m.text}</div>;
        }
        const pr = m.role === 'bot' ? prLinkIn(m.text) : undefined;
        return <div key={m.id} className={`ingot-chat-msg ingot-chat-${m.role === 'bot' ? 'agent' : 'user'}`} data-role={m.role}>
            {m.role === 'bot' && <div className='ingot-chat-agent-head'><span className='ingot-zaprex-avatar' aria-hidden='true' /><b>Zaprex</b></div>}
            <div className='ingot-bot-text'>{m.text}</div>
            {pr && <a className='ingot-bot-pr' id='ingot-bot-pr-link' href={pr} target='_blank' rel='noreferrer'>Open draft PR</a>}
        </div>;
    }

    /** Same card as agent approvals (IDEA-109): label, detail, then Reject / Approve for this run / Approve. */
    protected renderApproval(a: BotApproval): React.ReactNode {
        const decide = (decision: BotDecision): void => { void this.act(() => this.bot.decide(a.id, decision)); };
        return <div key={a.id} className='ingot-approval-wrap'>
            <div className='ingot-approval ingot-bot-approval' id='ingot-bot-approval' role='alertdialog' aria-label={a.title} data-kind={a.action}>
                <div className='ingot-approval-line' title={a.reason}>
                    <span className='ingot-approval-label'>{a.title}{a.reason ? ':' : ''}</span>{a.reason && <span className='ingot-approval-detail'> {a.reason}</span>}
                </div>
                {a.preview && <pre className='ingot-process-output'>{a.preview}</pre>}
                <div className='ingot-approval-actions'>
                    <button type='button' className='ingot-approval-skip' id='ingot-bot-reject' disabled={this.busy} onClick={() => decide('reject')}>Reject</button>
                    <button type='button' className='ingot-approval-always' id='ingot-bot-approve-run' disabled={this.busy} onClick={() => decide('approve_run')}>Approve for this run</button>
                    <button type='button' className='ingot-approval-run' id='ingot-bot-approve' disabled={this.busy} onClick={() => decide('approve_once')}>Approve</button>
                </div>
            </div>
        </div>;
    }

    /** Runs in the processes-list look (IDEA-132): dot, task, status, minutes, ■ cancel; click for the log. */
    protected renderRuns(runs: readonly BotRun[]): React.ReactNode {
        if (!runs.length) { return undefined; }
        const running = runs.filter(isActiveRun).length;
        return <div className='ingot-processes ingot-bot-runs' id='ingot-bot-runs'>
            <div className='ingot-processes-head'>
                <span className='ingot-processes-title'>Zaprex runs</span>
                <span className='ingot-processes-count' id='ingot-bot-runs-count'>{running ? `${running} running` : 'none running'}</span>
            </div>
            <div className='ingot-processes-list' role='list'>
                {runs.slice(0, 5).map(run => {
                    const active = isActiveRun(run);
                    const status = active ? 'running' : run.status === 'succeeded' ? 'exited' : 'failed';
                    return <div key={run.id} className={`ingot-process ingot-process-${status}${this.openRun === run.id ? ' open' : ''}`} role='listitem' data-id={run.id} data-status={run.status}>
                        <div className='ingot-process-row' role='button' tabIndex={0} title={run.prompt} onClick={() => void this.toggleRun(run)}
                            onKeyDown={e => { if (e.key === 'Enter') { void this.toggleRun(run); } }}>
                            <span className='ingot-process-dot' aria-hidden='true' />
                            <code className='ingot-process-command'>{run.prompt}</code>
                            {run.prUrl && <a className='ingot-process-port' href={run.prUrl} target='_blank' rel='noreferrer' onClick={e => e.stopPropagation()}>#{run.prNumber}</a>}
                            <span className='ingot-process-status ingot-bot-run-status'>{BOT_STATUS_LABELS[run.status]}</span>
                            <span className='ingot-process-uptime'>{formatMinutes(run.computeSeconds)}</span>
                            {active
                                ? <button type='button' className='ingot-icon-button codicon codicon-debug-stop ingot-process-stop' title='Cancel run' aria-label='Cancel run'
                                    onClick={e => { e.stopPropagation(); void this.bot.cancel(run.id); }} />
                                : <span className='ingot-process-stop-spacer' />}
                        </div>
                        {this.openRun === run.id && <pre className='ingot-process-output' id='ingot-bot-run-log'>{this.runLog.map(ev => eventLine(ev.type, ev.payload)).join('\n') || 'No events yet.'}</pre>}
                    </div>;
                })}
            </div>
        </div>;
    }
}
