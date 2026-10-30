import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { MessageService } from '@theia/core/lib/common/message-service';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AgentStore } from '../agents/agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { AGENT_COMMANDS, AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { GitService } from '../../common/git/git.types';
import { PRODUCT } from '../../common/product.consts';
import type { AgentSession } from '../../common/agents/agents.types';
import type { ThreadGroup } from '../../common/threads/threads.types';
import { finishedThreads, finishMessage, groupThreads, threadState, worktreeName } from '../../common/threads/threads.utils';
import { THREADS_TEXT, THREADS_TOAST_MS } from './threads.consts';

const userTurns = (session: AgentSession): number => session.messages.filter(m => m.role === 'user').length;

/**
 * IDEA-268: chats as parallel threads. Watches every chat's run, announces the ones that finish (toast, plus a system
 * notification when the window is in the background), and starts threads that work in their own git worktree.
 */
@injectable()
export class ThreadsService {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(GitService) protected readonly git: GitService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected running = new Set<string>();
    protected readonly unseen = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.running = this.runningNow();
        this.store.onDidChange(() => this.check());
    }

    get groups(): ThreadGroup[] {
        const sessions = this.store.allSessions.filter(s => !s.parent && (s.open || this.store.isRunning(s.id) || this.unseen.has(s.id)));
        return groupThreads(sessions.map(s => ({
            id: s.id, title: s.title, status: s.status, updatedAt: s.updatedAt, messageCount: userTurns(s), running: this.store.isRunning(s.id),
            unseen: this.unseen.has(s.id), project: s.project, worktree: s.worktree
        })), this.workspace.tryGetRoots()[0]?.resource.toString());
    }

    get runningCount(): number {
        return this.running.size;
    }

    protected runningNow(): Set<string> {
        return new Set(this.store.allSessions.filter(s => this.store.isRunning(s.id)).map(s => s.id));
    }

    protected check(): void {
        const now = this.runningNow();
        const finished = finishedThreads(this.running, now);
        const changed = finished.length > 0 || now.size !== this.running.size;
        this.running = now;
        finished.forEach(id => this.finish(id));
        if (changed) {
            this.onDidChangeEmitter.fire();
        }
    }

    protected finish(id: string): void {
        const session = this.store.allSessions.find(s => s.id === id);
        if (!session || this.store.wasStopped(id)) {
            return;
        }
        const state = threadState(session.status, false, userTurns(session));
        const pending = this.tracker.pending(id).filter(c => c.status !== 'streaming').length;
        if (id === this.store.current?.id && document.hasFocus()) {
            return;
        }
        this.unseen.add(id);
        const text = finishMessage(session.title, state, pending);
        const shown = state === 'error' ? this.messages.error(text, THREADS_TEXT.open) : this.messages.info(text, { timeout: THREADS_TOAST_MS }, THREADS_TEXT.open);
        void shown.then(action => {
            if (action === THREADS_TEXT.open) {
                this.open(id);
            }
        });
        this.notifySystem(text, id);
    }

    /** A desktop notification when Ingot is in the background; clicking it brings the thread up. */
    protected notifySystem(text: string, id: string): void {
        if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission === 'denied') {
            return;
        }
        const show = (): void => {
            const note = new Notification(PRODUCT.name, { body: text });
            note.onclick = () => { window.focus(); void this.open(id); };
        };
        if (Notification.permission === 'granted') {
            show();
        } else {
            void Notification.requestPermission().then(permission => { if (permission === 'granted') { show(); } });
        }
    }

    isUnseen(id: string): boolean {
        return this.unseen.has(id);
    }

    /** Selects the thread in the Agents panel and shows the panel. */
    async open(id: string): Promise<void> {
        const session = this.store.allSessions.find(s => s.id === id);
        if (!session) {
            return;
        }
        if (this.store.scope !== undefined && session.project !== this.store.scope) {
            this.store.setScope(session.project);
        }
        this.store.select(id);
        this.unseen.delete(id);
        this.onDidChangeEmitter.fire();
        await this.revealAgents();
    }

    protected async revealAgents(): Promise<void> {
        if (this.shell.getWidgetById(AGENTS_WIDGET_ID)) {
            await this.shell.revealWidget(AGENTS_WIDGET_ID);
        } else {
            await this.commands.executeCommand(AGENT_COMMANDS.toggle.id);
        }
    }

    /** A new chat; with `worktree` it gets its own `ingot/<name>` branch checked out next to the project. */
    async newThread(worktree: boolean): Promise<AgentSession | undefined> {
        await this.revealAgents();
        if (!worktree) {
            await this.commands.executeCommand(AGENT_COMMANDS.newAgent.id);
            return this.store.current;
        }
        const root = this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
        if (!root) {
            this.messages.warn(THREADS_TEXT.noFolder);
            return undefined;
        }
        const session = this.store.create();
        try {
            const made = await this.git.addWorktree(root, worktreeName('', session.id));
            this.store.update(session.id, { worktree: { path: URI.fromFilePath(made.folder).toString(), branch: made.branch } });
            this.messages.info(`${THREADS_TEXT.worktreeMade}: ${made.folder} (${made.branch}).`, { timeout: THREADS_TOAST_MS });
            await this.open(session.id);
            return session;
        } catch (error) {
            this.store.remove(session.id);
            this.messages.error(`${THREADS_TEXT.worktreeFailed}: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
}
