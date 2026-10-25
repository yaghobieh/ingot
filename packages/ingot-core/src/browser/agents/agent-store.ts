import { inject, injectable } from '@theia/core/shared/inversify';
import { IngotModelClient } from '../models/model-client';
import { IngotFeatureFlags } from '../config/feature-flags';
import { UPDATE_TEXT } from '../../common/config/remote-config.consts';
import { chatErrorText, decodeGatewayError, fallsBackToDefault, rateLimitText, refetchesModels, type GatewayError } from '../../common/account/gateway-errors';
import { AGENT_SYSTEM_PROMPTS, AUTO_MODEL_ID, DEFAULT_CONTEXT_WINDOW } from '../../common/models/models.consts';
import { findModel, supportsVision } from '../../common/models/models.utils';
import type { ComposedMessage } from '../../common/agents/composer-parts.types';
import { reorderTabs, tabTitleFromText, togglePinOrder } from '../../common/agents/chat-tabs';
import { BUILD_PROMPT, MAX_SUB_AGENTS, TERMINAL_CONTEXT_LINES, modeInfo } from '../../common/agents/agent-modes';
import { CHATS_STORAGE_KEY, parseChats, serializeChats } from '../../common/agents/chat-history';
import { SUMMARIZE_PROMPT, contextUsage, estimateTokens } from '../../common/agents/context-usage';
import { MEMORY_PROTOCOL, extractMemories, formatMemories, relevantMemories } from '../../common/memories/memories';
import { MemoryStore } from './memory-store';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { postConstruct } from '@theia/core/shared/inversify';
import type { ChatMessage } from '../../common/models/models.types';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { DEFAULT_MODEL, NEW_AGENT_TITLE, NO_MODEL_MESSAGE, SIGN_IN_MESSAGE } from '../../common/agents/agents.consts';
import type { AgentMode, AgentSession } from '../../common/agents/agents.types';
import { activeAgentCount, titleFromPrompt } from '../../common/agents/agents.utils';
import { chipLabel, expandWithChips, type ContextChip } from '../../common/agents/context-chips';
import { AGENT_PROTOCOL, formatContextFiles, parseAgentOutput, parseMentions, type AgentEdit } from '../../common/agents/agent-protocol';
import { isSafeRelativePath } from '../../common/groups/channel.utils';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import URI from '@theia/core/lib/common/uri';
import { ChangeTracker, type ChangeOrigin } from '../changes/change-tracker';
import { restorePlan } from '../../common/changes/changes.utils';
import { ProjectConfigService } from '../project-config/project-config-service';
import { IngotMcpClient } from '../project-config/mcp-client';
import { applicableRules, expandCommand, formatRules } from '../../common/project-config/project-config.utils';
import { MAX_TOOL_ROUNDS } from '../../common/project-config/project-config.consts';
import type { ProjectCommand } from '../../common/project-config/project-config.types';
import { toolProtocol, type AgentToolCall } from '../../common/agents/agent-protocol';

let nextId = 1;
const newChatId = (): string => `chat-${Date.now().toString(36)}-${nextId++}`;

/** Handles slash commands before the prompt reaches a model; returns true when handled (e.g. the group channel). */
export type AgentCommandHandler = (session: AgentSession, prompt: string) => boolean;

/** Chats shown as tabs in the Agents tool window; persisted in local storage, closed chats stay in History (IDEA-77). */
@injectable()
export class AgentStore {

    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    /** Live edit views started while a reply streams, keyed by chat, message and path. */
    protected readonly streamingEdits = new Map<string, Promise<string | undefined>>();
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;
    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(MemoryStore) protected readonly memoryStore: MemoryStore;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    protected persistTimer?: ReturnType<typeof setTimeout>;
    /** Remove the auto-attached open file from the next new chat. */

    @postConstruct()
    protected restore(): void {
        this.items = parseChats(localStorage.getItem(CHATS_STORAGE_KEY));
        this.selected = this.tabs[0]?.id;
    }
    protected readonly running = new Map<string, () => void>();
    /** Project /commands and skills for the composer menu (refreshed by `loadCommands`). */
    projectCommands: readonly ProjectCommand[] = [];

    async loadCommands(): Promise<void> {
        const root = this.current ? this.rootFor(this.current) : this.workspace.tryGetRoots()[0]?.resource;
        this.projectCommands = (await this.projectConfig.load(root)).commands;
        this.changed();
    }

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected items: AgentSession[] = [];
    protected selected?: string;
    protected projectScope?: string;
    protected readonly commandHandlers: AgentCommandHandler[] = [];
    protected defaultMode: AgentMode = 'agent';
    protected defaultModel = DEFAULT_MODEL;

    /** Mode of the current chat (each tab remembers its own); the default for new chats otherwise. */
    get mode(): AgentMode {
        return this.current?.mode ?? this.defaultMode;
    }

    set mode(mode: AgentMode) {
        this.defaultMode = mode;
        if (this.current) {
            this.current.mode = mode;
        }
    }

    get model(): string {
        return this.current?.model ?? this.defaultModel;
    }

    set model(model: string) {
        this.defaultModel = model;
        if (this.current) {
            this.current.model = model;
        }
    }

    /** Open chats in tab order. */
    get tabs(): readonly AgentSession[] {
        const open = this.sessions.filter(s => s.open).sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
        return [...open.filter(s => s.pinned), ...open.filter(s => !s.pinned)];
    }

    /** Drag to reorder (IDEA-98): rewrites the open order; pinned tabs stay in front. */
    moveTab(from: string, to: string): void {
        const tabs = this.tabs;
        const order = reorderTabs(tabs.map(t => t.id), from, to, new Set(tabs.filter(t => t.pinned).map(t => t.id)));
        this.applyOrder(order);
    }

    protected applyOrder(order: readonly string[]): void {
        const base = Math.min(...this.tabs.map(t => t.openedAt ?? 0));
        order.forEach((id, i) => {
            const session = this.items.find(s => s.id === id);
            if (session) {
                session.openedAt = base + i;
            }
        });
        this.changed();
    }

    /** Close Others keeps the given tab and every pinned tab. */
    closeOthers(id: string): void {
        for (const tab of this.tabs) {
            if (tab.id !== id && !tab.pinned) {
                tab.open = false;
            }
        }
        this.selected = id;
        this.changed();
    }

    /** `auto` becomes the first connected recommended model, then any connected model. */
    resolveModel(id: string): string {
        // A remembered BYOK / local model while BYOK is off falls back to Auto (Ingot models), not a "not connected" error.
        // An Ingot model the server removed or cannot run right now falls back to the server default (IDEA-124).
        if (id !== AUTO_MODEL_ID && !this.models.isGatewayModelGone(id) && (this.models.byok || this.models.isModelConfigured(id) || id.startsWith('ingot:'))) {
            return id;
        }
        const fallback = this.models.defaultModel;
        if (fallback && this.models.isModelConfigured(fallback)) {
            return fallback;
        }
        const catalog = this.models.catalog;
        return catalog.find(m => m.recommended && this.models.isModelConfigured(m.id))?.id
            ?? catalog.find(m => this.models.isModelConfigured(m.id))?.id ?? AUTO_MODEL_ID;
    }

    closeTab(id: string): void {
        const tabs = this.tabs;
        const index = tabs.findIndex(t => t.id === id);
        const session = tabs[index];
        if (!session) {
            return;
        }
        session.open = false;
        if (this.selected === id) {
            this.selected = (tabs[index + 1] ?? tabs[index - 1])?.id;
        }
        this.changed();
    }

    /** Opens a chat from History as a tab. */
    reopen(id: string): void {
        const session = this.items.find(s => s.id === id);
        if (session) {
            if (!session.open) {
                session.open = true;
                session.openedAt = Date.now();
            }
            this.selected = id;
            this.changed();
        }
    }

    rename(id: string, title: string): void {
        const session = this.items.find(s => s.id === id);
        if (session && title.trim()) {
            session.title = title.trim().slice(0, 80);
            this.changed();
        }
    }

    togglePin(id: string): void {
        const session = this.items.find(s => s.id === id);
        if (session) {
            const tabs = this.tabs;
            const order = togglePinOrder(tabs.map(t => t.id), new Set(tabs.filter(t => t.pinned).map(t => t.id)), id);
            session.pinned = !session.pinned;
            this.applyOrder(order);
        }
    }

    remove(id: string): void {
        if (this.running.has(id)) {
            this.stop(id);
        }
        const wasSelected = this.selected === id;
        if (wasSelected) {
            this.closeTab(id);
        }
        this.items = this.items.filter(s => s.id !== id);
        this.changed();
    }

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
            id: newChatId(), title, status: 'idle', updatedAt: Date.now(), mode: this.mode, model: this.model,
            messages: [], plan: [], steps: [], changes: [], project: this.projectScope, open: true, openedAt: Date.now()
        };
        this.items = [session, ...this.items];
        this.selected = session.id;
        this.changed();
        return session;
    }

    select(id: string): void {
        this.reopen(id);
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
            id: newChatId(), title, status: 'idle', updatedAt: Date.now(), mode: this.mode, model: this.model,
            messages: [], plan: [], steps: [], changes: [], project, open: true, openedAt: Date.now()
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
    send(prompt: string, chips: readonly ContextChip[] = [], composed?: ComposedMessage): AgentSession {
        const session = this.current ?? this.create();
        if (session.title === NEW_AGENT_TITLE) {
            session.title = tabTitleFromText(prompt) || titleFromPrompt(prompt);
        }
        session.mode = this.mode;
        session.model = this.model;
        if (composed && (composed.chips.length || composed.images.length)) {
            // Inline composer (IDEA-98): chips and images stay where the user put them.
            session.messages.push({
                role: 'user', text: composed.text, expanded: composed.expanded, parts: composed.parts,
                ...(composed.images.length ? { images: composed.images } : {}),
                chips: composed.chips.map(c => ({ label: chipLabel(c), path: c.path }))
            });
        } else {
            session.messages.push(chips.length
                ? { role: 'user', text: prompt.trim(), expanded: expandWithChips(prompt.trim(), chips), chips: chips.map(c => ({ label: chipLabel(c), path: c.path })) }
                : { role: 'user', text: prompt.trim() });
        }
        if (this.commandHandlers.some(handle => handle(session, prompt.trim()))) {
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        if (this.flags.forceUpdate) {
            session.messages.push({ role: 'system', text: UPDATE_TEXT.chatBlocked });
            session.status = 'idle';
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        if (session.model !== AUTO_MODEL_ID && this.models.isGatewayModelGone(session.model)) {
            const replacement = this.resolveModel(session.model);
            if (replacement !== AUTO_MODEL_ID && replacement !== session.model) {
                session.messages.push({ role: 'system', text: `${this.models.label(session.model)} is not available right now. Using ${this.models.label(replacement)}.` });
                session.model = replacement;
            }
        }
        if (!this.models.isModelConfigured(this.resolveModel(session.model))) {
            const resolved = this.resolveModel(session.model);
            const needsAccount = !this.models.isProviderConfigured('ingot') && (resolved === AUTO_MODEL_ID || resolved.startsWith('ingot:') || !this.models.byok);
            session.messages.push({ role: 'system', text: needsAccount ? SIGN_IN_MESSAGE : NO_MODEL_MESSAGE });
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
        this.running.delete(id);
        this.changed();
    }

    /** Root the agent works in: its project (groups) or the first workspace root. */
    protected rootFor(session: AgentSession): URI | undefined {
        if (session.project) {
            return new URI(session.project);
        }
        const root = this.workspace.tryGetRoots()[0];
        return root?.resource;
    }

    protected async readContext(session: AgentSession, prompt: string, root: URI | undefined): Promise<{ text: string; paths: string[] }> {
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
        if (root) {
            for (const mention of parseMentions(prompt).filter(isSafeRelativePath)) {
                await add(root.resolve(mention));
            }
        }
        let text = files.length ? `Project files for context:\n\n${formatContextFiles(files)}` : '';
        if (session.mode === 'debug') {
            const output = this.terminalOutput();
            if (output) {
                text += `${text ? '\n\n' : ''}Recent terminal output:\n\`\`\`\n${output}\n\`\`\``;
            }
        }
        return { text, paths: files.map(f => f.path) };
    }

    /** Last lines of the most recently used terminal (Debug mode). */
    protected terminalOutput(): string {
        const terminal = this.terminals.lastUsedTerminal ?? this.terminals.currentTerminal;
        try {
            const buffer = terminal?.buffer;
            if (!buffer || !buffer.length) {
                return '';
            }
            const start = Math.max(0, buffer.length - TERMINAL_CONTEXT_LINES);
            return buffer.getLines(start, buffer.length - start, true).join('\n').trim();
        } catch {
            return '';
        }
    }

    protected historyFor(session: AgentSession): ChatMessage[] {
        return session.messages
            .filter(m => m.role !== 'system' && (m.role !== 'agent' || m.text))
            .map(m => {
                if (m.role === 'agent') {
                    return { role: 'assistant' as const, content: m.expanded ?? m.text };
                }
                if (m.role === 'peer') {
                    return { role: 'user' as const, content: `${m.from}: ${m.text}` };
                }
                if (m.role === 'tool') {
                    return { role: 'user' as const, content: `Tool result (${m.from}):\n${m.expanded ?? m.text}` };
                }
                return this.userMessage(session, m);
            });
    }

    /** A user turn for the model; images become image parts when the model can read them (IDEA-98). */
    protected userMessage(session: AgentSession, m: AgentSession['messages'][number]): ChatMessage {
        const content = m.expanded ?? m.text;
        const images = (m.images ?? []).filter(i => i.data);
        if (!images.length) {
            return { role: 'user', content };
        }
        const model = findModel(this.resolveModel(session.model));
        if (!model || !supportsVision(model.provider)) {
            return { role: 'user', content: `${content}\n\n(${images.length} image(s) attached, but the selected model cannot read images.)` };
        }
        return { role: 'user', content, images: images.map(i => ({ mediaType: i.mediaType, data: i.data })) };
    }

    /**
     * Streams the conversation from the selected model with project rules, context files and MCP tools.
     * Tool calls run and feed back for up to MAX_TOOL_ROUNDS rounds; in Agent mode, edits open in the inline review.
     */
    protected async runModel(session: AgentSession): Promise<void> {
        const root = this.rootFor(session);
        const config = await this.projectConfig.load(root);
        this.projectCommands = config.commands;
        const lastUser = session.messages.map((m, i) => ({ m, i })).reverse().find(x => x.m.role === 'user');
        if (lastUser && lastUser.m.text.startsWith('/')) {
            const expansion = expandCommand(lastUser.m.text, config.commands);
            if (expansion) {
                session.messages[lastUser.i] = { ...lastUser.m, expanded: lastUser.m.expanded ? lastUser.m.expanded.replace(lastUser.m.text, expansion.text) : expansion.text };
                session.steps = [{ kind: 'run', target: `/${expansion.command.name}`, done: true }];
            }
        }
        const prompt = lastUser ? (session.messages[lastUser.i].expanded ?? lastUser.m.text) : '';
        const context = await this.readContext(session, prompt, root);
        // Glob rules still match the file open in the editor; its content is not attached (the agent reads files via tools).
        const active = this.editors.currentEditor?.editor.uri;
        const activePath = active && root?.isEqualOrParent(active) ? root.relative(active)?.toString() : undefined;
        const rules = applicableRules(config.rules, activePath ? [...context.paths, activePath] : context.paths);
        const info = modeInfo(session.mode);
        const tools = info.canUseTools ? this.mcp.connectedTools : [];
        const memories = relevantMemories(await this.memoryStore.load(root).catch(() => []), prompt);
        const base = [AGENT_SYSTEM_PROMPTS[session.mode], info.canEdit ? AGENT_PROTOCOL : '', toolProtocol(tools), this.memoryStore.generate ? MEMORY_PROTOCOL : ''].filter(Boolean).join('\n\n');
        const rulesText = formatRules(rules);
        const memoriesText = formatMemories(memories);
        const system = [base, rulesText, memoriesText, context.text].filter(Boolean).join('\n\n');
        const model = findModel(this.resolveModel(session.model));
        session.context = {
            files: context.paths, rules: rules.map(r => r.name), memories: memories.map(m => ({ id: m.id, text: m.text })),
            usage: contextUsage({
                system: estimateTokens(base), rules: estimateTokens(rulesText), files: estimateTokens(context.text), memories: estimateTokens(memoriesText),
                history: estimateTokens(this.historyFor(session).map(m => m.content).join('\n'))
            }, model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW)
        };
        // Rules and memories apply silently: they show in the collapsible "Read rules" step, never as chips (IDEA-100).
        session.steps = [
            ...(session.steps.filter(s => s.kind === 'run' && s.target.startsWith('/'))),
            ...(context.paths.length ? [{ kind: 'read' as const, target: context.paths.join(', '), done: true }] : []),
            ...(rules.length ? [{ kind: 'read' as const, target: `rules: ${rules.map(r => r.name).join(', ')}`, done: true }] : [])
        ];
        session.changes = [];
        this.changed();

        for (let round = 0; ; round++) {
            const parsed = await this.streamRound(session, system);
            if (!parsed) {
                return;
            }
            if (parsed.toolCalls.length && round < MAX_TOOL_ROUNDS) {
                await this.runTools(session, parsed.toolCalls);
                continue;
            }
            await this.saveMemories(session, parsed.memories, root);
            if (info.canEdit && parsed.edits.length) {
                await this.applyEdits(session, parsed.edits, root);
            } else if (session.mode === 'multi' && parsed.plan.length) {
                this.spawnSubAgents(session, parsed.plan, prompt);
            } else {
                if (!info.canEdit && parsed.edits.length) {
                    session.messages.push({ role: 'system', text: `${info.label} mode does not change files; switch to Agent to apply edits.` });
                }
                session.plan = session.plan.map(p => ({ ...p, state: session.mode === 'plan' ? 'todo' : 'done' }));
                if (session.mode === 'plan' && session.plan.length) {
                    const last = session.messages.map(m => m.role).lastIndexOf('agent');
                    if (last >= 0) {
                        session.messages[last] = { ...session.messages[last], buildable: true };
                    }
                }
                session.status = 'idle';
            }
            session.activeFile = undefined;
            session.updatedAt = Date.now();
            this.changed();
            return;
        }
    }

    /** One streamed model reply; returns the parsed output, or undefined after an error. */
    protected async streamRound(session: AgentSession, system: string, retried = false): Promise<(ReturnType<typeof parseAgentOutput> & { memories: string[] }) | undefined> {
        const history = this.historyFor(session);
        const index = session.messages.push({ role: 'agent', text: '' }) - 1;
        session.status = 'thinking';
        this.changed();
        let final = '';
        try {
            const stream = this.models.stream(this.resolveModel(session.model), [{ role: 'system', content: system }, ...history], text => {
                const parsed = parseAgentOutput(text);
                this.streamEdit(session, index, parsed.editing, parsed.editingContent);
                session.messages[index] = { role: 'agent', text: extractMemories(parsed.display).display };
                if (parsed.plan.length) {
                    session.plan = parsed.plan.map((t, i) => ({ text: t, state: i === 0 ? 'active' : 'todo' }));
                }
                session.status = parsed.editing ? 'editing' : 'thinking';
                session.activeFile = parsed.editing ?? parsed.edits[parsed.edits.length - 1]?.path;
                session.updatedAt = Date.now();
                this.changed();
            });
            this.running.set(session.id, stream.cancel);
            final = await stream.done;
        } catch (error) {
            await this.tracker.cancelStreams(session.id);
            const gateway = decodeGatewayError(error instanceof Error ? error.message : String(error));
            if (gateway) {
                return this.gatewayFailure(session, system, index, gateway, retried);
            }
            session.messages.push({ role: 'system', text: `The model request failed: ${error instanceof Error ? error.message : String(error)}` });
            session.status = 'error';
            this.running.delete(session.id);
            session.updatedAt = Date.now();
            this.changed();
            return undefined;
        }
        const stopped = !this.running.has(session.id);
        this.running.delete(session.id);
        if (stopped) {
            await this.tracker.cancelStreams(session.id);
        }
        const parsed = parseAgentOutput(final);
        const { display, memories } = extractMemories(parsed.display);
        // Keep the raw reply for the model (so it sees its own tool calls), show the clean text.
        session.messages[index] = {
            role: 'agent', expanded: final,
            text: display || (parsed.edits.length ? `Proposed changes to ${parsed.edits.length} file(s).` : parsed.toolCalls.length ? 'Calling tools…' : '(empty reply)')
        };
        return stopped ? { ...parsed, toolCalls: [], edits: [], memories: [] } : { ...parsed, memories };
    }

    protected async runTools(session: AgentSession, calls: readonly AgentToolCall[]): Promise<void> {
        for (const call of calls) {
            const target = `${call.server}/${call.tool}`;
            session.steps = [...session.steps, { kind: 'run', target, done: false }];
            session.status = 'thinking';
            this.changed();
            const result = await this.mcp.callTool(call.server, call.tool, call.args);
            session.steps = session.steps.map(s => s.kind === 'run' && s.target === target && !s.done ? { ...s, done: true } : s);
            session.messages.push({ role: 'tool', from: target, text: `${result.isError ? 'Error: ' : ''}${result.text}` });
            this.changed();
        }
    }

    /** Where an agent message's edits come from (its chat, itself, and the user message it answers). */
    protected originOf(session: AgentSession, messageIndex: number): ChangeOrigin {
        const userIndex = session.messages.slice(0, messageIndex + 1).map(m => m.role).lastIndexOf('user');
        return { sessionId: session.id, messageIndex, userIndex: Math.max(0, userIndex) };
    }

    /** Live editor view while an edit block streams (IDEA-102): the file fills in as the model types. */
    protected streamEdit(session: AgentSession, messageIndex: number, path: string | undefined, content: string | undefined): void {
        const root = this.rootFor(session);
        if (!path || content === undefined || !root || !modeInfo(session.mode).canEdit || !isSafeRelativePath(path)) {
            return;
        }
        const key = `${session.id}\u0000${messageIndex}\u0000${path}`;
        let started = this.streamingEdits.get(key);
        if (!started) {
            started = this.tracker.beginStream(this.originOf(session, messageIndex), path, root.resolve(path)).catch(() => undefined);
            this.streamingEdits.set(key, started);
        }
        started.then(id => id && this.tracker.stream(id, content));
    }

    /**
     * Applies every edit at once and shows each as a code-change block (IDEA-102); hunks wait for Accept / Reject in
     * the editor and the chat, and the agent is free for the next message meanwhile.
     */
    protected async applyEdits(session: AgentSession, edits: readonly AgentEdit[], root: URI | undefined): Promise<void> {
        session.plan = session.plan.map(p => ({ ...p, state: 'done' }));
        const messageIndex = session.messages.map(m => m.role).lastIndexOf('agent');
        const origin = this.originOf(session, messageIndex);
        const ids: string[] = [];
        for (const edit of edits) {
            if (!root || !isSafeRelativePath(edit.path)) {
                session.messages.push({ role: 'system', text: `Skipped an edit to "${edit.path}": agents can only change files inside the project.` });
                continue;
            }
            // Wait for the live view of this file (if it streamed) so the final text lands on the same change.
            await this.streamingEdits.get(`${session.id}\u0000${messageIndex}\u0000${edit.path}`);
            const change = await this.tracker.finalize(origin, edit.path, root.resolve(edit.path), edit.content);
            const stats = this.tracker.stats(change);
            session.steps = [...session.steps, { kind: 'edit', target: edit.path, done: true, added: stats.added, removed: stats.removed }];
            ids.push(change.id);
            this.changed();
        }
        [...this.streamingEdits.keys()].filter(k => k.startsWith(`${session.id}\u0000`)).forEach(k => this.streamingEdits.delete(k));
        session.status = ids.some(id => this.tracker.pending().some(c => c.id === id)) ? 'review' : 'done';
        this.whenReviewed(session, ids, edits.length);
    }

    /** Once every hunk of a run is decided: "Review finished: n of m change(s) kept." and the chat is done. */
    protected whenReviewed(session: AgentSession, ids: readonly string[], total: number): void {
        const check = (): boolean => {
            const changes = ids.map(id => this.tracker.find(id)).filter(c => !!c);
            if (changes.some(c => c.status === 'applied' || c.status === 'streaming')) {
                return false;
            }
            const kept = changes.filter(c => c.status === 'accepted' || c.status === 'partial');
            session.changes = [...session.changes, ...kept.map(c => ({ uri: c.uri, label: c.path, ...this.tracker.stats(c) }))];
            if (changes.length) {
                session.messages.push({ role: 'system', text: `Review finished: ${kept.length} of ${total} change(s) kept.` });
            }
            if (session.status === 'review') {
                session.status = kept.length ? 'done' : 'idle';
            }
            session.updatedAt = Date.now();
            this.changed();
            return true;
        };
        if (check()) {
            return;
        }
        const listener = this.tracker.onDidChange(() => {
            if (check()) {
                listener.dispose();
            }
        });
    }

    /** Checkpoint for "Revert to here" exists from this message on (IDEA-102). */
    canRevertTo(sessionId: string, index: number): boolean {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        return !!message && this.tracker.hasCheckpointFrom(sessionId, message.role === 'user' ? index : index + 1);
    }

    /**
     * "Revert to here": a user message goes back to just before it ran, any other message to just after it.
     * Files the agent touched later are restored (created files removed) and later messages are dropped.
     */
    async revertTo(sessionId: string, index: number): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        if (!session || !message) {
            return;
        }
        this.stop(sessionId);
        const from = message.role === 'user' ? index : index + 1;
        await this.tracker.revertTo(sessionId, from, restorePlan(this.tracker.checkpoints, sessionId, from));
        session.messages = session.messages.slice(0, index + 1);
        session.steps = [];
        session.plan = [];
        session.changes = session.changes.filter(c => this.tracker.changes.some(t => t.uri === c.uri && t.sessionId === sessionId));
        session.status = 'idle';
        session.updatedAt = Date.now();
        this.changed();
    }

    /** Saves facts the model marked with REMEMBER: (when Generate memories is on) and shows them with Undo. */
    protected async saveMemories(session: AgentSession, facts: readonly string[], root: URI | undefined): Promise<void> {
        if (!facts.length || !this.memoryStore.generate) {
            return;
        }
        for (const fact of facts) {
            const scope = root ? 'project' : 'global';
            const memory = await this.memoryStore.save(scope, fact, root).catch(() => undefined);
            if (memory) {
                session.messages.push({ role: 'system', text: memory.text, memory: { id: memory.id, scope: memory.scope } });
            }
        }
        this.changed();
    }

    async undoMemory(sessionId: string, index: number): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        if (!session || !message?.memory || message.memory.undone) {
            return;
        }
        await this.memoryStore.remove(message.memory, this.rootFor(session));
        session.messages[index] = { ...message, memory: { ...message.memory, undone: true } };
        this.changed();
    }

    /** Plan mode: Build runs the plan in Agent mode in the same chat. */
    build(sessionId: string): void {
        const session = this.items.find(s => s.id === sessionId);
        if (!session) {
            return;
        }
        this.selected = session.id;
        session.mode = 'agent';
        session.messages = session.messages.map(m => m.buildable ? { ...m, buildable: false } : m);
        this.send(BUILD_PROMPT);
    }

    /** Multi-agent: one Agent-mode chat per subtask, run in parallel in their own tabs; the lead chat reports progress. */
    protected spawnSubAgents(lead: AgentSession, plan: readonly string[], goal: string): void {
        const subtasks = plan.slice(0, MAX_SUB_AGENTS);
        const children = subtasks.map((task, i) => {
            const child: AgentSession = {
                id: newChatId(), title: titleFromPrompt(task), status: 'thinking', updatedAt: Date.now(), mode: 'agent', model: lead.model,
                messages: [{ role: 'user', text: task, expanded: `${task}\n\nThis is subtask ${i + 1} of ${subtasks.length} for: ${goal}\nOnly do this subtask.` }],
                plan: [], steps: [], changes: [], project: lead.project, open: true, openedAt: Date.now() + i + 1, parent: lead.id
            };
            return child;
        });
        this.items = [...children, ...this.items];
        lead.plan = subtasks.map(t => ({ text: t, state: 'active' }));
        lead.messages.push({ role: 'system', text: `Started ${children.length} sub-agents in parallel: ${children.map(c => c.title).join(' · ')}` });
        lead.status = 'thinking';
        this.changed();
        Promise.all(children.map(async (child, i) => {
            await this.runModel(child).catch(() => { child.status = 'error'; });
            lead.plan = lead.plan.map((p, j) => j === i ? { ...p, state: 'done' } : p);
            this.changed();
        })).then(() => {
            const lines = children.map(c => `• ${c.title}: ${c.status === 'error' ? 'needs attention' : c.changes.length ? `${c.changes.length} file(s) changed` : 'answered'}`);
            lead.messages.push({ role: 'agent', text: `All sub-agents finished.\n${lines.join('\n')}` });
            lead.status = children.some(c => c.changes.length) ? 'done' : 'idle';
            lead.updatedAt = Date.now();
            this.changed();
        });
    }

    /**
     * Ingot gateway errors (IDEA-124, contract §2): 429 waits out Retry-After with a countdown and retries once;
     * model_* errors re-fetch the list and switch to the default; 402 and the rest stop with the server's message.
     */
    protected async gatewayFailure(session: AgentSession, system: string, index: number, error: GatewayError, retried: boolean): Promise<ReturnType<AgentStore['streamRound']>> {
        if (!session.messages[index]?.text) {
            session.messages.splice(index, 1);
        }
        this.running.delete(session.id);
        if (error.kind === 'rate_limited' && !retried && error.retryAfterSeconds) {
            if (await this.countdown(session, error, error.retryAfterSeconds)) {
                return this.streamRound(session, system, true);
            }
            return undefined;
        }
        let fallback: string | undefined;
        if (refetchesModels(error)) {
            await this.models.refreshModels().catch(() => undefined);
            if (fallsBackToDefault(error)) {
                const replacement = this.resolveModel(AUTO_MODEL_ID);
                if (replacement !== AUTO_MODEL_ID && replacement !== session.model) {
                    session.model = replacement;
                    fallback = this.models.label(replacement);
                }
            }
        }
        session.messages.push({ role: 'system', text: chatErrorText(error, { portalUrl: this.models.portalUrl, fallback }) });
        session.status = error.kind === 'blocked' ? 'idle' : 'error';
        session.updatedAt = Date.now();
        this.changed();
        return undefined;
    }

    /** Shows "Retrying in m:ss" and resolves true when the wait finished (false when the user pressed Stop). */
    protected countdown(session: AgentSession, error: GatewayError, seconds: number): Promise<boolean> {
        const at = session.messages.push({ role: 'system', text: rateLimitText(error, seconds) }) - 1;
        session.status = 'thinking';
        this.changed();
        return new Promise(resolve => {
            let left = seconds;
            const timer = setInterval(() => {
                left -= 1;
                if (left > 0) {
                    session.messages[at] = { role: 'system', text: rateLimitText(error, left) };
                    this.changed();
                    return;
                }
                clearInterval(timer);
                this.running.delete(session.id);
                session.messages.splice(at, 1);
                resolve(true);
            }, 1000);
            this.running.set(session.id, () => {
                clearInterval(timer);
                session.messages[at] = { role: 'system', text: `${error.message} Stopped.` };
                session.status = 'idle';
                this.changed();
                resolve(false);
            });
        });
    }

    /** A summary of a chat for continuing it with less context (model summary, or the last requests as a fallback). */
    protected async summaryOf(session: AgentSession): Promise<string> {
        const model = this.resolveModel(session.model);
        let summary = '';
        if (this.models.isModelConfigured(model)) {
            session.status = 'thinking';
            this.changed();
            try {
                summary = await this.models.stream(model, [...this.historyFor(session), { role: 'user', content: SUMMARIZE_PROMPT }], () => undefined).done;
            } catch {
                summary = '';
            }
            session.status = 'idle';
        }
        if (!summary.trim()) {
            summary = session.messages.filter(m => m.role === 'user').slice(-6).map(m => `- ${m.text}`).join('\n');
        }
        return summary.trim();
    }

    /** Starts a new chat seeded with a summary of this one (context nearly full). */
    async summarizeAndContinue(sessionId: string): Promise<AgentSession | undefined> {
        const session = this.items.find(s => s.id === sessionId);
        if (!session) {
            return undefined;
        }
        const summary = await this.summaryOf(session);
        const next = this.create(`${session.title} (continued)`);
        next.mode = session.mode;
        next.model = session.model;
        next.messages.push({ role: 'agent', text: `Summary of “${session.title}”:\n${summary}` });
        this.closeTab(session.id);
        this.selected = next.id;
        this.changed();
        return next;
    }

    /** Compacts a chat in place (IDEA-98): its history becomes one summary message, freeing the context window. */
    async compact(sessionId: string): Promise<AgentSession | undefined> {
        const session = this.items.find(s => s.id === sessionId);
        if (!session || !session.messages.length) {
            return session;
        }
        const summary = await this.summaryOf(session);
        session.messages.splice(0, session.messages.length, { role: 'agent', text: `Conversation compacted. Summary so far:\n${summary}` });
        session.steps = [];
        if (session.context) {
            const history = estimateTokens(summary);
            session.context = { ...session.context, usage: session.context.usage && contextUsage({ ...session.context.usage, history }, session.context.usage.window) };
        }
        this.changed();
        return session;
    }

    changed(): void {
        this.onDidChangeEmitter.fire();
        clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => localStorage.setItem(CHATS_STORAGE_KEY, serializeChats(this.items)), 300);
    }
}
