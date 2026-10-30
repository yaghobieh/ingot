import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { AgentStore } from '../agents/agent-store';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { chatTime } from '../../common/agents/chat-history';
import { threadStateLabel } from '../../common/threads/threads.utils';
import type { ThreadRow } from '../../common/threads/threads.types';
import { ThreadsService } from './threads-service';
import { THREAD_STATE_ICONS, THREADS_CLOCK_MS, THREADS_COMMANDS, THREADS_LABEL, THREADS_TEXT, THREADS_WIDGET_ID } from './threads.consts';

/** IDEA-268: the Threads tool window, every open chat grouped by project with its run state and worktree branch. */
@injectable()
export class ThreadsWidget extends ReactWidget {

    @inject(ThreadsService) protected readonly threads: ThreadsService;
    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;

    @postConstruct()
    protected init(): void {
        this.id = THREADS_WIDGET_ID;
        this.title.label = THREADS_LABEL;
        this.title.caption = THREADS_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-comment-discussion';
        this.addClass('ingot-threads');
        this.node.tabIndex = 0;
        this.toDispose.push(this.store.onDidChange(() => this.update()));
        this.toDispose.push(this.threads.onDidChange(() => this.update()));
        const clock = setInterval(() => this.update(), THREADS_CLOCK_MS);
        this.toDispose.push({ dispose: () => clearInterval(clock) });
        this.update();
    }

    protected shortcut(commandId: string): string {
        const binding = this.keybindings.getKeybindingsForCommand(commandId)[0];
        return binding ? ` (${this.keybindings.acceleratorFor(binding, '+').join(' ')})` : '';
    }

    protected render(): React.ReactNode {
        const groups = this.threads.groups;
        const running = this.threads.runningCount;
        const current = this.store.current?.id;
        return <div className='ingot-threads-root'>
            <div className='ingot-threads-head'>
                <span className='ingot-threads-title'>{THREADS_LABEL}</span>
                {running > 0 && <span className='ingot-threads-running' id='ingot-threads-running'>{running} {THREADS_TEXT.running}</span>}
                <span className='ingot-flex' />
                <button type='button' id='ingot-threads-new' className='ingot-icon-button codicon codicon-add' aria-label={THREADS_TEXT.newThread}
                    title={`${THREADS_TEXT.newThread}${this.shortcut(AGENT_COMMANDS.newAgent.id)}`} onClick={() => void this.threads.newThread(false)} />
                <button type='button' id='ingot-threads-new-worktree' className='ingot-icon-button codicon codicon-git-branch' aria-label={THREADS_TEXT.newWorktree}
                    title={`${THREADS_TEXT.newWorktree}${this.shortcut(THREADS_COMMANDS.newWorktree.id)}`} onClick={() => void this.threads.newThread(true)} />
            </div>
            <div className='ingot-threads-list' id='ingot-threads-list' role='tree' aria-label={THREADS_LABEL}>
                {groups.map(group => <div key={group.key} className='ingot-threads-group' role='group' aria-label={group.label} data-project={group.label}>
                    <div className='ingot-threads-group-head'>
                        <span className='codicon codicon-folder' />
                        <span className='ingot-threads-group-name'>{group.label}</span>
                        <span className='ingot-threads-count'>{group.rows.length}</span>
                    </div>
                    {group.rows.map(row => this.renderRow(row, row.id === current))}
                </div>)}
                {!groups.length && <div className='ingot-threads-empty'>{THREADS_TEXT.empty}</div>}
            </div>
        </div>;
    }

    protected renderRow(row: ThreadRow, active: boolean): React.ReactNode {
        const label = threadStateLabel(row.state);
        return <button type='button' role='treeitem' key={row.id} id={`ingot-thread-${row.id}`} data-state={row.state} aria-selected={active}
            className={`ingot-thread${active ? ' active' : ''}${row.unseen ? ' unseen' : ''}`} title={`${row.title} · ${label}`}
            onClick={() => void this.threads.open(row.id)}>
            <span className={`ingot-thread-status codicon ${THREAD_STATE_ICONS[row.state]} ${row.state}`} aria-label={label} />
            <span className='ingot-thread-text'>
                <span className='ingot-thread-title'>{row.title}</span>
                {row.branch && <span className='ingot-thread-branch'><span className='codicon codicon-git-branch' />{row.branch}</span>}
            </span>
            {row.unseen && <span className='ingot-thread-unseen' aria-label={THREADS_TEXT.unseen} title={THREADS_TEXT.unseen} />}
            <span className='ingot-thread-time'>{chatTime(row.updatedAt, Date.now())}</span>
        </button>;
    }
}
