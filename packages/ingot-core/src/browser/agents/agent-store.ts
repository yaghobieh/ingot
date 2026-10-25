import { inject, injectable } from '@theia/core/shared/inversify';
import { IngotModelClient } from '../models/model-client';
import { AGENT_SYSTEM_PROMPTS } from '../../common/models/models.consts';
import type { ChatMessage } from '../../common/models/models.types';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { DEFAULT_MODEL, NEW_AGENT_TITLE, NO_MODEL_MESSAGE } from '../../common/agents/agents.consts';
import type { AgentMode, AgentSession } from '../../common/agents/agents.types';
import { activeAgentCount, titleFromPrompt } from '../../common/agents/agents.utils';
import { AGENT_PROTOCOL, formatContextFiles, parseAgentOutput, parseMentions, type AgentEdit } from '../../common/agents/agent-protocol';
import { isSafeRelativePath } from '../../common/groups/channel.utils';
import { lineDiff, diffStats } from '../../common/diff/diff.utils';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import URI from '@theia/core/lib/common/uri';
import { AgentEditReview } from './agent-edit-review';

let nextId = 1;

/** Handles slash commands before the prompt reaches a model; returns true when handled (e.g. the group channel). */
export type AgentCommandHandler = (session: AgentSession, prompt: string) => boolean;

/** In-memory agent sessions shown in the Agents tool window (the runtime arrives with IDEA-27/28). */
@injectable()
export class AgentStore {

    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(AgentEditReview) protected readonly review: AgentEditReview;
    protected readonly running = new Map<string, () => void>();

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected items: AgentSession[] = [];
    protected selected?: string;
    protected projectScope?: string;
    protected readonly commandHandlers: AgentCommandHandler[] = [];
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

    registerCommandHandler(handler: AgentCommandHandler): void {
        this.commandHandlers.push(handler);
    }

    /** Most recent session of a project, created on demand (used to deliver group channel messages). */
    sessionFor(project: string, title: string): AgentSession {
        const existing = this.items.find(s => s.project === project && s.status !== 'done');
        if (existing) {
            return existing;
        }
        const session: AgentSession = {
            id: `agent-${nextId++}`, title, status: 'idle', updatedAt: Date.now(), mode: this.mode, model: this.model,
            messages: [], plan: [], steps: [], changes: [], project
        };
        this.items = [session, ...this.items];
        if (this.projectScope === project && !this.selected) {
            this.selected = session.id;
        }
        return session;
    }

    addMessage(session: AgentSession, message: AgentSession['messages'][number]): void {
        session.messages.push(message);
        session.updatedAt = Date.now();
        this.changed();
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
        if (this.commandHandlers.some(handle => handle(session, prompt.trim()))) {
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        if (!this.models.isModelConfigured(session.model)) {
            session.messages.push({ role: 'system', text: NO_MODEL_MESSAGE });
            session.status = 'idle';
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        session.status = 'thinking';
        session.updatedAt = Date.now();
        this.changed();
        this.runModel(session);
        return session;
    }

    isRunning(id: string | undefined): boolean {
        return !!id && this.running.has(id);
    }

    /** Stops a streaming agent (Stop button / Escape). */
    stop(id: string): void {
        this.running.get(id)?.();
    }

    /** Root the agent works in: its project (groups) or the first workspace root. */
    protected rootFor(session: AgentSession): URI | undefined {
        if (session.project) {
            return new URI(session.project);
        }
        const root = this.workspace.tryGetRoots()[0];
        return root?.resource;
    }

    protected async readContext(session: AgentSession, prompt: string, root: URI | undefined): Promise<string> {
        const files: { path: string; content: string }[] = [];
        const seen = new Set<string>();
        const add = async (uri: URI): Promise<void> => {
            const key = uri.toString();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            try {
                const content = (await this.files.read(uri)).value;
                files.push({ path: root ? root.relative(uri)?.toString() ?? uri.path.base : uri.path.base, content });
            } catch {
                // unreadable (binary, missing): skip
            }
        };
        const active = this.editors.currentEditor?.editor.uri;
        if (active && (!root || root.isEqualOrParent(active))) {
            await add(active);
        }
        if (root) {
            for (const mention of parseMentions(prompt).filter(isSafeRelativePath)) {
                await add(root.resolve(mention));
            }
        }
        return files.length ? `Project files for context:\n\n${formatContextFiles(files)}` : '';
    }

    /** Streams the conversation from the selected model; in Agent mode, proposed edits open in the inline review. */
    protected async runModel(session: AgentSession): Promise<void> {
        const root = this.rootFor(session);
        const prompt = [...session.messages].reverse().find(m => m.role === 'user')?.text ?? '';
        const history: ChatMessage[] = session.messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role === 'agent' ? 'assistant' as const : 'user' as const, content: m.role === 'peer' ? `${m.from}: ${m.text}` : m.text }));
        const context = await this.readContext(session, prompt, root);
        const system = [AGENT_SYSTEM_PROMPTS[session.mode], session.mode === 'agent' ? AGENT_PROTOCOL : '', context].filter(Boolean).join('\n\n');
        const index = session.messages.push({ role: 'agent', text: '' }) - 1;
        session.steps = context ? [{ kind: 'read', target: 'context', done: true }] : [];
        session.changes = [];
        let final = '';
        try {
            const stream = this.models.stream(session.model, [{ role: 'system', content: system }, ...history], text => {
                const parsed = parseAgentOutput(text);
                session.messages[index] = { role: 'agent', text: parsed.display };
                session.plan = parsed.plan.map((t, i) => ({ text: t, state: i === 0 ? 'active' : 'todo' }));
                session.status = parsed.editing ? 'editing' : 'thinking';
                session.activeFile = parsed.editing ?? parsed.edits[parsed.edits.length - 1]?.path;
                session.updatedAt = Date.now();
                this.changed();
            });
            this.running.set(session.id, stream.cancel);
            final = await stream.done;
        } catch (error) {
            session.messages.push({ role: 'system', text: `The model request failed: ${error instanceof Error ? error.message : String(error)}` });
            session.status = 'error';
            this.running.delete(session.id);
            session.updatedAt = Date.now();
            this.changed();
            return;
        }
        this.running.delete(session.id);
        const parsed = parseAgentOutput(final);
        session.messages[index] = { role: 'agent', text: parsed.display || (parsed.edits.length ? `Proposed changes to ${parsed.edits.length} file(s).` : '(empty reply)') };
        if (session.mode === 'agent' && parsed.edits.length) {
            await this.applyEdits(session, parsed.edits, root);
        } else {
            session.plan = session.plan.map(p => ({ ...p, state: session.mode === 'plan' ? 'todo' : 'done' }));
            session.status = 'idle';
        }
        session.activeFile = undefined;
        session.updatedAt = Date.now();
        this.changed();
    }

    /** Opens each edit in the inline review, one after another; accepted edits are saved to disk. */
    protected async applyEdits(session: AgentSession, edits: readonly AgentEdit[], root: URI | undefined): Promise<void> {
        session.status = 'review';
        session.plan = session.plan.map(p => ({ ...p, state: 'done' }));
        this.changed();
        let accepted = 0;
        for (const edit of edits) {
            if (!root || !isSafeRelativePath(edit.path)) {
                session.messages.push({ role: 'system', text: `Skipped an edit to "${edit.path}": agents can only change files inside the project.` });
                continue;
            }
            const uri = root.resolve(edit.path);
            let created = false;
            let oldText = '';
            if (await this.files.exists(uri)) {
                oldText = (await this.files.read(uri)).value;
            } else {
                await this.files.create(uri, '');
                created = true;
            }
            const stats = diffStats(lineDiff(oldText, edit.content));
            session.steps = [...session.steps, { kind: 'edit', target: edit.path, done: false, added: stats.added, removed: stats.removed }];
            session.activeFile = edit.path;
            this.changed();
            const outcome = await this.review.review(uri, edit.content);
            session.steps = session.steps.map(s => s.kind === 'edit' && s.target === edit.path ? { ...s, done: true } : s);
            if (outcome.accepted) {
                accepted++;
                session.changes = [...session.changes, { uri: uri.toString(), label: edit.path, added: stats.added, removed: stats.removed }];
            } else if (created) {
                await this.files.delete(uri).catch(() => undefined);
            }
            this.changed();
        }
        session.messages.push({ role: 'system', text: `Review finished: ${accepted} of ${edits.length} change(s) kept.` });
        session.status = accepted ? 'done' : 'idle';
    }

    changed(): void {
        this.onDidChangeEmitter.fire();
    }
}
