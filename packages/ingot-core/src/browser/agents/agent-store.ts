import { injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { DEFAULT_MODEL, NEW_AGENT_TITLE, NO_MODEL_MESSAGE } from '../../common/agents/agents.consts';
import type { AgentMode, AgentSession } from '../../common/agents/agents.types';
import { activeAgentCount, titleFromPrompt } from '../../common/agents/agents.utils';

let nextId = 1;

/** In-memory agent sessions shown in the Agents tool window (the runtime arrives with IDEA-27/28). */
@injectable()
export class AgentStore {

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected items: AgentSession[] = [];
    protected selected?: string;
    protected projectScope?: string;
    mode: AgentMode = 'agent';
    model = DEFAULT_MODEL;

    /** Sessions of the active project tab (all sessions outside project groups). */
    get sessions(): readonly AgentSession[] {
        return this.projectScope ? this.items.filter(s => s.project === this.projectScope) : this.items;
    }

    get allSessions(): readonly AgentSession[] {
        return this.items;
    }

    get current(): AgentSession | undefined {
        return this.sessions.find(s => s.id === this.selected);
    }

    get activeCount(): number {
        return activeAgentCount(this.items);
    }

    get scope(): string | undefined {
        return this.projectScope;
    }

    /** Shows only the agents of one project (project groups); `undefined` shows all. */
    setScope(project: string | undefined): void {
        if (this.projectScope === project) {
            return;
        }
        this.projectScope = project;
        this.selected = this.sessions[0]?.id;
        this.changed();
    }

    create(title = NEW_AGENT_TITLE): AgentSession {
        const session: AgentSession = {
            id: `agent-${nextId++}`, title, status: 'idle', updatedAt: Date.now(), mode: this.mode, model: this.model,
            messages: [], plan: [], steps: [], changes: [], project: this.projectScope
        };
        this.items = [session, ...this.items];
        this.selected = session.id;
        this.changed();
        return session;
    }

    select(id: string): void {
        this.selected = id;
        this.changed();
    }

    update(id: string, patch: Partial<AgentSession>): void {
        const session = this.items.find(s => s.id === id);
        if (session) {
            Object.assign(session, patch, { updatedAt: Date.now() });
            this.changed();
        }
    }

    /** Sends a prompt. Without a connected model the agent explains how to connect one instead of pretending. */
    send(prompt: string): AgentSession {
        const session = this.current ?? this.create();
        if (session.title === NEW_AGENT_TITLE) {
            session.title = titleFromPrompt(prompt);
        }
        session.mode = this.mode;
        session.model = this.model;
        session.messages.push({ role: 'user', text: prompt.trim() });
        session.messages.push({ role: 'system', text: NO_MODEL_MESSAGE });
        session.status = 'idle';
        session.updatedAt = Date.now();
        this.changed();
        return session;
    }

    changed(): void {
        this.onDidChangeEmitter.fire();
    }
}
