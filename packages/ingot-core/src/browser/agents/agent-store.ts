import { inject, injectable } from '@theia/core/shared/inversify';
import { IngotModelClient } from '../models/model-client';
import { ZaprexLauncher } from './zaprex-launcher';
import { ZaprexDesktopService } from '../../common/zaprex/zaprex-desktop.types';
import { HANDOFF_CLAIM_TTL_MS, HANDOFF_MAX_CONTEXT_CHARS, HANDOFF_POLL_MS, HANDOFF_MAX_CONTEXT_FILES, workingLine, type HandoffFile, type HandoffStatus } from '../../common/zaprex/handoff';
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
import { ACTIVE_STATUSES, DEFAULT_MODEL, NEW_AGENT_TITLE, NO_MODEL_MESSAGE, SIGN_IN_MESSAGE, STREAM_POKE_MS } from '../../common/agents/agents.consts';
import type { AgentMessage, AgentMode, AgentSession } from '../../common/agents/agents.types';
import type { ToolCallInfo } from '../../common/agents/tool-cards';
import { hookCardInfo } from '../../common/git/hooks';
import { AgentHooksService } from '../hooks/agent-hooks-service';
import { activeAgentCount, resolveLoopGeneration, titleFromPrompt } from '../../common/agents/agents.utils';
import { CREATE_LIBRARY_TOOL, LIBRARY_COMMAND_TIMEOUT_SECONDS, LIBRARY_EXAMPLE_DEPTH, OPEN_WORKSPACE_DELAY_MS, OPEN_WORKSPACE_TOOL, TEMPLATE_NOTE } from '../../common/agents/library-app.consts';
import {
    isNodeStructure, isReactStructure, libraryCommandNeedsTime, libraryFiles, libraryNudge, libraryPathError, nodeStructureFromTree, parseLibraryPrompt, reactStructureFromTree, wantsProjectSkills
} from '../../common/agents/library-app';
import type { NodeStructure, ReactStructure } from '../../common/agents/library-app.types';
import { chipLabel, expandWithChips, type ContextChip } from '../../common/agents/context-chips';
import { AGENT_PROTOCOL, formatContextFiles, parseAgentOutput, parseMentions, type AgentEdit } from '../../common/agents/agent-protocol';
import { isSafeRelativePath } from '../../common/groups/channel.utils';
import {
    GREP_MAX_FILE_BYTES, GREP_MAX_FILES, GREP_MAX_MATCHES, GLOB_MAX_PATHS, compileGitignore, githubRepoFromRemote, globMatcher, grepMatcher,
    answerFromFiles, answerFromProject, asksAboutOpenProject, FILE_ANSWER_PATHS, fileQuestionGlob, globPaths, isPromptEcho, isTextCandidate, isWorkspaceTool, LIST_MAX_ENTRIES, numberLines, parseRgFiles, parseRgMatches,
    printsShellInsteadOfRunning, PROJECT_ENTRY_FILES, SHELL_NUDGE, shellReadsAsTools, textForRead,
    SKIPPED_DIRS, withRepoDefaults, workspaceProtocol, type GitHubRepo, type WorkspaceInfo
} from '../../common/agents/workspace-tools';
import { MAX_TOOL_RESULT_CHARS, MAX_TOOL_ROUNDS } from '../../common/project-config/project-config.consts';
import {
    CHECKS_PASSED_PREFIX, MAX_FIX_ATTEMPTS, MAX_TOOL_ROUNDS_CAP, MULTI_FILE_EDITS, REMOTE_BLOCKED, REVIEW_THEN_CHECKS, TOOL_ROUNDS_STOP, WORK_LOOP_PREFS
} from '../../common/agents/work-loop.consts';
import {
    WORK_LOOP_PROTOCOL, checkFailNudge, checkPassed, checksPassedNudge, commitBlockReason, detectChecks, detectE2eFramework, e2eNudge, isRemoteCodeFetch,
    isTestPath, isUiPath, needsE2eNudge, planFromEdits, stopMessage, summaryText, userAllowsWeakerTests, userAskedForRemote, wantsCommit,
    wantsE2e, wantsWorkLoop, weakensTests, withCheckEnv
} from '../../common/agents/work-loop';
import type { CheckRun, LoopState } from '../../common/agents/work-loop.types';
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
import type { ProjectCommand } from '../../common/project-config/project-config.types';
import { toolProtocol, type AgentToolCall } from '../../common/agents/agent-protocol';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AI_SETTINGS_PREFS, defaultAgentMode, defaultAgentModel } from '../../common/agents/ai-settings';
import { MADE_WITH_PREF, withMadeWith } from '../../common/git/made-with';
import { clampPieces, HARMONY_DEFAULTS, HARMONY_PREFS, harmonyLock, harmonyPrompt, isHeavyRun, pickHarmonyPiece, type HarmonyPiece } from '../../common/agents/harmony';
import {
    APPROVAL_PREFS, BUILTIN_TOOLS, BUILTIN_TOOL_SERVER, builtinToolEnabled, builtinToolProtocol, describeAction, gitOperationFor, needsApproval, skippedResult, toAlwaysRunCommands, toAlwaysRunMap,
    updateAlwaysRun, updateAlwaysRunCommands, type AgentAction, type AlwaysRunCommands, type AlwaysRunMap, type ApprovalDecision, type ApprovalKind
} from '../../common/agents/agent-actions';
import { ProcessStore } from '../processes/process-store';
import type { ImageChip } from '../../common/agents/composer-parts.types';
import { BrowserController } from '../browser-tool/browser-controller';
import { BROWSER_READ_TOOLS, browserNeedsCard, browserToolSettings } from '../../common/browser-tool/browser-settings';
import { toTarget } from '../../common/browser-tool/browser-tool.utils';
import { describeProcesses, isSafeScriptName, scriptCommand } from '../../common/processes/processes.utils';
import { OUTPUT_POLL_MS } from '../../common/processes/processes.consts';
import { truncateForEdit } from '../../common/agents/chat-thread';
import { ASK_STOPPED, ASK_USER_TOOL } from '../../common/agents/chat-round.consts';
import { conflictWarning, stampThought, toggleReaction } from '../../common/agents/chat-round';
import type { ReactionKind } from '../../common/agents/chat-round.types';
import { runToolSettings, type RunToolSettings } from '../../common/processes/run-settings';
import { AgentActionsService, type AgentActionResult } from '../../common/agents/agent-actions-service';
import { GitService } from '../../common/git/git.types';
import { checkpoints, REVIEW_PREFS, reviewSettings, type ReviewSettings } from '../../common/review/review';
import { CodebaseIndexStore } from '../codebase-index/codebase-index-store';
import { CODEBASE_SEARCH_TOOL } from '../../common/codebase-index/codebase-index.consts';
import { formatSearchResult } from '../../common/codebase-index/codebase-index.utils';

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
    @inject(ZaprexLauncher) protected readonly zaprex: ZaprexLauncher;
    @inject(ZaprexDesktopService) protected readonly zaprexDesktop: ZaprexDesktopService;
    /** IDEA-185: pieces handed to the Zaprex desktop app, by child chat id; the lead waits on them. */
    protected readonly handoffs = new Map<string, Promise<void>>();
    @inject(ProcessStore) protected readonly processes: ProcessStore;
    @inject(BrowserController) protected readonly browser: BrowserController;
    /** IDEA-109: runs waiting on the approval card, per session. */
    protected readonly approvals = new Map<string, (choice: { decision: ApprovalDecision; reason?: string; stopped?: boolean }) => void>();
    /** IDEA-105: paused runs waiting for Continue (or the countdown), per session. */
    protected readonly pauses = new Map<string, { resolve: (go: boolean) => void; timer?: ReturnType<typeof setTimeout> }>();
    /** Live edit views started while a reply streams, keyed by chat, message and path. */
    protected readonly streamingEdits = new Map<string, Promise<string | undefined>>();
    /** IDEA-248: work-loop state for the current user turn, not saved with the chat. */
    protected readonly loops = new Map<string, LoopState>();
    /** Chats whose model loop is on the stack, so accepting a review does not start a second one. */
    protected readonly modelLoops = new Set<string>();
    /** Answers waiting on ingot/ask_user. Undefined means the user stopped. */
    protected readonly answers = new Map<string, (text: string | undefined) => void>();
    /** Messages typed while a run is in progress, delivered on the next round. */
    protected readonly steers = new Map<string, string[]>();
    /** Nested runModel calls for one chat. The set stays until the outermost call returns. */
    protected readonly loopDepth = new Map<string, number>();
    /** Bumped by send and stop so a replaced or stopped turn cannot keep writing. */
    protected readonly loopGeneration = new Map<string, number>();
    /** Absolute paths of library apps this window created, so later commands may use them as cwd. */
    protected readonly createdApps = new Set<string>();
    /** Chats that already created a library, so the create nudge is not repeated. */
    protected readonly libraries = new Set<string>();
    /** Chats that already got the one "call create_library" nudge. */
    protected readonly libraryNudged = new Set<string>();
    /** Failed npm test runs in a created library, capped at MAX_FIX_ATTEMPTS. */
    protected readonly libraryFixes = new Map<string, number>();
    /** Chats the user stopped. Cleared when they send again. */
    protected readonly cancelled = new Set<string>();
    protected pokeTimer?: ReturnType<typeof setTimeout>;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;
    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(MemoryStore) protected readonly memoryStore: MemoryStore;
    @inject(AgentHooksService) protected readonly hooks: AgentHooksService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(CodebaseIndexStore) protected readonly codebaseIndex: CodebaseIndexStore;
    protected persistTimer?: ReturnType<typeof setTimeout>;
    /** Remove the auto-attached open file from the next new chat. */

    @postConstruct()
    protected restore(): void {
        this.items = parseChats(localStorage.getItem(CHATS_STORAGE_KEY));
        this.selected = this.tabs[0]?.id;
        this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === AI_SETTINGS_PREFS.defaultMode || e.preferenceName === AI_SETTINGS_PREFS.defaultModel) {
                this.applyChatDefaults();
            }
            if (e.preferenceName.startsWith('ingot.agent.review') || e.preferenceName === AI_SETTINGS_PREFS.zaprexButton) {
                this.onDidChangeEmitter.fire();
            }
        });
        void this.preferences.ready.then(() => this.applyChatDefaults());
    }

    /** IDEA-182: new chats start in the mode and model from Settings › AI & Zaprex; open chats keep theirs. */
    protected applyChatDefaults(): void {
        this.defaultMode = defaultAgentMode(this.preferences.get(AI_SETTINGS_PREFS.defaultMode), this.defaultMode);
        this.defaultModel = defaultAgentModel(this.preferences.get(AI_SETTINGS_PREFS.defaultModel), this.defaultModel);
    }

    /** IDEA-182: a model set in Settings › AI & Zaprex wins for new chats; otherwise the model in use (unchanged). */
    protected newChatModel(): string {
        return defaultAgentModel(this.preferences.get(AI_SETTINGS_PREFS.defaultModel), this.model);
    }

    /** IDEA-182: the T-rex in the title bar and the chat toolbar (Settings › AI & Zaprex). */
    get zaprexButtonVisible(): boolean {
        return this.preferences.get<boolean>(AI_SETTINGS_PREFS.zaprexButton, true) !== false;
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
            id: newChatId(), title, status: 'idle', updatedAt: Date.now(), mode: this.defaultMode, model: this.newChatModel(),
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
            id: newChatId(), title, status: 'idle', updatedAt: Date.now(), mode: this.defaultMode, model: this.newChatModel(),
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
        const askedNow = prompt.trim();
        if (session.ask && askedNow) {
            this.answerQuestion(session.id, askedNow);
            return session;
        }
        if (askedNow && this.isRunning(session.id)) {
            session.messages.push({ role: 'user', text: askedNow });
            this.steers.set(session.id, [...(this.steers.get(session.id) ?? []), askedNow]);
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
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
        const asked = prompt.trim();
        this.loops.set(session.id, {
            prompt: asked, wants: this.workLoopOn() && wantsWorkLoop(asked), edits: [], checks: [], fixAttempts: 0,
            e2eNudged: false, commitNudged: false, commitBlocked: false, committed: false, verifiedEdits: 0, required: []
        });
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
        const generation = (this.loopGeneration.get(session.id) ?? 0) + 1;
        this.loopGeneration.set(session.id, generation);
        this.cancelled.delete(session.id);
        this.changed();
        this.runModel(session, generation).finally(() => this.browser.endAgentRun(session.id));
        return session;
    }

    isRunning(id: string | undefined): boolean {
        return !!id && !this.cancelled.has(id) && (this.running.has(id) || this.modelLoops.has(id));
    }

    /** Stops a streaming agent (Stop button / Escape). */
    stop(id: string): void {
        const piece = this.items.find(s => s.id === id)?.handoff;
        if (piece && this.handoffs.has(id)) {
            void this.zaprexDesktop.cancel(piece.id).catch(() => undefined);
        }
        this.cancelled.add(id);
        this.loopGeneration.set(id, (this.loopGeneration.get(id) ?? 0) + 1);
        this.running.get(id)?.();
        this.running.delete(id);
        this.releasePause(id, false);
        this.approvals.get(id)?.({ decision: 'skip', stopped: true });
        this.answers.get(id)?.(undefined);
        this.answers.delete(id);
        this.steers.delete(id);
        const session = this.items.find(s => s.id === id);
        if (session) {
            session.ask = undefined;
        }
        if (session && (session.status === 'thinking' || session.status === 'editing' || session.status === 'approval')) {
            session.status = 'idle';
        }
        this.browser.endAgentRun(id);
        this.changed();
    }

    /** Keeps thought timing and reactions when a streaming reply is replaced. */
    protected writeAgentDraft(session: AgentSession, index: number, text: string, extra: Partial<AgentMessage> = {}): void {
        const prior = session.messages[index];
        const stamp = stampThought(prior, text, Date.now());
        session.messages[index] = {
            role: 'agent',
            ...(prior?.reactions?.length ? { reactions: prior.reactions } : {}),
            ...extra,
            ...stamp,
            text
        };
    }

    /** True when the user typed during this run. The message is already in the chat; take another round. */
    protected followSteer(session: AgentSession, generation: number): boolean {
        if (this.stale(session.id, generation) || !(this.steers.get(session.id)?.length)) {
            return false;
        }
        this.steers.delete(session.id);
        session.status = 'thinking';
        return true;
    }

    protected waitForAnswer(session: AgentSession, question: string, options: readonly string[]): Promise<string | undefined> {
        session.ask = { question, ...(options.length ? { options } : {}) };
        this.changed();
        return new Promise(resolve => {
            this.answers.set(session.id, resolve);
        });
    }

    /** Continues a run that is waiting on ingot/ask_user. */
    answerQuestion(sessionId: string, text: string): void {
        const session = this.items.find(item => item.id === sessionId);
        const resolve = this.answers.get(sessionId);
        const trimmed = text.trim();
        if (!session?.ask || !resolve || !trimmed) {
            return;
        }
        this.answers.delete(sessionId);
        session.ask = undefined;
        session.messages.push({ role: 'user', text: trimmed });
        session.updatedAt = Date.now();
        this.changed();
        resolve(trimmed);
    }

    toggleReaction(sessionId: string, index: number, kind: ReactionKind): void {
        const session = this.items.find(item => item.id === sessionId);
        const message = session?.messages[index];
        if (!session || !message || (message.role !== 'user' && message.role !== 'agent')) {
            return;
        }
        session.messages[index] = { ...message, reactions: toggleReaction(message.reactions, kind) };
        session.updatedAt = Date.now();
        this.changed();
    }

    /** Redraws a streaming reply on a timer so each token does not rebuild the whole chat. */
    protected poke(): void {
        if (this.pokeTimer) {
            return;
        }
        this.pokeTimer = setTimeout(() => {
            this.pokeTimer = undefined;
            this.changed();
        }, STREAM_POKE_MS);
    }

    protected flushPoke(): void {
        if (this.pokeTimer) {
            clearTimeout(this.pokeTimer);
            this.pokeTimer = undefined;
        }
        this.changed();
    }

    protected stale(sessionId: string, generation: number): boolean {
        return this.loopGeneration.get(sessionId) !== generation;
    }

    protected enterLoop(id: string): void {
        this.loopDepth.set(id, (this.loopDepth.get(id) ?? 0) + 1);
        this.modelLoops.add(id);
    }

    protected leaveLoop(id: string): void {
        const left = (this.loopDepth.get(id) ?? 1) - 1;
        if (left <= 0) {
            this.loopDepth.delete(id);
            this.modelLoops.delete(id);
        } else {
            this.loopDepth.set(id, left);
        }
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
                    const cap = this.maxResultChars();
                    const raw = m.expanded ?? m.text;
                    const body = raw.length > cap ? `${raw.slice(0, cap)}\n… (cut)` : raw;
                    const content = `Tool result (${m.from}):\n${body}`;
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
    /** A subagent or Zaprex piece has no send() generation. Pin one so the loop is not dropped as replaced. */
    protected generationFor(sessionId: string): number {
        const generation = resolveLoopGeneration(this.loopGeneration.get(sessionId));
        if (!this.loopGeneration.has(sessionId)) {
            this.loopGeneration.set(sessionId, generation);
        }
        return generation;
    }

    protected async runModel(session: AgentSession, generation = this.generationFor(session.id)): Promise<void> {
        this.enterLoop(session.id);
        try {
        if (this.stale(session.id, generation)) {
            return;
        }
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
        const base = [AGENT_SYSTEM_PROMPTS[session.mode], info.canEdit ? AGENT_PROTOCOL : '', info.canEdit && root ? WORK_LOOP_PROTOCOL : '', root ? workspaceProtocol(workspace) : '', toolProtocol(tools), info.canUseTools ? builtinToolProtocol({ terminal: this.runSettings.enabled, browser: browserToolSettings(key => this.preferences.get(key)).enabled }) : '', this.memoryStore.generate ? MEMORY_PROTOCOL : ''].filter(Boolean).join('\n\n');
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
        if (this.stale(session.id, generation)) {
            return;
        }
        this.changed();

        let nudged = false;
        const rounds = this.maxToolRounds();
        try {
            for (let round = 0; ; round++) {
                if (this.gaveUp(session, generation)) {
                    return;
                }
                const parsed = await this.streamRound(session, system);
                if (this.stale(session.id, generation)) {
                    return;
                }
                if (!parsed) {
                    if (session.status !== 'error' && session.status !== 'idle' && session.status !== 'review') {
                        session.status = 'idle';
                        this.changed();
                    }
                    return;
                }
                const agentIndex = session.messages.map(m => m.role).lastIndexOf('agent');
                const agentText = session.messages[agentIndex]?.text ?? '';
                const asked = lastUser?.m.text ?? prompt;
                const echoed = isPromptEcho(agentText, prompt) || isPromptEcho(agentText, asked);
                const scaffold = parseLibraryPrompt(asked) ?? parseLibraryPrompt(prompt);
                // Last resort: the hosted model repeated the prompt and called nothing. Say it is a template.
                if (echoed && scaffold?.path && scaffold.react && scaffold.node && !scaffold.ambiguous && !this.libraries.has(session.id)
                    && !parsed.toolCalls.length && !parsed.edits.length && round < rounds) {
                    this.hidePrinted(session, agentIndex);
                    session.messages.push({ role: 'system', text: TEMPLATE_NOTE });
                    const created = await this.finishTools(session, generation, [{
                        server: 'ingot', tool: 'create_library',
                        args: { path: scaffold.path, react: scaffold.react, node: scaffold.node, rules: wantsProjectSkills(asked) }
                    }]);
                    if (!created) {
                        return;
                    }
                    session.messages.push({
                        role: 'user',
                        text: `The new project is on disk at ${scaffold.path}. Run npm install && npm test && npm run build with cwd set to that folder. If tests fail, fix the files there and rerun npm test, up to 3 times. Then ask about git init on branch feature/library. Last, call ingot/open_workspace with that path. Do not describe the folder that was already open.`,
                        hidden: true
                    });
                    continue;
                }
                const fileGlob = fileQuestionGlob(asked) ?? fileQuestionGlob(prompt);
                if (!parsed.toolCalls.length && !parsed.edits.length && root && echoed && fileGlob) {
                    await this.replaceEchoWithFiles(session, root, fileGlob);
                    if (this.followSteer(session, generation)) {
                        continue;
                    }
                    session.updatedAt = Date.now();
                    this.changed();
                    return;
                }
                if (!parsed.toolCalls.length && !parsed.edits.length && root && echoed && (asksAboutOpenProject(prompt) || asksAboutOpenProject(asked))) {
                    await this.replaceEchoWithProject(session, root);
                    if (this.followSteer(session, generation)) {
                        continue;
                    }
                    session.updatedAt = Date.now();
                    this.changed();
                    return;
                }
                const recovered = !parsed.toolCalls.length && round < rounds ? shellReadsAsTools(agentText) : [];
                if (recovered.length) {
                    this.hidePrinted(session, agentIndex);
                    if (info.canEdit && parsed.edits.length) {
                        await this.applyParsedEdits(session, parsed.edits, parsed.plan, root);
                    }
                    if (!await this.finishTools(session, generation, recovered)) {
                        return;
                    }
                    session.messages.push({ role: 'user', text: SHELL_NUDGE, hidden: true });
                    continue;
                }
                if (!parsed.toolCalls.length && !nudged && round < rounds && printsShellInsteadOfRunning(agentText)) {
                    nudged = true;
                    this.hidePrinted(session, agentIndex);
                    session.messages.push({ role: 'user', text: SHELL_NUDGE, hidden: true });
                    continue;
                }
                const applied = info.canEdit && parsed.edits.length > 0;
                if (applied) {
                    await this.applyParsedEdits(session, parsed.edits, parsed.plan, root);
                }
                if (parsed.toolCalls.length && round < rounds) {
                    if (!await this.finishTools(session, generation, parsed.toolCalls)) {
                        return;
                    }
                    continue;
                }
                if (parsed.toolCalls.length) {
                    session.messages.push({ role: 'system', text: TOOL_ROUNDS_STOP });
                }
                await this.saveMemories(session, parsed.memories, root);
                if (this.stale(session.id, generation)) {
                    return;
                }
                const pending = applied && this.tracker.pending().some(change => change.sessionId === session.id);
                if (pending && this.loopOf(session).wants) {
                    session.messages.push({ role: 'system', text: REVIEW_THEN_CHECKS });
                } else if (!pending && round < rounds && await this.nudgeLoop(session, root)) {
                    if (this.stale(session.id, generation)) {
                        return;
                    }
                    continue;
                } else if (!applied && !parsed.toolCalls.length && round < rounds && (this.nudgeLibraryFix(session) || this.nudgeLibrary(session, prompt))) {
                    continue;
                } else if (!applied && session.mode === 'multi' && parsed.plan.length) {
                    this.spawnSubAgents(session, parsed.plan, prompt);
                } else if (!applied) {
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
                await this.waitForPieces(session);
                if (this.stale(session.id, generation)) {
                    return;
                }
                if (session.status !== 'review' && this.followSteer(session, generation)) {
                    continue;
                }
                session.activeFile = undefined;
                session.updatedAt = Date.now();
                this.changed();
                return;
            }
        } catch (error) {
            if (!this.stale(session.id, generation)) {
                session.messages.push({ role: 'system', text: `The agent stopped: ${error instanceof Error ? error.message : String(error)}` });
                session.status = 'error';
                session.updatedAt = Date.now();
                this.changed();
            }
        }
        } finally {
            this.leaveLoop(session.id);
            this.flushPoke();
        }
    }

    /** Stop or a newer turn owns the chat. A stopped turn is marked idle; a replaced turn is left alone. */
    protected gaveUp(session: AgentSession, generation: number): boolean {
        if (this.stale(session.id, generation)) {
            return true;
        }
        if (!this.cancelled.has(session.id)) {
            return false;
        }
        if (session.status !== 'error' && session.status !== 'review') {
            session.status = 'idle';
            this.changed();
        }
        return true;
    }

    protected hidePrinted(session: AgentSession, index: number): void {
        if (index >= 0 && session.messages[index]) {
            session.messages[index] = { ...session.messages[index], hidden: true };
        }
    }

    /** Applies a reply's edits even when that same reply also called tools. */
    protected async applyParsedEdits(session: AgentSession, edits: readonly AgentEdit[], plan: readonly string[], root: URI | undefined): Promise<void> {
        if (edits.length >= MULTI_FILE_EDITS && !plan.length && session.plan.length === 0) {
            session.plan = planFromEdits(edits.map(edit => edit.path)).map((text, i) => ({ text, state: i === 0 ? 'active' : 'todo' }));
        }
        const editable = await this.editsAllowed(session, edits, root);
        await this.applyEdits(session, editable, root);
    }

    /** Runs tools unless the user stopped or sent a newer message. False means the loop should return. */
    protected async finishTools(session: AgentSession, generation: number, calls: readonly AgentToolCall[]): Promise<boolean> {
        const ran = await this.runTools(session, calls);
        if (this.stale(session.id, generation)) {
            return false;
        }
        if (!ran || this.cancelled.has(session.id)) {
            if (!ran && session.messages[session.messages.length - 1]?.text !== ASK_STOPPED) {
                session.messages.push({ role: 'system', text: 'Stopped while waiting for approval.' });
            }
            session.status = 'idle';
            session.updatedAt = Date.now();
            this.changed();
            return false;
        }
        return true;
    }

    /** One streamed model reply; returns the parsed output, or undefined after an error. */
    protected async streamRound(session: AgentSession, system: string, retried = false): Promise<(ReturnType<typeof parseAgentOutput> & { memories: string[] }) | undefined> {
        const generation = this.loopGeneration.get(session.id) ?? 0;
        const live = (): boolean => !this.stale(session.id, generation) && !this.cancelled.has(session.id);
        if (!live()) {
            return undefined;
        }
        const history = this.historyFor(session);
        const index = session.messages.push({ role: 'agent', text: '' }) - 1;
        session.status = 'thinking';
        this.changed();
        let final = '';
        try {
            const tools = modeInfo(session.mode).canUseTools
                ? BUILTIN_TOOLS.filter(tool => builtinToolEnabled(tool.name, { terminal: this.runSettings.enabled, browser: browserToolSettings(key => this.preferences.get(key)).enabled }))
                    .map(tool => ({ name: tool.name, description: tool.description }))
                : [];
            const stream = this.models.stream(this.resolveModel(session.model), [{ role: 'system', content: system }, ...history], text => {
                if (!live() || !session.messages[index]) {
                    return;
                }
                const parsed = parseAgentOutput(text);
                this.streamEdit(session, index, parsed.editing, parsed.editingContent);
                this.writeAgentDraft(session, index, extractMemories(parsed.display).display);
                if (parsed.plan.length) {
                    session.plan = parsed.plan.map((t, i) => ({ text: t, state: i === 0 ? 'active' : 'todo' }));
                    this.considerHarmony(session, parsed.edits.length);
                }
                session.status = parsed.editing ? 'editing' : 'thinking';
                session.activeFile = parsed.editing ?? parsed.edits[parsed.edits.length - 1]?.path;
                session.updatedAt = Date.now();
                this.poke();
            }, tools.length ? { tools } : {});
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
        const stopped = !this.running.has(session.id) || !live();
        this.running.delete(session.id);
        if (stopped) {
            await this.tracker.cancelStreams(session.id);
            if (live()) {
                session.status = 'idle';
                this.flushPoke();
            }
            return undefined;
        }
        this.flushPoke();
        const parsed = parseAgentOutput(final);
        const { display, memories } = extractMemories(parsed.display);
        // Keep the raw reply for the model (so it sees its own tool calls), show the clean text.
        this.writeAgentDraft(session, index, display || (parsed.edits.length ? `Proposed changes to ${parsed.edits.length} file(s).` : parsed.toolCalls.length ? 'Calling tools…' : '(empty reply)'), {
            expanded: final,
            // IDEA-186: a silent round of project reads shows only in the Explored row.
            ...(!display && !parsed.edits.length && parsed.toolCalls.length && parsed.toolCalls.every(c => c.server === BUILTIN_TOOL_SERVER && isWorkspaceTool(c.tool)) ? { hidden: true } : {})
        });
        return { ...parsed, memories };
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
            if (call.server === BUILTIN_TOOL_SERVER && call.tool === ASK_USER_TOOL) {
                const question = typeof call.args.question === 'string' ? call.args.question.trim() : '';
                const options = Array.isArray(call.args.options) ? call.args.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
                if (!question) {
                    session.messages.push({ role: 'tool', from: target, text: 'Error: a question is required.' });
                    this.changed();
                    continue;
                }
                const answer = await this.waitForAnswer(session, question, options);
                if (answer === undefined || this.cancelled.has(session.id)) {
                    session.ask = undefined;
                    session.messages.push({ role: 'system', text: ASK_STOPPED });
                    this.changed();
                    return false;
                }
                session.messages.push({
                    role: 'tool', from: target, text: answer,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'done', startedAt: Date.now(), endedAt: Date.now() }
                });
                this.changed();
                continue;
            }
            const asked = [...session.messages].reverse().find(message => message.role === 'user' && !message.hidden)?.text ?? '';
            if (isRemoteCodeFetch(call) && !userAskedForRemote(asked)) {
                session.messages.push({
                    role: 'tool', from: target, text: REMOTE_BLOCKED,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt: Date.now(), endedAt: Date.now() }
                });
                this.changed();
                continue;
            }
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
            // IDEA-178: an agent commit / push goes through the `.ingot/hooks.json` steps first, shown as tool cards.
            // IDEA-248: a commit on master, main or release/*, or before green checks, is refused.
            const hookStage = isGit && rootPath ? (call.args.op === 'commit' ? 'pre-commit' : call.args.op === 'push' ? 'pre-push' : undefined) : undefined;
            if (isGit && call.args.op === 'commit' && rootPath) {
                const branch = (await this.git.run(rootPath, { kind: 'currentBranch' }).catch(() => ({ output: '' }))).output.trim();
                const loop = this.loopOf(session);
                const blocked = commitBlockReason(branch, loop, loop.required);
                if (blocked) {
                    loop.commitBlocked = true;
                    session.messages.push({ role: 'tool', from: target, text: `Error: ${blocked}` });
                    this.changed();
                    continue;
                }
            }
            let hooksRan = false;
            if (hookStage && rootPath && this.hooks.enabled) {
                const run = await this.hooks.run(rootPath, hookStage);
                for (const r of run.results.filter(x => x.state !== 'skipped')) {
                    const card = hookCardInfo(r, hookStage);
                    session.messages.push({ role: 'tool', from: `${BUILTIN_TOOL_SERVER}/hook`, text: card.text, tool: card.info });
                }
                if (!run.passed) {
                    const failed = run.results.filter(r => r.state === 'failed').map(r => `"${r.step.name}"`);
                    this.loopOf(session).commitBlocked = true;
                    session.messages.push({
                        role: 'tool', from: target,
                        text: `Error: blocked by .ingot hooks (${hookStage}${failed.length ? `: ${failed.join(', ')} failed` : ''}${run.errors.length ? `; ${run.errors.join(' ')}` : ''}). Fix the problem, then try the ${call.args.op} again.`
                    });
                    this.changed();
                    continue;
                }
                hooksRan = true;
                this.changed();
            }
            const workspaceTool = call.server === BUILTIN_TOOL_SERVER && isWorkspaceTool(call.tool);
            session.steps = [...session.steps, workspaceTool ? this.workspaceStep(call) : { kind: 'run', target, done: false }];
            session.status = 'thinking';
            // IDEA-177: the card shows at once with a spinner, then fills in with the result.
            const tool: ToolCallInfo = { server: call.server, tool: call.tool, args: call.args, state: 'running', startedAt: Date.now() };
            const at = session.messages.push({ role: 'tool', from: target, text: '', tool }) - 1;
            this.changed();
            const result: AgentActionResult & { images?: ImageChip[] } = await (isBrowser ? this.runBrowser(session, call)
                : call.server === BUILTIN_TOOL_SERVER ? this.runBuiltin(session, this.withMadeWithTrailer(session, call), root, hooksRan) : this.mcp.callTool(call.server, call.tool, call.args))
                .catch((error: unknown) => ({ text: error instanceof Error ? error.message : String(error), isError: true }));
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
            if (isGit && call.args.op === 'commit' && !result.isError && rootPath && this.loopOf(session).wants) {
                const loop = this.loopOf(session);
                loop.committed = true;
                loop.commitBlocked = false;
                const branch = (await this.git.run(rootPath, { kind: 'currentBranch' }).catch(() => ({ output: '' }))).output.trim();
                this.postSummary(session, branch);
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
        return { name: root.path.base, path, ...(branch ? { branch } : {}), ...(githubRepoFromRemote(remote?.url) ? { github: githubRepoFromRemote(remote?.url) } : {}) };
    }

    protected workspaceStep(call: AgentToolCall): AgentSession['steps'][number] {
        const s = (v: unknown): string => typeof v === 'string' ? v : '';
        return call.tool === CODEBASE_SEARCH_TOOL
            ? { kind: 'search', target: s(call.args.query), done: true }
            : call.tool === 'grep' || call.tool === 'glob'
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

    /**
     * The model repeated a project question. Read the open folder and answer from those files.
     * The echo is replaced, and the reads show up in the Explored row.
     */
    protected async replaceEchoWithProject(session: AgentSession, root: URI): Promise<void> {
        const files: { path: string; text: string }[] = [];
        const listed = await this.listDirTool(root, '.', 1);
        if (!listed.isError) {
            files.push({ path: '.', text: listed.text });
            session.steps = [...session.steps, { kind: 'read', target: './', done: true }];
        }
        for (const path of PROJECT_ENTRY_FILES) {
            const uri = this.safeUri(root, path);
            const text = uri ? await this.files.read(uri).then(file => file.value, () => undefined) : undefined;
            if (text === undefined) {
                continue;
            }
            files.push({ path, text });
            session.steps = [...session.steps, { kind: 'read', target: path, done: true }];
        }
        const at = session.messages.map(message => message.role).lastIndexOf('agent');
        const text = answerFromProject(root.path.base, files);
        if (at >= 0) {
            session.messages[at] = { role: 'agent', text };
        } else {
            session.messages.push({ role: 'agent', text });
        }
        session.status = 'idle';
        session.activeFile = undefined;
    }

    /** The model repeated a question about files. Glob the open folder and answer with those paths. */
    protected async replaceEchoWithFiles(session: AgentSession, root: URI, pattern: string): Promise<void> {
        const found = await this.globTool(root, pattern, '.');
        const paths = globPaths(found.text);
        const shown = paths.slice(0, FILE_ANSWER_PATHS);
        session.steps = [
            ...session.steps,
            { kind: 'search', target: pattern, done: true },
            ...shown.map(path => ({ kind: 'read' as const, target: path, done: true }))
        ];
        const at = session.messages.map(message => message.role).lastIndexOf('agent');
        const text = answerFromFiles(root.path.base, pattern, paths);
        if (at >= 0) {
            session.messages[at] = { role: 'agent', text };
        } else {
            session.messages.push({ role: 'agent', text });
        }
        session.status = 'idle';
        session.activeFile = undefined;
    }

    protected async readFileTool(root: URI, path: string, start: number, end: number | undefined): Promise<AgentActionResult> {
        const uri = this.safeUri(root, path);
        if (!uri || uri === root) {
            return { text: `"${path}" is not a file path inside the project.`, isError: true };
        }
        const cwd = root.path.fsPath();
        const disk = cwd ? await this.processes.service.readText(cwd, path).catch(() => undefined) : undefined;
        const editor = await this.tracker.bufferText(uri.toString()).catch(() => undefined);
        const content = textForRead(disk, editor) ?? await this.files.read(uri).then(r => r.value, () => undefined);
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
        const ignored = await this.ignoreOf(root);
        const lines: string[] = [];
        const walk = async (uri: URI, level: number): Promise<void> => {
            const stat = await this.files.resolve(uri).catch(() => undefined);
            const children = [...(stat?.children ?? [])].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
            for (const child of children) {
                if (lines.length >= LIST_MAX_ENTRIES) {
                    return;
                }
                const rel = root.relative(child.resource)?.toString() ?? child.name;
                if (rel && ignored(rel) && child.name !== '.gitignore') {
                    continue;
                }
                lines.push(`${'  '.repeat(level)}${child.isDirectory ? `${child.name}/` : child.name}${child.isDirectory && SKIPPED_DIRS.has(child.name) ? ' (skipped)' : ''}`);
                if (child.isDirectory && level + 1 < depth && !SKIPPED_DIRS.has(child.name) && rel && !ignored(rel)) {
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

    protected async globTool(root: URI, pattern: string, path: string): Promise<AgentActionResult> {
        if (!pattern.trim()) {
            return { text: 'No pattern given.', isError: true };
        }
        const found = await this.searchWithRg(root, { pattern, path, glob: pattern, files: true });
        if (found) {
            return found;
        }
        const base = this.safeUri(root, path);
        if (!base) {
            return { text: `"${path}" is not inside the project.`, isError: true };
        }
        const ignored = await this.ignoreOf(root);
        const wanted = globMatcher(pattern);
        const hits: string[] = [];
        const visit = async (uri: URI): Promise<void> => {
            const stat = await this.files.resolve(uri).catch(() => undefined);
            if (!stat) {
                return;
            }
            const entries = stat.isDirectory ? [...(stat.children ?? [])] : [stat];
            for (const entry of entries) {
                if (hits.length >= GLOB_MAX_PATHS) {
                    return;
                }
                const rel = root.relative(entry.resource)?.toString() ?? entry.name;
                if (entry.isDirectory) {
                    if (!SKIPPED_DIRS.has(entry.name) && !(entry.name.startsWith('.') && entry.name !== '.ingot') && !ignored(rel)) {
                        await visit(entry.resource);
                    }
                    continue;
                }
                if (!ignored(rel) && wanted(rel)) {
                    hits.push(rel);
                }
            }
        };
        await visit(base);
        return { text: hits.length ? hits.join('\n') : `No files matched "${pattern}".`, isError: false };
    }

    protected async grepTool(root: URI, pattern: string, path: string, glob: string, regex: boolean): Promise<AgentActionResult> {
        if (!pattern.trim()) {
            return { text: 'No pattern given.', isError: true };
        }
        const found = await this.searchWithRg(root, { pattern, path, glob, regex, files: false });
        if (found) {
            return found;
        }
        const base = this.safeUri(root, path);
        if (!base) {
            return { text: `"${path}" is not inside the project.`, isError: true };
        }
        const match = grepMatcher(pattern, regex);
        const wanted = globMatcher(glob);
        const ignored = await this.ignoreOf(root);
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
                const rel = root.relative(entry.resource)?.toString() ?? entry.name;
                if (ignored(rel)) {
                    continue;
                }
                if (entry.isDirectory) {
                    if (!SKIPPED_DIRS.has(entry.name) && !(entry.name.startsWith('.') && entry.name !== '.ingot')) {
                        await visit(entry.resource);
                    }
                    continue;
                }
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

    /** IDEA-260: ranked snippets from the local codebase index. */
    protected async codebaseSearchTool(rootPath: string, query: string, path: string, limit: unknown): Promise<AgentActionResult> {
        if (!query.trim()) {
            return { text: 'No query given.', isError: true };
        }
        if (!this.codebaseIndex.enabled) {
            return { text: 'The codebase index is turned off in Settings. Use ingot/grep instead.', isError: true };
        }
        if (path && !isSafeRelativePath(path.replace(/\/+$/, ''))) {
            return { text: `"${path}" is not inside the project.`, isError: true };
        }
        const result = await this.codebaseIndex.search(rootPath, query, { path, ...(limit !== undefined ? { limit: Number(limit) } : {}) });
        return { text: formatSearchResult(result), isError: Boolean(result.error) };
    }

    /** Ingot's built-in agent tools (IDEA-109): git, terminal command, web search / fetch, file delete. */
    protected async runBuiltin(session: AgentSession, call: AgentToolCall, root: URI | undefined, hooksRan = false): Promise<AgentActionResult> {
        const rootPath = root?.path.fsPath();
        const str = (v: unknown): string => typeof v === 'string' ? v : '';
        try {
            if (call.tool === CREATE_LIBRARY_TOOL) {
                return await this.createLibrary(session, call.args, rootPath);
            }
            if (call.tool === OPEN_WORKSPACE_TOOL) {
                return this.openWorkspace(str(call.args.path));
            }
            if (!root || !rootPath) {
                return { text: 'Open a project first.', isError: true };
            }
            switch (call.tool) {
                case 'git': {
                    if (call.args.op === 'log') {
                        const commits = await this.git.log(rootPath, 20);
                        return { text: commits.map(c => `${c.hash.slice(0, 8)} ${c.subject}`).join('\n') || 'No commits.', isError: false };
                    }
                    const op = gitOperationFor(call.args);
                    const result = await this.git.run(rootPath, hooksRan && (op.kind === 'commit' || op.kind === 'push' || op.kind === 'pushTo') ? { ...op, hooksRan } : op);
                    return { text: result.output.trim() || 'Done.', isError: false };
                }
                case 'read_file': return await this.readFileTool(root, str(call.args.path), Number(call.args.start) || 1, Number(call.args.end) || undefined);
                case 'list_dir': return await this.listDirTool(root, str(call.args.path), Math.min(3, Math.max(1, Number(call.args.depth) || 1)));
                case 'glob': return await this.globTool(root, str(call.args.pattern), str(call.args.path));
                case 'grep': return await this.grepTool(root, str(call.args.pattern), str(call.args.path), str(call.args.glob), call.args.regex === true);
                case CODEBASE_SEARCH_TOOL: return await this.codebaseSearchTool(rootPath, str(call.args.query), str(call.args.path), call.args.limit);
                case 'run': {
                    const command = str(call.args.command);
                    const cwd = this.resolveRunCwd(rootPath, str(call.args.cwd));
                    if (!cwd) {
                        return { text: `Refusing to run "${command}" outside the open project.`, isError: true };
                    }
                    const timeout = this.isCreatedApp(cwd) && libraryCommandNeedsTime(command) ? LIBRARY_COMMAND_TIMEOUT_SECONDS : undefined;
                    return await this.runCommand(cwd, command, call.args.background === true, undefined, timeout);
                }
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
    protected async runCommand(cwd: string, command: string, background: boolean, onOutput?: (text: string) => void, timeoutSecondsArg?: number): Promise<AgentActionResult> {
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
        const startedAt = Date.now();
        const poll = onOutput ? setInterval(() => {
            void service.list().then(async list => {
                const info = [...list].reverse().find(item => item.command === command && item.startedAt >= startedAt - OUTPUT_POLL_MS);
                if (!info) {
                    return;
                }
                const out = await service.output(info.id, settings.maxOutputChars);
                if (out?.text) {
                    onOutput(out.text);
                }
            }).catch(() => undefined);
        }, OUTPUT_POLL_MS) : undefined;
        try {
            const timeoutSeconds = timeoutSecondsArg ?? settings.foregroundTimeoutSeconds;
            const result = await service.run({ cwd, command, origin: 'agent', timeoutMs: timeoutSeconds * 1000, maxOutput: settings.maxOutputChars });
            const status = result.movedToBackground
                ? `Still running after ${timeoutSeconds}s: moved to the background as ${result.info.id}${result.info.ports.length ? ` (port ${result.info.ports.join(', ')})` : ''}. Use ingot/process_output or ingot/process_stop.`
                : result.info.status === 'stopped' ? 'Stopped.' : `Exit code ${result.info.exitCode ?? '?'}.`;
            return { text: `${result.output.trimEnd()}\n${status}`.trim(), isError: result.movedToBackground || result.info.status !== 'exited', movedToBackground: result.movedToBackground };
        } finally {
            if (poll) {
                clearInterval(poll);
            }
        }
    }

    /** One nudge when a library prompt never becomes create_library, and another when its tests fail. */
    protected nudgeLibrary(session: AgentSession, prompt: string): boolean {
        if (this.libraryNudged.has(session.id) || this.libraries.has(session.id)) {
            return false;
        }
        const parsed = parseLibraryPrompt(prompt);
        if (!parsed) {
            return false;
        }
        this.libraryNudged.add(session.id);
        session.messages.push({ role: 'user', text: libraryNudge(parsed), hidden: true });
        this.changed();
        return true;
    }

    protected nudgeLibraryFix(session: AgentSession): boolean {
        if (!this.libraries.has(session.id)) {
            return false;
        }
        const last = [...session.messages].reverse().find(message => message.role === 'tool' && message.tool?.tool === 'run');
        const command = typeof last?.tool?.args.command === 'string' ? last.tool.args.command : '';
        if (!last?.text.startsWith('Error:') || !libraryCommandNeedsTime(command) || !/\btest\b/.test(command)) {
            return false;
        }
        const attempts = (this.libraryFixes.get(session.id) ?? 0) + 1;
        if (attempts > MAX_FIX_ATTEMPTS) {
            return false;
        }
        this.libraryFixes.set(session.id, attempts);
        session.messages.push({
            role: 'user',
            text: `npm test failed (attempt ${attempts} of ${MAX_FIX_ATTEMPTS}). Fix the library project files and run npm test again with the same cwd.`,
            hidden: true
        });
        this.changed();
        return true;
    }

    protected resolveRunCwd(rootPath: string, requested: string): string | undefined {
        const trimmed = requested.trim();
        if (!trimmed) {
            return rootPath;
        }
        const abs = this.absolutePath(trimmed, rootPath);
        if (!abs) {
            return undefined;
        }
        const inside = abs === rootPath || abs.startsWith(`${rootPath}/`) || abs.startsWith(`${rootPath}\\`);
        return inside || this.isCreatedApp(abs) ? abs : undefined;
    }

    protected isCreatedApp(cwd: string): boolean {
        return [...this.createdApps].some(app => cwd === app || cwd.startsWith(`${app}/`) || cwd.startsWith(`${app}\\`));
    }

    protected absolutePath(raw: string, rootPath?: string): string | undefined {
        const trimmed = raw.trim().replace(/^["']|["']$/g, '');
        if (!trimmed) {
            return undefined;
        }
        const absolute = trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed);
        if (!absolute && !rootPath) {
            return undefined;
        }
        const uri = absolute || !rootPath ? URI.fromFilePath(trimmed) : URI.fromFilePath(rootPath).resolve(trimmed);
        return uri.path.fsPath();
    }

    protected openWorkspace(raw: string): AgentActionResult {
        const target = this.absolutePath(raw);
        if (!target) {
            return { text: 'Open workspace needs an absolute folder path.', isError: true };
        }
        const uri = URI.fromFilePath(target);
        // Let the tool result paint before the workspace reload.
        setTimeout(() => { void this.workspace.open(uri, { preserveWindow: true }); }, OPEN_WORKSPACE_DELAY_MS);
        return { text: `Opening ${target}.`, isError: false };
    }

    protected async treeOf(abs: string): Promise<string[]> {
        const paths: string[] = [];
        const walk = async (uri: URI, prefix: string, depth: number): Promise<void> => {
            const stat = await this.files.resolve(uri).catch(() => undefined);
            if (!stat) {
                return;
            }
            if (prefix) {
                paths.push(stat.isDirectory ? `${prefix}/` : prefix);
            }
            if (!stat.isDirectory || depth <= 0) {
                return;
            }
            for (const child of stat.children ?? []) {
                const name = child.name || child.resource.path.base;
                await walk(child.resource, prefix ? `${prefix}/${name}` : name, depth - 1);
            }
        };
        await walk(URI.fromFilePath(abs), '', LIBRARY_EXAMPLE_DEPTH);
        return paths;
    }

    protected async createLibrary(session: AgentSession, args: Record<string, unknown>, rootPath: string | undefined): Promise<AgentActionResult> {
        const str = (value: unknown): string => typeof value === 'string' ? value : '';
        const target = this.absolutePath(str(args.path), rootPath);
        if (!target) {
            return { text: 'create_library needs a folder path. Ask the user for one.', isError: true };
        }
        const pathError = libraryPathError(target);
        if (pathError) {
            return { text: pathError, isError: true };
        }
        let react: ReactStructure | undefined = isReactStructure(str(args.react)) ? str(args.react) as ReactStructure : undefined;
        let node: NodeStructure | undefined = isNodeStructure(str(args.node)) ? str(args.node) as NodeStructure : undefined;
        const reactExample = this.absolutePath(str(args.reactExample), rootPath);
        const nodeExample = this.absolutePath(str(args.nodeExample), rootPath);
        if (!react && reactExample) {
            react = reactStructureFromTree(await this.treeOf(reactExample));
        }
        if (!node && nodeExample) {
            node = nodeStructureFromTree(await this.treeOf(nodeExample));
        }
        if (!react || !node) {
            return { text: 'The React structure must be feature-folders or atomic, and the Node structure must be layered or modular. Call ingot/ask_user if that is still unclear.', isError: true };
        }
        const uri = URI.fromFilePath(target);
        const existing = await this.files.resolve(uri).catch(() => undefined);
        if (existing?.isFile || (existing?.children?.length ?? 0) > 0) {
            return { text: `"${target}" already has files. Pick a new empty folder.`, isError: true };
        }
        const asked = [...session.messages].reverse().find(message => message.role === 'user' && !message.hidden)?.text ?? '';
        const files = libraryFiles({ path: target, react, node, rules: args.rules === true || wantsProjectSkills(asked) });
        const messageIndex = Math.max(0, session.messages.map(message => message.role).lastIndexOf('agent'));
        const origin = this.originOf(session, messageIndex);
        for (const entry of files) {
            const fileUri = uri.resolve(entry.path);
            try {
                await this.tracker.finalize(origin, entry.path, fileUri, entry.content);
                await this.tracker.persist(fileUri.toString());
            } catch {
                await this.processes.service.writeText(target, entry.path, entry.content);
            }
            const added = entry.content.split('\n').length;
            session.steps = [...session.steps, { kind: 'edit', target: entry.path, done: true, added, removed: 0 }];
        }
        this.createdApps.add(target);
        this.libraries.add(session.id);
        session.project = uri.toString();
        this.changed();
        return {
            text: `Created ${files.length} files at ${target} (React ${react}, Node ${node}). Next: ingot/run {"command":"npm install && npm test && npm run build","cwd":${JSON.stringify(target)}}. If tests fail, fix the files and rerun, up to ${MAX_FIX_ATTEMPTS} times. Then ask about git init on branch feature/library, and last call ingot/open_workspace.`,
            isError: false
        };
    }

    protected workLoopOn(): boolean {
        return this.preferences.get<boolean>(WORK_LOOP_PREFS.enabled, true) !== false;
    }

    protected maxToolRounds(): number {
        const raw = this.preferences.get<number>(WORK_LOOP_PREFS.maxToolRounds, MAX_TOOL_ROUNDS);
        const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : MAX_TOOL_ROUNDS;
        return Math.min(MAX_TOOL_ROUNDS_CAP, Math.max(1, value));
    }

    protected maxResultChars(): number {
        const raw = this.preferences.get<number>(WORK_LOOP_PREFS.maxToolResultChars, MAX_TOOL_RESULT_CHARS);
        return typeof raw === 'number' && raw >= 1_000 ? Math.floor(raw) : MAX_TOOL_RESULT_CHARS;
    }

    protected loopOf(session: AgentSession): LoopState {
        const existing = this.loops.get(session.id);
        if (existing) {
            return existing;
        }
        const created: LoopState = {
            prompt: '', wants: false, edits: [], checks: [], fixAttempts: 0, e2eNudged: false, commitNudged: false,
            commitBlocked: false, committed: false, verifiedEdits: 0, required: []
        };
        this.loops.set(session.id, created);
        return created;
    }

    /** Drops edits that delete or skip tests unless the user asked for that. */
    protected async editsAllowed(session: AgentSession, edits: readonly AgentEdit[], root: URI | undefined): Promise<AgentEdit[]> {
        const loop = this.loopOf(session);
        if (!loop.wants || !root || userAllowsWeakerTests(loop.prompt)) {
            return [...edits];
        }
        const kept: AgentEdit[] = [];
        for (const edit of edits) {
            if (!isTestPath(edit.path)) {
                kept.push(edit);
                continue;
            }
            const uri = this.safeUri(root, edit.path);
            const before = uri && uri !== root ? await this.files.read(uri).then(file => file.value, () => '') : '';
            if (weakensTests(before, edit.content)) {
                session.messages.push({ role: 'system', text: `Skipped ${edit.path}: do not delete or weaken tests. Fix the code instead.` });
                continue;
            }
            kept.push(edit);
        }
        return kept;
    }

    protected async ignoreOf(root: URI): Promise<(rel: string) => boolean> {
        const text = await this.files.read(root.resolve('.gitignore')).then(file => file.value, () => '');
        return compileGitignore(text);
    }

    /** Ripgrep when the backend has it. Undefined asks the caller to walk the tree. */
    protected async searchWithRg(root: URI, query: { pattern?: string; path?: string; glob?: string; regex?: boolean; files: boolean }): Promise<AgentActionResult | undefined> {
        const cwd = root.path.fsPath();
        if (!cwd) {
            return undefined;
        }
        const found = await this.processes.service.workspaceSearch({ cwd, ...query }).catch(() => undefined);
        if (!found || found.engine !== 'ripgrep') {
            return undefined;
        }
        if (query.files) {
            const files = parseRgFiles(found.text);
            return { text: files.length ? `${files.length} file(s):\n${files.join('\n')}` : `No files matched "${query.pattern ?? query.glob ?? ''}".`, isError: false };
        }
        const hits = parseRgMatches(found.text);
        return { text: hits.length ? `${hits.length} match(es) for "${query.pattern}":\n${hits.join('\n')}` : `No matches for "${query.pattern}".`, isError: false };
    }

    protected async projectSignals(root: URI): Promise<{ scripts: Record<string, string>; files: string[]; manager?: 'npm' | 'pnpm' | 'yarn' | 'bun' }> {
        const cwd = root.path.fsPath();
        const found = cwd ? await this.processes.service.scripts(cwd).catch(() => undefined) : undefined;
        const stat = await this.files.resolve(root).catch(() => undefined);
        const files = [...(stat?.children ?? [])].filter(child => !child.isDirectory).map(child => child.name);
        return { scripts: { ...(found?.scripts ?? {}) }, files, ...(found ? { manager: found.manager } : {}) };
    }

    /** Runs one project check and shows it as a terminal card. These checks do not wait on the approval card. */
    protected async runCheck(session: AgentSession, cwd: string, command: string): Promise<AgentActionResult> {
        const tool: ToolCallInfo = { server: BUILTIN_TOOL_SERVER, tool: 'run', args: { command, description: 'Project check' }, state: 'running', startedAt: Date.now() };
        const at = session.messages.push({ role: 'tool', from: `${BUILTIN_TOOL_SERVER}/run`, text: '', tool }) - 1;
        session.status = 'thinking';
        this.changed();
        const result = await this.runCommand(cwd, command, false, text => {
            if (session.messages[at]?.tool === tool) {
                session.messages[at] = { ...session.messages[at], text };
                this.poke();
            }
        });
        session.messages[at] = {
            role: 'tool', from: `${BUILTIN_TOOL_SERVER}/run`, text: `${result.isError ? 'Error: ' : ''}${result.text}`,
            tool: { ...tool, state: result.isError ? 'error' : 'done', endedAt: Date.now() }
        };
        this.changed();
        return result;
    }

    /**
     * After edits land on disk: run the detected checks, and nudge the model to fix, add an e2e test, or commit.
     * Returns true when the model should take another turn.
     */
    protected async nudgeLoop(session: AgentSession, root: URI | undefined): Promise<boolean> {
        const loop = this.loopOf(session);
        const cwd = root?.path.fsPath();
        if (!loop.wants || !root || !cwd || !this.runSettings.enabled || loop.committed) {
            return false;
        }
        if (loop.edits.length > loop.verifiedEdits) {
            await this.flushAcceptedEdits(session, root);
            const signals = await this.projectSignals(root);
            const framework = detectE2eFramework(signals.files);
            const includeE2e = !!framework && (wantsE2e(loop.prompt) || loop.edits.some(isUiPath));
            const planned = detectChecks(signals, includeE2e);
            loop.required = planned.map(check => withCheckEnv(check.command));
            loop.verifiedEdits = loop.edits.length;
            for (const command of loop.required) {
                const result = await this.runCheck(session, cwd, command);
                const run: CheckRun = { command, passed: checkPassed(result), output: result.text };
                loop.checks.push(run);
                if (!run.passed) {
                    loop.fixAttempts += 1;
                    if (loop.fixAttempts > MAX_FIX_ATTEMPTS) {
                        session.messages.push({ role: 'system', text: stopMessage(result.text) });
                        session.status = 'idle';
                        this.changed();
                        return false;
                    }
                    session.messages.push({ role: 'user', text: checkFailNudge(command, result.text, loop.fixAttempts), hidden: true });
                    this.changed();
                    return true;
                }
            }
            if (framework && needsE2eNudge(loop, framework, loop.prompt, loop.edits)) {
                loop.e2eNudged = true;
                session.messages.push({ role: 'user', text: e2eNudge(framework), hidden: true });
                this.changed();
                return true;
            }
        }
        const green = loop.required.every(command => loop.checks.some(check => check.command === command && check.passed));
        if (wantsCommit(loop.prompt) && green && !loop.committed && (!loop.commitNudged || loop.commitBlocked)) {
            const retry = loop.commitBlocked;
            loop.commitNudged = true;
            loop.commitBlocked = false;
            const branch = (await this.git.run(cwd, { kind: 'currentBranch' }).catch(() => ({ output: '' }))).output.trim();
            const text = retry
                ? `${CHECKS_PASSED_PREFIX} The commit was blocked. Fix the problem and commit again on a feature/ or bug/ branch.`
                : checksPassedNudge(branch, loop.required);
            session.messages.push({ role: 'user', text, hidden: true });
            this.changed();
            return true;
        }
        return false;
    }

    /** Accepted editor text is what the check must read. Pending review stays off disk. */
    protected async flushAcceptedEdits(session: AgentSession, root: URI): Promise<void> {
        const cwd = root.path.fsPath();
        if (!cwd) {
            return;
        }
        const pending = new Set(this.tracker.pending().filter(change => change.sessionId === session.id).map(change => change.path));
        for (const rel of [...new Set(this.loopOf(session).edits)]) {
            if (pending.has(rel)) {
                continue;
            }
            const uri = this.safeUri(root, rel);
            if (!uri || uri === root) {
                continue;
            }
            const editor = await this.tracker.bufferText(uri.toString()).catch(() => undefined);
            if (editor === undefined) {
                continue;
            }
            const disk = await this.processes.service.readText(cwd, rel).catch(() => undefined);
            if (disk !== editor) {
                await this.processes.service.writeText(cwd, rel, editor).catch(() => undefined);
            }
        }
    }

    /** Review finished and the files are on disk: continue the loop if this turn asked for one. */
    protected async resumeLoop(session: AgentSession): Promise<void> {
        if (this.modelLoops.has(session.id) || !this.loopOf(session).wants) {
            return;
        }
        if (await this.nudgeLoop(session, this.rootFor(session))) {
            await this.runModel(session);
        }
    }

    protected postSummary(session: AgentSession, branch: string): void {
        const loop = this.loopOf(session);
        const now = Date.now();
        const text = summaryText({ files: [...new Set(loop.edits)], checks: loop.checks, branch, result: 'committed' });
        session.messages.push({
            role: 'tool', from: `${BUILTIN_TOOL_SERVER}/summary`, text,
            tool: { server: BUILTIN_TOOL_SERVER, tool: 'summary', args: {}, state: 'done', startedAt: now, endedAt: now }
        });
    }

    /** Where an agent message's edits come from (its chat, itself, and the user message it answers). */
    protected originOf(session: AgentSession, messageIndex: number): ChangeOrigin {
        const userIndex = session.messages.slice(0, messageIndex + 1).map(m => m.role).lastIndexOf('user');
        return { sessionId: session.id, messageIndex, userIndex: Math.max(0, userIndex) };
    }

    /** Live editor view while an edit block streams (IDEA-102): the file fills in as the model types. */
    protected streamEdit(session: AgentSession, messageIndex: number, path: string | undefined, content: string | undefined): void {
        const root = this.rootFor(session);
        if (!path || content === undefined || !root || !modeInfo(session.mode).canEdit || !isSafeRelativePath(path) || this.lockedFor(session, path)) {
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
        this.considerHarmony(session, edits.length);
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
                const locked = this.lockedFor(session, edit.path);
                if (locked) {
                    session.messages.push({ role: 'system', text: locked });
                    await this.tracker.cancelStream(session.id, edit.path);
                    continue;
                }
                const others = this.tracker.sessionsTouching(edit.path).filter(id => id !== session.id);
                if (others.length) {
                    const titles = others.map(id => this.items.find(item => item.id === id)?.title).filter((title): title is string => !!title);
                    session.messages.push({ role: 'system', text: conflictWarning(titles, edit.path) });
                }
                // Wait for the live view of this file (if it streamed) so the final text lands on the same change.
                await this.streamingEdits.get(`${session.id}\u0000${messageIndex}\u0000${edit.path}`);
                const change = await this.tracker.finalize(origin, edit.path, root.resolve(edit.path), edit.content);
                this.loopOf(session).edits.push(edit.path);
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
            if (kept.length && this.loopOf(session).wants && !this.modelLoops.has(session.id)) {
                void this.resumeLoop(session);
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

    /**
     * Edit a sent user message in place: restore files to before that turn, drop it and everything after it,
     * then send the new text so the agent runs again from there.
     */
    async editUserMessage(sessionId: string, index: number, text: string): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        const trimmed = text.trim();
        if (!session || message?.role !== 'user' || message.hidden || !trimmed) {
            return;
        }
        this.stop(sessionId);
        this.selected = sessionId;
        try {
            await this.tracker.revertTo(sessionId, index, restorePlan(this.tracker.checkpoints, sessionId, index));
        } catch (error) {
            session.messages.push({ role: 'system', text: `Could not restore files: ${error instanceof Error ? error.message : String(error)}` });
            session.status = 'error';
            this.changed();
            return;
        }
        session.messages = truncateForEdit(session.messages, index);
        session.steps = [];
        session.plan = [];
        session.changes = session.changes.filter(change => this.tracker.changes.some(tracked => tracked.uri === change.uri && tracked.sessionId === sessionId));
        this.loops.delete(sessionId);
        session.status = 'idle';
        this.changed();
        this.send(trimmed);
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

    /** IDEA-180 Harmony mode: Zaprex's offer per lead chat (the bubble under the title bar T-rex). */
    protected readonly harmonyOffers = new Map<string, HarmonyPiece>();
    /** Runs (chat id + user message index) whose offer was dismissed or taken, so it is not offered again. */
    protected readonly harmonyAsked = new Set<string>();

    get harmonyEnabled(): boolean {
        return this.preferences.get<boolean>(HARMONY_PREFS.enabled, HARMONY_DEFAULTS.enabled) !== false;
    }

    /** The newest open offer: which chat and which piece. */
    get harmonyOffer(): { readonly sessionId: string; readonly piece: HarmonyPiece } | undefined {
        const entries = [...this.harmonyOffers.entries()].filter(([id]) => this.items.some(s => s.id === id));
        const last = entries[entries.length - 1];
        return last && { sessionId: last[0], piece: last[1] };
    }

    /** The open offer for one chat. */
    harmonyOfferFor(sessionId: string): HarmonyPiece | undefined {
        return this.harmonyOffers.get(sessionId);
    }

    /** IDEA-181: a chat's subagents (Multi-agent subtasks and Zaprex pieces), oldest first. */
    subagents(leadId: string | undefined): readonly AgentSession[] {
        return leadId ? this.items.filter(s => s.parent === leadId).sort((a, b) => (a.openedAt ?? a.updatedAt) - (b.openedAt ?? b.updatedAt)) : [];
    }

    find(id: string): AgentSession | undefined {
        return this.items.find(s => s.id === id);
    }

    /** IDEA-183: agent commits end with "Made with Ingot", or "Made with Zaprex" when Zaprex worked on the chat. */
    protected withMadeWithTrailer(session: AgentSession, call: AgentToolCall): AgentToolCall {
        if (call.tool !== 'git' || call.args.op !== 'commit' || typeof call.args.message !== 'string' || call.args.amend === true
            || this.preferences.get<boolean>(MADE_WITH_PREF, true) === false) {
            return call;
        }
        const zaprex = session.agent === 'zaprex' || this.zaprexPieces(session.id).length > 0;
        return { ...call, args: { ...call.args, message: withMadeWith(call.args.message, zaprex ? 'zaprex' : 'ingot') } };
    }

    /** Zaprex pieces of a chat (running or done), newest first. */
    zaprexPieces(leadId?: string): readonly AgentSession[] {
        return this.items.filter(s => s.agent === 'zaprex' && (!leadId || s.parent === leadId));
    }

    /** True while Zaprex works on a piece (the T-rex thinks). */
    get zaprexBusy(): boolean {
        return this.zaprexPieces().some(s => this.isRunning(s.id) || ACTIVE_STATUSES.includes(s.status));
    }

    protected harmonyRunKey(session: AgentSession): string {
        return `${session.id}:${session.messages.map(m => m.role).lastIndexOf('user')}`;
    }

    /** Offers (or, with "ask first" off, takes) one piece once a run gets heavy: many plan steps or files. */
    protected considerHarmony(session: AgentSession, files: number): void {
        if (!this.harmonyEnabled || session.agent === 'zaprex' || session.parent || (session.mode !== 'agent' && session.mode !== 'multi')
            || this.harmonyOffers.has(session.id) || this.harmonyAsked.has(this.harmonyRunKey(session))
            || !isHeavyRun(session.plan.length, Math.max(files, session.changes.length))) {
            return;
        }
        const pieces = this.zaprexPieces(session.id);
        if (pieces.length >= clampPieces(this.preferences.get(HARMONY_PREFS.maxPieces, HARMONY_DEFAULTS.maxPieces))) {
            return;
        }
        const goal = [...session.messages].reverse().find(m => m.role === 'user')?.text ?? session.title;
        const piece = pickHarmonyPiece(session.plan.map(p => p.text), goal, pieces.map(p => p.piece).filter(k => !!k));
        if (!piece) {
            return;
        }
        this.harmonyOffers.set(session.id, piece);
        if (this.preferences.get<boolean>(HARMONY_PREFS.askFirst, HARMONY_DEFAULTS.askFirst) === false) {
            this.acceptHarmony(session.id);
            return;
        }
        this.changed();
    }

    dismissHarmony(sessionId: string): void {
        const session = this.items.find(s => s.id === sessionId);
        if (session) {
            this.harmonyAsked.add(this.harmonyRunKey(session));
        }
        this.harmonyOffers.delete(sessionId);
        this.changed();
    }

    /** Accept: Zaprex runs the piece in its own chat (locked to the piece's files); the lead gets a one-line note. */
    acceptHarmony(sessionId: string): AgentSession | undefined {
        const lead = this.items.find(s => s.id === sessionId);
        const piece = this.harmonyOffers.get(sessionId);
        this.harmonyOffers.delete(sessionId);
        if (!lead || !piece) {
            this.changed();
            return undefined;
        }
        this.harmonyAsked.add(this.harmonyRunKey(lead));
        const goal = [...lead.messages].reverse().find(m => m.role === 'user')?.text ?? lead.title;
        const child: AgentSession = {
            id: newChatId(), title: `Zaprex · ${piece.label}`, status: 'thinking', updatedAt: Date.now(), mode: 'agent', model: lead.model,
            messages: [{ role: 'user', text: piece.task, expanded: `${piece.task}\n\n${harmonyPrompt(piece, goal)}` }],
            plan: [], steps: [], changes: [], project: lead.project, open: false, openedAt: Date.now(), parent: lead.id,
            agent: 'zaprex', scope: piece.scope, piece: piece.kind
        };
        this.items = [child, ...this.items];
        // A peer line: the lead agent sees it too, so it leaves the piece's files alone.
        lead.messages.push({ role: 'peer', from: 'Zaprex', refs: [child.id], text: `Taking a piece in Harmony mode: ${piece.task}. I only change ${piece.scope.slice(0, 3).join(', ')}${piece.scope.length > 3 ? ', …' : ''}; leave those files to me.` });
        this.changed();
        // IDEA-185: with the Zaprex desktop app the piece is handed over (deep link + loopback token); else it runs here.
        void this.zaprex.info().then(info => info.installed ? this.handOff(lead, child, piece, goal) : this.runPieceHere(child));
        return child;
    }

    protected runPieceHere(child: AgentSession): void {
        this.runModel(child).catch(() => { child.status = 'error'; }).finally(() => {
            child.updatedAt = Date.now();
            this.changed();
        });
    }

    /** IDEA-185: gives the piece to the Zaprex desktop app and follows its status until it posts the result. */
    protected async handOff(lead: AgentSession, child: AgentSession, piece: HarmonyPiece, goal: string): Promise<void> {
        const root = this.rootFor(lead);
        const path = root?.path.fsPath();
        if (!root || !path) {
            this.runPieceHere(child);
            return;
        }
        let done!: () => void;
        this.handoffs.set(child.id, new Promise<void>(resolve => { done = resolve; }));
        try {
            const [branch, head] = await Promise.all([
                this.git.run(path, { kind: 'currentBranch' }).then(r => r.output.trim(), () => ''),
                this.git.run(path, { kind: 'revParse', ref: 'HEAD' }).then(r => r.output.trim(), () => '')
            ]);
            const context = await this.handoffContext(lead, root);
            const leadInfo = { title: lead.title, task: goal };
            const { id, link } = await this.zaprexDesktop.startHandoff({
                kind: piece.kind, label: piece.label, task: piece.task, goal, lead: leadInfo, scope: piece.scope,
                repo: { path, ...(branch ? { branch } : {}), ...(head ? { head } : {}) }, context
            });
            child.handoff = { id, desktop: true, message: 'Waiting for the Zaprex app…' };
            child.messages.push({ role: 'system', text: `Handed to the Zaprex desktop app · ${workingLine({ label: piece.label, lead: leadInfo })}` });
            this.changed();
            await this.zaprexDesktop.open(link);
            await this.followHandoff(child, root);
        } catch (error) {
            child.status = 'error';
            child.messages.push({ role: 'system', text: `Could not hand the piece to Zaprex: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
            this.handoffs.delete(child.id);
            child.updatedAt = Date.now();
            this.changed();
            done();
        }
    }

    /** Files the lead is changing (capped), so Zaprex starts from the same code. */
    protected async handoffContext(lead: AgentSession, root: URI): Promise<HandoffFile[]> {
        const paths = [...new Set([...lead.steps.filter(st => st.kind === 'edit').map(st => st.target), ...lead.changes.map(c => c.label)])]
            .filter(p => isSafeRelativePath(p)).slice(0, HANDOFF_MAX_CONTEXT_FILES);
        const files: HandoffFile[] = [];
        let budget = HANDOFF_MAX_CONTEXT_CHARS;
        for (const p of paths) {
            const content = await this.files.read(root.resolve(p)).then(r => r.value, () => undefined);
            if (content === undefined || budget <= 0) {
                continue;
            }
            files.push({ path: p, content: content.slice(0, budget) });
            budget -= content.length;
        }
        return files;
    }

    protected async followHandoff(child: AgentSession, root: URI): Promise<void> {
        const id = child.handoff!.id;
        const started = Date.now();
        const line = (st: HandoffStatus): string => st.message || (st.state === 'pending' ? 'Waiting for the Zaprex app…' : st.state === 'claimed' ? 'Zaprex picked it up' : 'Working…');
        for (;;) {
            await new Promise(resolve => setTimeout(resolve, HANDOFF_POLL_MS));
            if (child.status !== 'thinking') {
                return; // stopped
            }
            const status = await this.zaprexDesktop.status(id).catch(() => undefined);
            if (!status) {
                child.status = 'error';
                child.messages.push({ role: 'system', text: 'The Zaprex handoff ended unexpectedly.' });
                return;
            }
            if (status.state === 'pending' && Date.now() - started > HANDOFF_CLAIM_TTL_MS) {
                await this.zaprexDesktop.cancel(id).catch(() => undefined);
                child.status = 'error';
                child.messages.push({ role: 'system', text: 'Zaprex did not pick up the piece. Is the Zaprex app open?' });
                return;
            }
            child.handoff = { ...child.handoff!, progress: status.progress, message: line(status) };
            this.changed();
            if (status.state === 'done' && status.result) {
                child.handoff = { ...child.handoff, progress: 1, message: undefined };
                child.messages.push({ role: 'agent', from: 'Zaprex', text: status.result.summary || 'Done.' });
                if (status.result.edits.length) {
                    // Same review as any agent: the edits land in the review bar, locked to the piece's scope.
                    await this.applyEdits(child, status.result.edits, root);
                } else {
                    child.status = 'idle';
                }
                return;
            }
            if (status.state === 'failed' || status.state === 'cancelled') {
                child.status = status.state === 'failed' ? 'error' : 'idle';
                child.messages.push({ role: 'system', text: status.state === 'failed' ? `Zaprex could not finish: ${status.message ?? 'no reason given'}` : 'Zaprex cancelled the piece.' });
                return;
            }
        }
    }

    /** IDEA-185: the lead waits until its desktop pieces are done, then points at the review bar. */
    protected async waitForPieces(lead: AgentSession): Promise<void> {
        const pieces = this.zaprexPieces(lead.id).filter(p => this.handoffs.has(p.id));
        if (!pieces.length) {
            return;
        }
        const before = lead.status;
        lead.status = 'thinking';
        lead.messages.push({ role: 'system', refs: pieces.map(p => p.id), text: `Waiting for Zaprex: ${pieces.map(p => p.title.replace(/^Zaprex · /, '')).join(', ')}…` });
        this.changed();
        await Promise.all(pieces.map(p => this.handoffs.get(p.id)));
        for (const p of pieces) {
            const edits = p.steps.filter(st => st.kind === 'edit').length;
            lead.messages.push({
                role: 'peer', from: 'Zaprex', refs: [p.id],
                text: p.status === 'error' ? `${p.title.replace(/^Zaprex · /, '')} needs attention.`
                    : `Done: ${p.title.replace(/^Zaprex · /, '')}${edits ? ` · ${edits} file(s) to review in the review bar` : ''}.`
            });
        }
        lead.status = before === 'thinking' ? 'idle' : before;
    }

    /** Harmony file lock: why this chat may not change `path` right now, if it may not. */
    protected lockedFor(session: AgentSession, path: string): string | undefined {
        if (session.agent === 'zaprex') {
            return harmonyLock(path, 'zaprex', session.scope);
        }
        for (const piece of this.zaprexPieces(session.id)) {
            // Hold the lock for the rest of the lead's turn. Zaprex often finishes before the lead's last edit,
            // and releasing the lock then lets the lead overwrite the piece.
            const live = this.isRunning(piece.id) || ACTIVE_STATUSES.includes(piece.status) || this.modelLoops.has(session.id);
            if (live) {
                const reason = harmonyLock(path, 'agent', piece.scope);
                if (reason) {
                    return reason;
                }
            }
        }
        return undefined;
    }

    /** Multi-agent: one Agent-mode chat per subtask, run in parallel in their own tabs; the lead chat reports progress. */
    protected spawnSubAgents(lead: AgentSession, plan: readonly string[], goal: string): void {
        const subtasks = plan.slice(0, MAX_SUB_AGENTS);
        const children = subtasks.map((task, i) => {
            const child: AgentSession = {
                id: newChatId(), title: titleFromPrompt(task), status: 'thinking', updatedAt: Date.now(), mode: 'agent', model: lead.model,
                messages: [{ role: 'user', text: task, expanded: `${task}\n\nThis is subtask ${i + 1} of ${subtasks.length} for: ${goal}\nOnly do this subtask.` }],
                plan: [], steps: [], changes: [], project: lead.project, open: false, openedAt: Date.now() + i, parent: lead.id, agent: 'ingot'
            };
            return child;
        });
        this.items = [...children, ...this.items];
        lead.plan = subtasks.map(t => ({ text: t, state: 'active' }));
        // IDEA-181: subagents run outside the main chat (Subagents strip); the chat keeps a one-line reference.
        lead.messages.push({ role: 'system', text: `Started ${children.length} subagents: ${children.map(c => c.title).join(' · ')}`, refs: children.map(c => c.id) });
        lead.status = 'thinking';
        this.changed();
        Promise.all(children.map(async (child, i) => {
            await this.runModel(child).catch(() => { child.status = 'error'; });
            lead.plan = lead.plan.map((p, j) => j === i ? { ...p, state: 'done' } : p);
            this.changed();
        })).then(() => {
            const changed = children.reduce((n, c) => n + c.changes.length, 0);
            const failed = children.filter(c => c.status === 'error').length;
            lead.messages.push({
                role: 'system', refs: children.map(c => c.id),
                text: `Subagents finished: ${children.length - failed} of ${children.length} done${changed ? ` · ${changed} file(s) changed` : ''}${failed ? ` · ${failed} need attention` : ''}`
            });
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
