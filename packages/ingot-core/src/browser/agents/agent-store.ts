import { inject, injectable } from '@theia/core/shared/inversify';
import { IngotModelClient } from '../models/model-client';
import { IngotFeatureFlags } from '../config/feature-flags';
import { UPDATE_TEXT } from '../../common/config/remote-config.consts';
import { chatErrorText, decodeGatewayError, fallsBackToDefault, rateLimitText, refetchesModels, UPGRADE_ACTION, UPGRADE_DISMISS, upgradePromptText, type GatewayError } from '../../common/account/gateway-errors';
import { MessageService } from '@theia/core/lib/common/message-service';
import { IngotAccountService } from '../account/account-service';
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
import type { AgentMessage, AgentMode, AgentSession } from '../../common/agents/agents.types';
import type { ToolCallInfo } from '../../common/agents/tool-cards';
import { activeAgentCount, titleFromPrompt } from '../../common/agents/agents.utils';
import { chipLabel, expandWithChips, type ContextChip } from '../../common/agents/context-chips';
import { AGENT_PROTOCOL, formatContextFiles, parseAgentOutput, parseMentions, type AgentEdit } from '../../common/agents/agent-protocol';
import { isSafeRelativePath } from '../../common/groups/channel.utils';
import {
    GREP_MAX_FILE_BYTES, GREP_MAX_FILES, GREP_MAX_MATCHES, githubRepoFromRemote, globMatcher, grepMatcher, isTextCandidate, isWorkspaceTool, LIST_MAX_ENTRIES,
    numberLines, printsShellInsteadOfRunning, SHELL_NUDGE, SKIPPED_DIRS, withRepoDefaults, workspaceProtocol, type GitHubRepo, type WorkspaceInfo
} from '../../common/agents/workspace-tools';
import { parseRemotes } from '../../common/git/git-ops';
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
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import {
    APPROVAL_PREFS, BUILTIN_TOOL_SERVER, builtinToolEnabled, builtinToolProtocol, describeAction, gitOperationFor, needsApproval, skippedResult, toAlwaysRunCommands, toAlwaysRunMap,
    updateAlwaysRun, updateAlwaysRunCommands, type AgentAction, type AlwaysRunCommands, type AlwaysRunMap, type ApprovalDecision, type ApprovalKind
} from '../../common/agents/agent-actions';
import { ProcessStore } from '../processes/process-store';
import type { ImageChip } from '../../common/agents/composer-parts.types';
import { BrowserController } from '../browser-tool/browser-controller';
import { BROWSER_READ_TOOLS, browserNeedsCard, browserToolSettings } from '../../common/browser-tool/browser-settings';
import { toTarget } from '../../common/browser-tool/browser-tool.utils';
import { describeProcesses, isSafeScriptName, scriptCommand } from '../../common/processes/processes.utils';
import { runToolSettings, type RunToolSettings } from '../../common/processes/run-settings';
import { AgentActionsService, type AgentActionResult } from '../../common/agents/agent-actions-service';
import { GitService } from '../../common/git/git.types';
import { checkpoints, REVIEW_PREFS, reviewSettings, type ReviewSettings } from '../../common/review/review';

let nextId = 1;
const newChatId = (): string => `chat-${Date.now().toString(36)}-${nextId++}`;

/** Handles slash commands before the prompt reaches a model; returns true when handled (e.g. the group channel). */
export type AgentCommandHandler = (session: AgentSession, prompt: string) => boolean;

/** Chats shown as tabs in the Agents tool window; persisted in local storage, closed chats stay in History (IDEA-77). */
@injectable()
export class AgentStore {

    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(MessageService) protected readonly messageService: MessageService;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(AgentActionsService) protected readonly actions: AgentActionsService;
    @inject(GitService) protected readonly git: GitService;
    @inject(ProcessStore) protected readonly processes: ProcessStore;
    @inject(BrowserController) protected readonly browser: BrowserController;
    /** IDEA-109: runs waiting on the approval card, per session. */
    protected readonly approvals = new Map<string, (choice: { decision: ApprovalDecision; reason?: string; stopped?: boolean }) => void>();
    /** IDEA-105: paused runs waiting for Continue (or the countdown), per session. */
    protected readonly pauses = new Map<string, { resolve: (go: boolean) => void; timer?: ReturnType<typeof setTimeout> }>();
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
        this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName.startsWith('ingot.agent.review')) {
                this.onDidChangeEmitter.fire();
            }
        });
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

    /** Settings sync (IDEA-126): title / pinned from another device, for chats this install also has. */
    applySyncedMeta(id: string, meta: { title?: unknown; pinned?: unknown }): void {
        const session = this.items.find(s => s.id === id);
        if (!session) {
            return;
        }
        if (typeof meta.title === 'string' && meta.title) {
            session.title = meta.title;
        }
        if (typeof meta.pinned === 'boolean') {
            session.pinned = meta.pinned;
        }
        this.changed();
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
        this.runModel(session).finally(() => this.browser.endAgentRun(session.id));
        return session;
    }

    isRunning(id: string | undefined): boolean {
        return !!id && this.running.has(id);
    }

    /** Stops a streaming agent (Stop button / Escape). */
    stop(id: string): void {
        this.running.get(id)?.();
        this.running.delete(id);
        this.releasePause(id, false);
        this.approvals.get(id)?.({ decision: 'skip', stopped: true });
        this.browser.endAgentRun(id);
        this.changed();
    }

    /** IDEA-109: the approval card's choice (Run ⏎, Skip with an optional reason, Always Run). */
    decideApproval(id: string, decision: ApprovalDecision, reason?: string): void {
        this.approvals.get(id)?.({ decision, reason });
    }

    get alwaysRun(): AlwaysRunMap {
        return toAlwaysRunMap(this.preferences.get(APPROVAL_PREFS.alwaysRun));
    }

    /** Settings › Agent approvals: revoke (or grant) "Always Run" for a project and action kind. */
    async setAlwaysRun(project: string, kind: ApprovalKind, enabled: boolean): Promise<void> {
        await this.preferences.set(APPROVAL_PREFS.alwaysRun, updateAlwaysRun(this.alwaysRun, project, kind, !enabled), PreferenceScope.User);
        this.changed();
    }

    /** IDEA-131: commands that run without the card, per project. */
    get alwaysRunCommands(): AlwaysRunCommands {
        return toAlwaysRunCommands(this.preferences.get(APPROVAL_PREFS.alwaysRunCommands));
    }

    async setAlwaysRunCommand(project: string, command: string, enabled: boolean): Promise<void> {
        await this.preferences.set(APPROVAL_PREFS.alwaysRunCommands, updateAlwaysRunCommands(this.alwaysRunCommands, project, command, !enabled), PreferenceScope.User);
        this.changed();
    }

    get runSettings(): RunToolSettings {
        return runToolSettings(key => this.preferences.get(key));
    }

    protected askApproval(session: AgentSession, action: AgentAction): Promise<{ decision: ApprovalDecision; reason?: string; stopped?: boolean }> {
        const previous = session.status;
        session.approval = { ...action, id: `approval-${Date.now().toString(36)}-${nextId++}` };
        session.status = 'approval';
        session.updatedAt = Date.now();
        this.changed();
        return new Promise(resolve => {
            this.approvals.set(session.id, choice => {
                this.approvals.delete(session.id);
                session.approval = undefined;
                session.status = choice.stopped ? 'idle' : previous === 'approval' ? 'thinking' : previous;
                this.changed();
                resolve(choice);
            });
        });
    }

    get review(): ReviewSettings {
        return reviewSettings(key => this.preferences.get(key));
    }

    /** Composer quick toggle / Toggle Agent Review command (user settings). */
    async setReviewEnabled(enabled: boolean): Promise<void> {
        await this.preferences.set(REVIEW_PREFS.enabled, enabled, PreferenceScope.User);
        this.changed();
    }

    /** IDEA-105: "Continue now" on a paused run (also what the countdown does). */
    continueRun(id: string): void {
        this.releasePause(id, true);
    }

    /** IDEA-105: "Wait" or any review interaction: stop the countdown, keep the run paused. */
    holdPause(id: string): void {
        const session = this.sessions.find(s => s.id === id);
        const pause = this.pauses.get(id);
        if (!session?.pause || session.pause.continueAt === undefined || !pause) {
            return;
        }
        clearTimeout(pause.timer);
        pause.timer = undefined;
        session.pause = { ...session.pause, continueAt: undefined };
        this.syncPause(session);
        this.changed();
    }

    /** The floating review bar in the editor shows the paused run too (IDEA-105). */
    protected syncPause(session: AgentSession): void {
        const pause = session.pause;
        this.tracker.setPause(pause ? { ...pause, onContinue: () => this.continueRun(session.id) } : undefined);
    }

    protected releasePause(id: string, go: boolean): void {
        const pause = this.pauses.get(id);
        if (pause) {
            clearTimeout(pause.timer);
            this.pauses.delete(id);
            pause.resolve(go);
        }
    }

    /** Waits at a checkpoint until Continue, the countdown, or Stop (false). */
    protected waitAtCheckpoint(session: AgentSession, applied: number, total: number): Promise<boolean> {
        const seconds = this.review.autoContinueSeconds;
        session.status = 'paused';
        session.pause = { applied, total, continueAt: seconds > 0 ? Date.now() + seconds * 1000 : undefined };
        session.updatedAt = Date.now();
        this.syncPause(session);
        this.changed();
        return new Promise<boolean>(resolve => {
            const entry: { resolve: (go: boolean) => void; timer?: ReturnType<typeof setTimeout> } = { resolve };
            if (seconds > 0) {
                entry.timer = setTimeout(() => this.releasePause(session.id, true), seconds * 1000);
            }
            this.pauses.set(session.id, entry);
        }).then(go => {
            session.pause = undefined;
            this.syncPause(session);
            session.status = go ? 'editing' : 'idle';
            this.changed();
            return go;
        });
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
                    const content = `Tool result (${m.from}):\n${m.expanded ?? m.text}`;
                    // IDEA-130: a browser screenshot goes to the model as an image when it can read images.
                    return m.images?.length ? this.userMessage(session, { ...m, expanded: content }) : { role: 'user' as const, content };
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
        const workspace = await this.workspaceInfo(root);
        this.github = workspace.github;
        const base = [AGENT_SYSTEM_PROMPTS[session.mode], info.canEdit ? AGENT_PROTOCOL : '', root ? workspaceProtocol(workspace) : '', toolProtocol(tools), info.canUseTools ? builtinToolProtocol({ terminal: this.runSettings.enabled, browser: browserToolSettings(key => this.preferences.get(key)).enabled }) : '', this.memoryStore.generate ? MEMORY_PROTOCOL : ''].filter(Boolean).join('\n\n');
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

        let nudged = false;
        for (let round = 0; ; round++) {
            const parsed = await this.streamRound(session, system);
            if (!parsed) {
                return;
            }
            // IDEA-186: a reply that hands the user shell commands gets one nudge to run / read them itself.
            if (!parsed.toolCalls.length && !nudged && round < MAX_TOOL_ROUNDS && printsShellInsteadOfRunning(session.messages[session.messages.map(m => m.role).lastIndexOf('agent')]?.text ?? '')) {
                nudged = true;
                // The printed commands are replaced by real reads, so the user never sees "run this yourself".
                const printed = session.messages.map(m => m.role).lastIndexOf('agent');
                session.messages[printed] = { ...session.messages[printed], hidden: true };
                session.messages.push({ role: 'user', text: SHELL_NUDGE, hidden: true });
                continue;
            }
            if (parsed.toolCalls.length && round < MAX_TOOL_ROUNDS) {
                if (!await this.runTools(session, parsed.toolCalls)) {
                    session.messages.push({ role: 'system', text: 'Stopped while waiting for approval.' });
                    session.status = 'idle';
                    session.updatedAt = Date.now();
                    this.changed();
                    return;
                }
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
            text: display || (parsed.edits.length ? `Proposed changes to ${parsed.edits.length} file(s).` : parsed.toolCalls.length ? 'Calling tools…' : '(empty reply)'),
            // IDEA-186: a silent round of project reads shows only in the Explored row.
            ...(!display && !parsed.edits.length && parsed.toolCalls.length && parsed.toolCalls.every(c => c.server === BUILTIN_TOOL_SERVER && isWorkspaceTool(c.tool)) ? { hidden: true } : {})
        };
        return stopped ? { ...parsed, toolCalls: [], edits: [], memories: [] } : { ...parsed, memories };
    }

    /**
     * Runs a round of tool calls. Actions that need approval (IDEA-109) wait on the card first; Skip returns the
     * reason to the agent as the tool result. Returns false when the user stopped the run on the card.
     */
    protected async runTools(session: AgentSession, calls: readonly AgentToolCall[]): Promise<boolean> {
        const root = this.rootFor(session);
        const rootPath = root?.path.fsPath();
        for (const raw of calls) {
            const resolved = await this.resolveCall(raw, rootPath);
            if ('error' in resolved) {
                session.messages.push({ role: 'tool', from: `${raw.server}/${raw.tool}`, text: `Error: ${resolved.error}` });
                this.changed();
                continue;
            }
            const call = withRepoDefaults(resolved.call, this.github);
            const target = `${call.server}/${call.tool}`;
            const isGit = call.server === BUILTIN_TOOL_SERVER && call.tool === 'git';
            const branch = isGit && rootPath && call.args.op === 'push' && !call.args.branch
                ? (await this.git.run(rootPath, { kind: 'currentBranch' }).catch(() => ({ output: '' }))).output.trim() || undefined : undefined;
            const described = describeAction(call, branch);
            // Stopping a process the agent started itself never asks; the user's own processes do.
            const action = call.server === BUILTIN_TOOL_SERVER && call.tool === 'process_stop' && this.processes.find(String(call.args.id))?.origin !== 'user' ? undefined : described;
            const requireGit = this.preferences.get<boolean>(APPROVAL_PREFS.gitRequireApproval, true) !== false;
            const isBrowser = call.server === BUILTIN_TOOL_SERVER && call.tool.startsWith('browser_');
            const requireRun = action?.kind === 'terminal' ? this.runSettings.requireApproval
                : isBrowser ? browserNeedsCard(call.tool, browserToolSettings(key => this.preferences.get(key))) : true;
            // IDEA-133: a tool turned off in Settings › Agent tools is refused at once, without a card.
            const turnedOff = call.server === BUILTIN_TOOL_SERVER
                && !builtinToolEnabled(call.tool, { terminal: this.runSettings.enabled, browser: browserToolSettings(key => this.preferences.get(key)).enabled });
            if (action && !turnedOff && requireRun && needsApproval(action, rootPath ?? '', this.alwaysRun, requireGit, this.alwaysRunCommands)) {
                const choice = await this.askApproval(session, action);
                if (choice.stopped) {
                    return false;
                }
                if (choice.decision === 'skip') {
                    session.messages.push({ role: 'tool', from: target, text: skippedResult(action, choice.reason) });
                    this.changed();
                    continue;
                }
                if (choice.decision === 'always' && rootPath) {
                    await (action.command ? this.setAlwaysRunCommand(rootPath, action.command, true) : this.setAlwaysRun(rootPath, action.kind, true));
                }
            }
            const workspaceTool = call.server === BUILTIN_TOOL_SERVER && isWorkspaceTool(call.tool);
            session.steps = [...session.steps, workspaceTool ? this.workspaceStep(call) : { kind: 'run', target, done: false }];
            session.status = 'thinking';
            // IDEA-177: the card shows at once with a spinner, then fills in with the result.
            const tool: ToolCallInfo = { server: call.server, tool: call.tool, args: call.args, state: 'running', startedAt: Date.now() };
            const at = session.messages.push({ role: 'tool', from: target, text: '', tool }) - 1;
            this.changed();
            const result: AgentActionResult & { images?: ImageChip[] } = await (isBrowser ? this.runBrowser(session, call)
                : call.server === BUILTIN_TOOL_SERVER ? this.runBuiltin(call, root) : this.mcp.callTool(call.server, call.tool, call.args))
                .catch((error: unknown) => {
                    if (session.messages[at]?.tool === tool) {
                        session.messages[at] = { role: 'tool', from: target, text: `Error: ${error instanceof Error ? error.message : String(error)}`, tool: { ...tool, state: 'error', endedAt: Date.now() } };
                    }
                    throw error;
                });
            session.steps = session.steps.map(s => s.kind === 'run' && s.target === target && !s.done ? { ...s, done: true } : s);
            const done: AgentMessage = {
                role: 'tool', from: target, text: `${result.isError ? 'Error: ' : ''}${result.text}`, ...(result.images?.length ? { images: result.images } : {}),
                tool: { ...tool, state: result.isError ? 'error' : 'done', endedAt: Date.now() }
            };
            if (session.messages[at] && session.messages[at].tool === tool) {
                session.messages[at] = done;
            } else {
                session.messages.push(done);
            }
            this.changed();
        }
        return true;
    }

    /** IDEA-186: GitHub owner/repo of the open project (from its git remote), for GitHub tool calls. */
    protected github?: GitHubRepo;

    protected async workspaceInfo(root: URI | undefined): Promise<WorkspaceInfo> {
        const path = root?.path.fsPath();
        if (!root || !path) {
            return {};
        }
        const [branch, remotes] = await Promise.all([
            this.git.run(path, { kind: 'currentBranch' }).then(r => r.output.trim(), () => ''),
            this.git.run(path, { kind: 'remotes' }).then(r => parseRemotes(r.output), () => [])
        ]);
        const remote = remotes.find(r => r.name === 'origin') ?? remotes[0];
        return { name: root.path.base, ...(branch ? { branch } : {}), ...(githubRepoFromRemote(remote?.url) ? { github: githubRepoFromRemote(remote?.url) } : {}) };
    }

    protected workspaceStep(call: AgentToolCall): AgentSession['steps'][number] {
        const s = (v: unknown): string => typeof v === 'string' ? v : '';
        return call.tool === 'grep'
            ? { kind: 'search', target: s(call.args.pattern), done: true }
            : call.tool === 'list_dir'
                ? { kind: 'read', target: `${(s(call.args.path) || '.').replace(/\/+$/, '')}/`, done: true }
                : { kind: 'read', target: s(call.args.path) || '.', done: true };
    }

    protected safeUri(root: URI, path: string): URI | undefined {
        const clean = path.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
        if (!clean || clean === '.') {
            return root;
        }
        return isSafeRelativePath(clean) ? root.resolve(clean) : undefined;
    }

    protected async readFileTool(root: URI, path: string, start: number, end: number | undefined): Promise<AgentActionResult> {
        const uri = this.safeUri(root, path);
        if (!uri || uri === root) {
            return { text: `"${path}" is not a file path inside the project.`, isError: true };
        }
        const content = await this.files.read(uri).then(r => r.value, () => undefined);
        if (content === undefined) {
            return { text: `No file "${path}". Use ingot/list_dir or ingot/grep to find it.`, isError: true };
        }
        const { text, total, shown } = numberLines(content, start, end);
        return { text: `${path} (lines ${shown[0]}-${shown[1]} of ${total})\n${text}`, isError: false };
    }

    protected async listDirTool(root: URI, path: string, depth: number): Promise<AgentActionResult> {
        const base = this.safeUri(root, path);
        if (!base) {
            return { text: `"${path}" is not inside the project.`, isError: true };
        }
        const lines: string[] = [];
        const walk = async (uri: URI, level: number): Promise<void> => {
            const stat = await this.files.resolve(uri).catch(() => undefined);
            const children = [...(stat?.children ?? [])].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
            for (const child of children) {
                if (lines.length >= LIST_MAX_ENTRIES) {
                    return;
                }
                const rel = root.relative(child.resource)?.toString() ?? child.name;
                lines.push(`${'  '.repeat(level)}${child.isDirectory ? `${child.name}/` : child.name}${child.isDirectory && SKIPPED_DIRS.has(child.name) ? ' (skipped)' : ''}`);
                if (child.isDirectory && level + 1 < depth && !SKIPPED_DIRS.has(child.name) && rel) {
                    await walk(child.resource, level + 1);
                }
            }
        };
        const stat = await this.files.resolve(base).catch(() => undefined);
        if (!stat?.isDirectory) {
            return { text: `No folder "${path || '.'}".`, isError: true };
        }
        await walk(base, 0);
        return { text: `${path || '.'}/\n${lines.join('\n') || '(empty)'}${lines.length >= LIST_MAX_ENTRIES ? '\n… (more)' : ''}`, isError: false };
    }

    protected async grepTool(root: URI, pattern: string, path: string, glob: string, regex: boolean): Promise<AgentActionResult> {
        if (!pattern.trim()) {
            return { text: 'No pattern given.', isError: true };
        }
        const base = this.safeUri(root, path);
        if (!base) {
            return { text: `"${path}" is not inside the project.`, isError: true };
        }
        const match = grepMatcher(pattern, regex);
        const wanted = globMatcher(glob);
        const hits: string[] = [];
        let scanned = 0;
        const visit = async (uri: URI): Promise<void> => {
            const stat = await this.files.resolve(uri).catch(() => undefined);
            if (!stat) {
                return;
            }
            const entries = stat.isDirectory ? [...(stat.children ?? [])] : [stat];
            for (const entry of entries) {
                if (hits.length >= GREP_MAX_MATCHES || scanned >= GREP_MAX_FILES) {
                    return;
                }
                if (entry.isDirectory) {
                    if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                        await visit(entry.resource);
                    }
                    continue;
                }
                const rel = root.relative(entry.resource)?.toString() ?? entry.name;
                if (!isTextCandidate(rel) || !wanted(rel) || (entry.size ?? 0) > GREP_MAX_FILE_BYTES) {
                    continue;
                }
                scanned++;
                const content = await this.files.read(entry.resource).then(r => r.value, () => '');
                content.split('\n').forEach((line, i) => {
                    if (hits.length < GREP_MAX_MATCHES && match(line)) {
                        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
                    }
                });
            }
        };
        await visit(base);
        return { text: hits.length ? `${hits.length}${hits.length >= GREP_MAX_MATCHES ? '+' : ''} match(es) for "${pattern}" in ${scanned} file(s):\n${hits.join('\n')}` : `No matches for "${pattern}" (${scanned} file(s) searched).`, isError: false };
    }

    /** Ingot's built-in agent tools (IDEA-109): git, terminal command, web search / fetch, file delete. */
    protected async runBuiltin(call: AgentToolCall, root: URI | undefined): Promise<AgentActionResult> {
        const rootPath = root?.path.fsPath();
        if (!root || !rootPath) {
            return { text: 'Open a project first.', isError: true };
        }
        const str = (v: unknown): string => typeof v === 'string' ? v : '';
        try {
            switch (call.tool) {
                case 'git': {
                    if (call.args.op === 'log') {
                        const commits = await this.git.log(rootPath, 20);
                        return { text: commits.map(c => `${c.hash.slice(0, 8)} ${c.subject}`).join('\n') || 'No commits.', isError: false };
                    }
                    const result = await this.git.run(rootPath, gitOperationFor(call.args));
                    return { text: result.output.trim() || 'Done.', isError: false };
                }
                case 'read_file': return await this.readFileTool(root, str(call.args.path), Number(call.args.start) || 1, Number(call.args.end) || undefined);
                case 'list_dir': return await this.listDirTool(root, str(call.args.path), Math.min(3, Math.max(1, Number(call.args.depth) || 1)));
                case 'grep': return await this.grepTool(root, str(call.args.pattern), str(call.args.path), str(call.args.glob), call.args.regex === true);
                case 'run': return await this.runCommand(rootPath, str(call.args.command), call.args.background === true);
                case 'scripts': {
                    const found = await this.processes.service.scripts(rootPath);
                    if (!found || !Object.keys(found.scripts).length) {
                        return { text: 'No package.json scripts in this project.', isError: false };
                    }
                    return { text: [`Package manager: ${found.manager}`, ...Object.entries(found.scripts).map(([name, cmd]) => `- ${name}: ${cmd}`)].join('\n'), isError: false };
                }
                case 'processes': return { text: describeProcesses(await this.processes.service.list(), Date.now()), isError: false };
                case 'process_output': {
                    const out = await this.processes.service.output(str(call.args.id), this.runSettings.maxOutputChars);
                    const info = this.processes.find(str(call.args.id)) ?? (await this.processes.service.list()).find(p => p.id === str(call.args.id));
                    return out
                        ? { text: `${info ? describeProcesses([info], Date.now()) : out.id}\n${out.truncated ? '… (earlier output cut)\n' : ''}${out.text.trimEnd() || '(no output yet)'}`, isError: false }
                        : { text: `No process "${str(call.args.id)}". Use ingot/processes to list them.`, isError: true };
                }
                case 'process_stop': {
                    const stopped = await this.processes.service.stop(str(call.args.id));
                    return stopped ? { text: `Stopped ${str(call.args.id)}.`, isError: false } : { text: `Process "${str(call.args.id)}" is not running.`, isError: true };
                }
                case 'web_search': return await this.actions.search(str(call.args.query));
                case 'web_fetch': return await this.actions.fetchUrl(str(call.args.url));
                case 'delete': {
                    const path = str(call.args.path);
                    if (!isSafeRelativePath(path)) {
                        return { text: `Refusing to delete "${path}": use a path inside the project.`, isError: true };
                    }
                    await this.files.delete(root.resolve(path), { recursive: false, useTrash: true });
                    return { text: `Deleted ${path}.`, isError: false };
                }
                default: return { text: `Unknown Ingot tool "${call.tool}".`, isError: true };
            }
        } catch (error) {
            return { text: error instanceof Error ? error.message : String(error), isError: true };
        }
    }

    /** IDEA-130: the agent's browser tools, run in the Ingot browser panel (they wait while the user has control). */
    protected async runBrowser(session: AgentSession, call: AgentToolCall): Promise<AgentActionResult & { images?: ImageChip[] }> {
        if (!browserToolSettings(key => this.preferences.get(key)).enabled) {
            return { text: 'The browser tool is turned off in Settings › Tools › Agent tools.', isError: true };
        }
        const a = call.args;
        const str = (v: unknown): string => typeof v === 'string' ? v : '';
        const text = (t: string): AgentActionResult => ({ text: t, isError: /^(Browser error|Cannot open|No element|No field|Invalid selector|Stopped while)/.test(t) });
        switch (call.tool) {
            case 'browser_open': return text(await this.browser.agentOpen(session.id, str(a.url)));
            case 'browser_read': return text(await this.browser.agentRead(session.id));
            case 'browser_click': return text(await this.browser.agentClick(session.id, toTarget(a, 'click')));
            case 'browser_type': return text(await this.browser.agentType(session.id, toTarget(a, 'type'), str(a.text), a.submit === true));
            case 'browser_scroll': {
                const d = str(a.direction);
                return text(await this.browser.agentScroll(session.id, d === 'up' || d === 'top' || d === 'bottom' ? d : 'down'));
            }
            case 'browser_back': return text(await this.browser.agentBack(session.id));
            case 'browser_screenshot': {
                const shot = await this.browser.agentScreenshot(session.id);
                const data = shot.image?.dataUrl.replace(/^data:image\/png;base64,/, '');
                return { ...text(shot.text), ...(data ? { images: [{ id: `shot-${Date.now().toString(36)}`, name: 'screenshot.png', mediaType: 'image/png', data }] } : {}) };
            }
            default: return { text: `Unknown browser tool "${call.tool}". Tools: ${['browser_open', 'browser_click', 'browser_type', 'browser_scroll', 'browser_back', ...BROWSER_READ_TOOLS].join(', ')}.`, isError: true };
        }
    }

    /**
     * IDEA-131: `run_script` becomes a `run` of "<manager> run <script>" so the card shows (and Always Run remembers)
     * the real command.
     */
    protected async resolveCall(call: AgentToolCall, rootPath: string | undefined): Promise<{ call: AgentToolCall } | { error: string }> {
        if (call.server !== BUILTIN_TOOL_SERVER || call.tool !== 'run_script') {
            return { call };
        }
        const script = typeof call.args.script === 'string' ? call.args.script.trim() : '';
        if (!rootPath) {
            return { error: 'Open a project first.' };
        }
        const found = await this.processes.service.scripts(rootPath).catch(() => undefined);
        if (!script || !isSafeScriptName(script) || !found || !(script in found.scripts)) {
            const known = found ? Object.keys(found.scripts).join(', ') : '';
            return { error: `No script "${script}" in package.json.${known ? ` Scripts: ${known}.` : ''}` };
        }
        return { call: { server: BUILTIN_TOOL_SERVER, tool: 'run', args: { command: scriptCommand(found.manager, script), background: call.args.background === true } } };
    }

    /** IDEA-131: a command in the foreground (waits, then moves to the background after the timeout) or in the background. */
    protected async runCommand(cwd: string, command: string, background: boolean): Promise<AgentActionResult> {
        if (!command.trim()) {
            return { text: 'No command given.', isError: true };
        }
        const settings = this.runSettings;
        if (!settings.enabled) {
            return { text: 'Running commands is turned off in Settings › Tools › Agent tools.', isError: true };
        }
        const service = this.processes.service;
        if (background) {
            const info = await service.start({ cwd, command, background: true, origin: 'agent' });
            const out = await service.output(info.id, settings.maxOutputChars);
            const state = info.status === 'running' ? `Running in the background as ${info.id}${info.ports.length ? ` on port ${info.ports.join(', ')}` : ''}.` : `Exited with code ${info.exitCode ?? '?'}.`;
            return { text: `${state} Read more output with ingot/process_output, stop it with ingot/process_stop.\n${out?.text.trimEnd() ?? ''}`.trim(), isError: info.status === 'failed' };
        }
        const result = await service.run({ cwd, command, origin: 'agent', timeoutMs: settings.foregroundTimeoutSeconds * 1000, maxOutput: settings.maxOutputChars });
        const status = result.movedToBackground
            ? `Still running after ${settings.foregroundTimeoutSeconds}s: moved to the background as ${result.info.id}${result.info.ports.length ? ` (port ${result.info.ports.join(', ')})` : ''}. Use ingot/process_output or ingot/process_stop.`
            : result.info.status === 'stopped' ? 'Stopped.' : `Exit code ${result.info.exitCode ?? '?'}.`;
        return { text: `${result.output.trimEnd()}\n${status}`.trim(), isError: !result.movedToBackground && result.info.status !== 'exited' };
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
        const review = this.review;
        const ids: string[] = [];
        // IDEA-105: many files pause for review at checkpoints of `reviewPauseThreshold` files.
        const batches = checkpoints(edits, review.pauseThreshold);
        let applied = 0;
        for (const [b, batch] of batches.entries()) {
            for (const edit of batch) {
                applied++;
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
                if (review.autoAccept) {
                    await this.tracker.decide(change.id, 'all', 'accepted');
                }
                this.changed();
            }
            if (b < batches.length - 1 && !await this.waitAtCheckpoint(session, applied, edits.length)) {
                session.messages.push({ role: 'system', text: `Stopped at the review checkpoint: ${edits.length - applied} file(s) not applied.` });
                break;
            }
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
        if (error.kind === 'allowance') {
            this.promptUpgrade(error);
        }
        session.status = error.kind === 'blocked' ? 'idle' : 'error';
        session.updatedAt = Date.now();
        this.changed();
        return undefined;
    }

    /** Out of hosted allowance (IDEA-147): a notification whose Upgrade button opens the portal billing page. */
    protected promptUpgrade(error: GatewayError): void {
        void this.messageService.warn(upgradePromptText(error), UPGRADE_ACTION, UPGRADE_DISMISS).then(choice => {
            if (choice === UPGRADE_ACTION) {
                this.account.openBilling();
            }
        });
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
