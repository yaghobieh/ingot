import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { CommandService } from '@theia/core/lib/common/command';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { AgentStore } from '../agents/agent-store';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { approvalQueue, managerCounts, managerRows, nextApproval } from '../../common/agents/agent-manager';
import { MANAGER_STATE_LABEL } from '../../common/agents/agent-manager.consts';
import type { ApprovalEntry, ManagerRow } from '../../common/agents/agent-manager.types';
import { AGENT_MANAGER_WIDGET_ID, AGENT_MANAGER_WIDGET_LABEL, ROW_INDENT_PX } from './agent-manager.consts';
import { ARTIFACTS_COMMANDS } from '../artifacts/artifacts.consts';

/**
 * IDEA-291: every chat and subagent in one list (status and current step), the queue of actions waiting for
 * approval with Run / Skip in place, and Jump to Next Approval.
 */
@injectable()
export class IngotAgentManagerWidget extends ReactWidget {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(IngotAgentsContribution) protected readonly agents: IngotAgentsContribution;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(CommandService) protected readonly commands: CommandService;

    /** The chat Jump to Next Approval landed on. */
    protected focused?: string;

    @postConstruct()
    protected init(): void {
        this.id = AGENT_MANAGER_WIDGET_ID;
        this.title.label = AGENT_MANAGER_WIDGET_LABEL;
        this.title.caption = 'All chats and subagents, and the actions waiting for approval';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-type-hierarchy-sub';
        this.addClass('ingot-agent-manager');
        this.node.tabIndex = 0;
        this.toDispose.push(this.store.onDidChange(() => this.update()));
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        (this.node.querySelector<HTMLElement>('.ingot-am-approval.focused .ingot-am-run') ?? this.node).focus();
    }

    /** Moves to the next waiting approval (oldest first, wrapping) and focuses its Run button. */
    jumpToNextApproval(): ApprovalEntry | undefined {
        const next = nextApproval(approvalQueue(this.store.allSessions), this.focused);
        if (!next) {
            this.messages.info('No agent is waiting for approval.');
            return undefined;
        }
        this.focused = next.sessionId;
        this.update();
        requestAnimationFrame(() => {
            const entry = this.node.querySelector<HTMLElement>(`.ingot-am-approval[data-session="${CSS.escape(next.sessionId)}"]`);
            entry?.scrollIntoView({ block: 'nearest' });
            entry?.querySelector<HTMLElement>('.ingot-am-run')?.focus();
        });
        return next;
    }

    protected async openChat(id: string): Promise<void> {
        this.store.select(id);
        await this.agents.openView({ activate: true, reveal: true });
    }

    protected decide(entry: ApprovalEntry, decision: 'run' | 'skip'): void {
        this.store.decideApproval(entry.sessionId, decision);
        if (this.focused === entry.sessionId) {
            this.focused = undefined;
        }
    }

    protected renderApproval(entry: ApprovalEntry): React.ReactNode {
        const focused = entry.sessionId === this.focused;
        return <li key={entry.approvalId} className={`ingot-am-approval${focused ? ' focused' : ''}`} data-session={entry.sessionId}>
            <span className='codicon codicon-shield ingot-am-approval-icon' aria-hidden='true' />
            <span className='ingot-am-approval-text'>
                <b className='ingot-am-approval-title'>{entry.title}</b>
                <span className='ingot-am-approval-line'>{entry.line}</span>
            </span>
            <button type='button' className='ingot-am-btn' title='Open the chat' aria-label={`Open ${entry.title}`} onClick={() => this.openChat(entry.sessionId)}>
                <span className='codicon codicon-link-external' />
            </button>
            <button type='button' className='ingot-am-text-btn ingot-am-skip' onClick={() => this.decide(entry, 'skip')}>Skip</button>
            <button type='button' className='ingot-am-text-btn ingot-am-run primary' onClick={() => this.decide(entry, 'run')}>Run</button>
        </li>;
    }

    protected renderRow(row: ManagerRow): React.ReactNode {
        const running = row.state === 'running';
        const artifacts = this.store.find(row.id)?.artifactsRun;
        return <li key={row.id} className={`ingot-am-row ${row.state}${row.id === this.focused ? ' focused' : ''}`} data-session={row.id} data-state={row.state}
            style={{ paddingLeft: `${row.depth * ROW_INDENT_PX}px` }}>
            <span className={`ingot-am-dot ${row.state}`} aria-hidden='true' />
            {row.depth > 0 && <span className='codicon codicon-type-hierarchy-sub ingot-am-sub' title='Subagent' aria-label='Subagent' />}
            <span className='ingot-am-main'>
                <span className='ingot-am-title'>{row.title}</span>
                <span className='ingot-am-step'>{row.step}</span>
            </span>
            {row.worktree && <span className='ingot-am-chip' title='Runs in its own git worktree'><span className='codicon codicon-git-branch' />{row.worktree}</span>}
            <span className={`ingot-am-state ${row.state}`}>{MANAGER_STATE_LABEL[row.state]}</span>
            {running && <button type='button' className='ingot-am-btn' title='Stop' aria-label={`Stop ${row.title}`} onClick={() => this.store.stop(row.id)}>
                <span className='codicon codicon-debug-stop' />
            </button>}
            {artifacts && <button type='button' className='ingot-am-btn ingot-am-artifacts' title='Open the run artifacts' aria-label={`Artifacts of ${row.title}`}
                onClick={() => this.commands.executeCommand(ARTIFACTS_COMMANDS.open.id, artifacts)}>
                <span className='codicon codicon-notebook' />
            </button>}
            <button type='button' className='ingot-am-btn' title='Open the chat' aria-label={`Open ${row.title}`} onClick={() => this.openChat(row.id)}>
                <span className='codicon codicon-link-external' />
            </button>
        </li>;
    }

    protected render(): React.ReactNode {
        const sessions = this.store.allSessions.filter(s => s.messages.length);
        const rows = managerRows(sessions, id => this.store.isRunning(id));
        const queue = approvalQueue(sessions);
        const counts = managerCounts(rows);
        return <div className='ingot-am-root'>
            <div className='ingot-am-toolbar'>
                <span className='ingot-am-summary' id='ingot-am-summary'>
                    {counts.total} {counts.total === 1 ? 'chat' : 'chats'} · {counts.running} running · {counts.approvals} waiting for approval
                </span>
                <span className='ingot-flex' />
                <button type='button' className='ingot-am-text-btn' id='ingot-am-next' disabled={!queue.length} onClick={() => this.jumpToNextApproval()}
                    title='Jump to the next action waiting for approval'>
                    <span className='codicon codicon-arrow-down' /> Next approval
                </button>
            </div>
            {queue.length > 0 && <section className='ingot-am-section' aria-label='Approvals'>
                <h3 className='ingot-am-heading'>Waiting for approval <span className='ingot-am-count'>{queue.length}</span></h3>
                <ul className='ingot-am-approvals' id='ingot-am-approvals'>{queue.map(entry => this.renderApproval(entry))}</ul>
            </section>}
            <section className='ingot-am-section' aria-label='Chats and subagents'>
                <h3 className='ingot-am-heading'>Chats and subagents</h3>
                {rows.length
                    ? <ul className='ingot-am-list' id='ingot-am-list'>{rows.map(row => this.renderRow(row))}</ul>
                    : <div className='ingot-am-empty'>No chats yet. Start one in the Agents panel.</div>}
            </section>
        </div>;
    }
}
