import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { RuleHitsStore } from '../rules-insight/rule-hits-store';
import { RulesToolsService } from '../../common/rules-tools/rules-tools.types';
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
import { modeBlockedResult, toolAllowedInMode } from '../../common/agents/mode-tools';
import type { CustomSubagent } from '../../common/agents/custom-subagents.types';
import { findSubagent, formatSubagents, readonlySubagentResult, subagentInstructions, unknownSubagentError } from '../../common/agents/custom-subagents.utils';
import { worktreeSetupSummary } from '../../common/threads/worktree-setup.utils';
import { WorktreeSetupService } from '../threads/worktree-setup-service';
import { CHATS_STORAGE_KEY, mergeWindowChats, parseChats, serializeChats, windowChats } from '../../common/agents/chat-history';
import { SUMMARIZE_PROMPT, contextUsage, estimateTokens, usageRatio } from '../../common/agents/context-usage';
import { DEFAULT_SCOPE, MEMORY_PROTOCOL, extractMemories, formatMemories, relevantMemories, type MemoryNote } from '../../common/memories/memories';
import { MemoryStore } from './memory-store';
import { formatAutoContext, sentAutoContext } from '../../common/agents/auto-context';
import type { AutoAttach } from '../../common/agents/auto-context.types';
import { extractFollowUps, followUpsFor } from '../../common/agents/follow-ups';
import { FOLLOW_UPS_PROTOCOL } from '../../common/agents/follow-ups.consts';
import type { CheckOutcome } from '../../common/agents/follow-ups.types';
import { misreadTask } from '../../common/agents/task-intent';
import { ACT_NUDGE, AGENT_WORKFLOW, EXPLAIN_NUDGE } from '../../common/agents/task-intent.consts';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { postConstruct } from '@theia/core/shared/inversify';
import type { ChatMessage } from '../../common/models/models.types';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { ACTIVE_STATUSES, AGENT_MAX_TOKENS, DEFAULT_MODEL, NEW_AGENT_TITLE, NO_MODEL_MESSAGE, SIGN_IN_MESSAGE, STREAM_POKE_MS } from '../../common/agents/agents.consts';
import type { AgentMessage, AgentMode, AgentSession, SentPromptEvent } from '../../common/agents/agents.types';
import { extractThought, type ToolCallInfo } from '../../common/agents/tool-cards';
import { hookCardInfo } from '../../common/git/hooks';
import { AgentHooksService } from '../hooks/agent-hooks-service';
import { activeAgentCount, resolveLoopGeneration, titleFromPrompt } from '../../common/agents/agents.utils';
import {
    CREATE_LIBRARY_TOOL, LIBRARY_COMMAND_TIMEOUT_SECONDS, LIBRARY_EXAMPLE_DEPTH, LIBRARY_TEMPLATE_PREF, OPEN_WORKSPACE_DELAY_MS, OPEN_WORKSPACE_TOOL, TEMPLATE_NOTE
} from '../../common/agents/library-app.consts';
import {
    isNodeStructure, isReactStructure, libraryCommandNeedsTime, libraryFiles, libraryNudge, libraryPathError, nodeStructureFromTree, parseLibraryPrompt, reactStructureFromTree, wantsProjectSkills
} from '../../common/agents/library-app';
import type { NodeStructure, ReactStructure } from '../../common/agents/library-app.types';
import { chipLabel, expandWithChips, type ContextChip } from '../../common/agents/context-chips';
import { AGENT_PROTOCOL, TOOL_CALL_FORMAT, formatContextFiles, parseAgentOutput, parseMentions, type AgentEdit } from '../../common/agents/agent-protocol';
import { isSafeRelativePath } from '../../common/groups/channel.utils';
import { parseFolderMentions } from '../../common/agents/agent-panel';
import { FOLDER_LISTING_LIMIT } from '../../common/agents/agent-panel.consts';
import {
    GREP_MAX_FILE_BYTES, GREP_MAX_FILES, GREP_MAX_MATCHES, GLOB_MAX_PATHS, compileGitignore, githubRepoFromRemote, globMatcher, grepMatcher,
    answerFromFiles, answerFromProject, asksAboutOpenProject, FILE_ANSWER_PATHS, fileQuestionGlob, globPaths, isPromptEcho, isTextCandidate, isWorkspaceTool, LIST_MAX_ENTRIES, numberLines, parseRgFiles, parseRgMatches,
    printsShellInsteadOfRunning, PROJECT_ENTRY_FILES, SHELL_NUDGE, shellReadsAsTools, textForRead,
    SKIPPED_DIRS, withRepoDefaults, WORKSPACE_TOOLS, workspaceProtocol, type GitHubRepo, type WorkspaceInfo
} from '../../common/agents/workspace-tools';
import { MAX_TOOL_RESULT_CHARS, MAX_TOOL_ROUNDS } from '../../common/project-config/project-config.consts';
import {
    CHECKS_PASSED_PREFIX, CONTINUE_NUDGE, EMPTY_REPLY_NUDGE, MAX_FIX_ATTEMPTS, MAX_TOOL_ROUNDS_CAP, MULTI_FILE_EDITS, REMOTE_BLOCKED, REVIEW_THEN_CHECKS, TOOL_ROUNDS_STOP, WORK_LOOP_PREFS
} from '../../common/agents/work-loop.consts';
import {
    WORK_LOOP_PROTOCOL, checkFailNudge, checkPassed, checksPassedNudge, commitBlockReason, cutEditNudge, detectChecks, promisesMoreWork, shellGitBlockReason, detectE2eFramework, e2eNudge, isRemoteCodeFetch,
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
import {
    applicableRules, expandCommand, findRule, findSkill, formatRuleIndex, formatRules, formatSkillIndex, offeredSkills, requestableRules
} from '../../common/project-config/project-config.utils';
import { formatEnvironment } from '../../common/project-config/environment.utils';
import type { IgnoreRules, ProjectCommand, ProjectRule } from '../../common/project-config/project-config.types';
import { FETCH_RULE_TOOL } from '../../common/project-config/project-config.consts';
import { AgentEventHooks } from '../hooks/agent-event-hooks';
import type { AgentHookEvent, AgentHookOutcome } from '../../common/hooks/agent-hooks.types';
import { hookBlockedText, hookOutcomeText } from '../../common/hooks/agent-hooks.utils';
import { HOOK_TEXT, TASK_SUBAGENT_TYPE } from '../../common/hooks/agent-hooks.consts';
import {
    afterMcpPayload, afterShellPayload, hookContextText, hookToolLabel, mcpPayload, postToolPayload, preCompactPayload, shellPayload, subagentStartPayload, subagentStopPayload,
    toolFailurePayload, toolFailureType, toolPayload, type HookToolCall
} from '../../common/hooks/hook-payloads.utils';
import { HabitRunner } from '../habits/habit-runner';
import { HABIT_TICKED_REPLY, USE_HABIT_TOOL } from '../../common/habits/playbook.consts';
import { stripHabitMarks } from '../../common/habits/playbook.utils';
import { cutAfterToolCalls, toolProtocol, type AgentToolCall } from '../../common/agents/agent-protocol';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AI_SETTINGS_PREFS, defaultAgentMode, defaultAgentModel } from '../../common/agents/ai-settings';
import { MADE_WITH_PREF, withMadeWith } from '../../common/git/made-with';
import { clampPieces, HARMONY_DEFAULTS, HARMONY_PREFS, harmonyLock, harmonyPrompt, isHeavyRun, pickHarmonyPiece, type HarmonyPiece } from '../../common/agents/harmony';
import { isHeavyRunWeight, runWeight } from '../../common/agents/rex-handoff';
import { LONG_RUN_MS } from '../../common/agents/rex-handoff.consts';
import {
    APPROVAL_PREFS, BUILTIN_TOOLS, BUILTIN_TOOL_SERVER, actionLine, builtinToolEnabled, builtinToolProtocol, describeAction, gitOperationFor, needsApproval, skippedResult, toAlwaysRunCommands, toAlwaysRunMap,
    unknownToolResult, updateAlwaysRun, updateAlwaysRunCommands, type AgentAction, type AlwaysRunCommands, type AlwaysRunMap, type ApprovalDecision, type ApprovalKind,
    type BuiltinToolSwitches
} from '../../common/agents/agent-actions';
import { ProcessStore } from '../processes/process-store';
import type { ImageChip } from '../../common/agents/composer-parts.types';
import { BrowserController } from '../browser-tool/browser-controller';
import { TestStore } from '../testing/test-store';
import { DEFAULT_TEST_ITERATIONS, RUN_TESTS_TOOL, TEST_LOOP_PREFS, TESTS_CAPPED_TEXT } from '../../common/testing/testing.consts';
import { clampIterations, formatForAgent, requestFromArgs, testLoopStep } from '../../common/testing/testing.utils';
import { BROWSER_READ_TOOLS, browserNeedsCard, browserToolSettings, browserToolsOn } from '../../common/browser-tool/browser-settings';
import { browserRunTask, consoleFilter, toTarget } from '../../common/browser-tool/browser-tool.utils';
import { BROWSER_RUN_COMMAND, BROWSER_RUN_NOTE, BROWSER_RUN_ONLY_TEXT } from '../../common/browser-tool/browser-tool.consts';
import { describeProcesses, isSafeScriptName, scriptCommand } from '../../common/processes/processes.utils';
import { OUTPUT_POLL_MS } from '../../common/processes/processes.consts';
import { truncateForEdit } from '../../common/agents/chat-thread';
import { SteerQueue } from '../../common/agents/steer-queue';
import { ASK_STOPPED, ASK_USER_TOOL } from '../../common/agents/chat-round.consts';
import { conflictWarning, stampThought, toggleReaction } from '../../common/agents/chat-round';
import type { ReactionKind } from '../../common/agents/chat-round.types';
import { runToolSettings, type RunToolSettings } from '../../common/processes/run-settings';
import { AgentActionsService, type AgentActionResult } from '../../common/agents/agent-actions-service';
import { GitService } from '../../common/git/git.types';
import { checkpoints, REVIEW_PREFS, reviewSettings, type ReviewSettings } from '../../common/review/review';
import { applyTextEdits, codeToolStep, findSymbolPosition, formatDiagnostics, formatLocations, isCodeEditTool, isCodeTool, parseNewName, parseSymbolTarget, severityFilter } from '../../common/agents/code-tools';
import { CodeToolsService, type CodeEditResult } from './code-tools-service';
import { CodebaseIndexStore } from '../codebase-index/codebase-index-store';
import { CODEBASE_SEARCH_TOOL, INDEX_DIR } from '../../common/codebase-index/codebase-index.consts';
import { formatSearchResult } from '../../common/codebase-index/codebase-index.utils';
import { AgentPolicyService } from '../policy/agent-policy-service';
import { AgentAuditLog } from '../policy/agent-audit-log';
import { SANDBOX_TEXT } from '../../common/policy/agent-policy.consts';
import type { PolicyDecision, SandboxSpec } from '../../common/policy/agent-policy.types';
import { autoRunGuidanceText } from '../../common/policy/cursor-policy.utils';
import {
    checkEdit, checkToolCall, outsideApproval, policyBlockedText, policySourceOf, sandboxRetryApproval, sandboxSpec
} from '../../common/policy/agent-policy.utils';
import type { AuditDecision, AuditEntryInput } from '../../common/audit/agent-audit.types';
import { toolSummary } from '../../common/audit/agent-audit.utils';
import { GOAL_BUDGET_TEXT, GOAL_DONE_TEXT, GOAL_PREFS, GOAL_STOPPED_TEXT, GOAL_USAGE } from '../../common/agents/goal.consts';
import { applyGoalCheck, createGoal, decideGoal, goalLimits, goalProtocol, parseGoalCheck, parseGoalCommand, stripGoalCheck } from '../../common/agents/goal';
import type { GoalStopReason } from '../../common/agents/goal.types';
import { customModeFrom, customModePrompt, findModeCommand } from '../../common/agents/custom-mode';
import type { CustomMode } from '../../common/agents/custom-mode.types';
import { NETWORK_OFF_ENV } from '../../common/sandbox/sandbox.consts';
import type { SandboxCheck } from '../../common/sandbox/sandbox.types';
import { blocksNetwork, checkSandbox, editIntent, gateDecision, refusalText, sandboxNote, toolIntent } from '../../common/sandbox/sandbox.utils';
import { SandboxPresetService } from '../sandbox/sandbox-preset-service';
import { AutoReviewer } from '../sandbox/auto-reviewer';
import { ArtifactService } from '../artifacts/artifact-service';
import { ARTIFACT_TOOL } from '../../common/artifacts/artifacts.consts';
import { parseArtifactArgs } from '../../common/artifacts/artifacts.utils';
import { isTaskCall, parseTaskArgs, taskChildPrompt, taskResultText, worktreeBranch, worktreeName } from '../../common/agents/subagent-task';
import { MAX_PARALLEL_TASKS, NESTED_TASK_ERROR, SUBAGENT_STEP_PREFIX, TASK_TOOL, TOO_MANY_TASKS } from '../../common/agents/subagent-task.consts';
import type { TaskOutcome, TaskRequest } from '../../common/agents/subagent-task.types';
import { DecisionLedger } from '../decisions/decision-ledger';
import { FrozenStore } from '../frozen/frozen-store';
import { AntiHabitStore } from '../doom-loop/anti-habit-store';
import { DECISION_ASK_OPTIONS, DECISION_NOTES, DECISIONS_PROTOCOL } from '../../common/decisions/decisions.consts';
import type { DecisionConflict } from '../../common/decisions/decisions.types';
import { addedLines, conflictQuestion, decisionKey, decisionMarks, decisionsToCapture, formatDecisions, keptDecisionNote } from '../../common/decisions/decisions.utils';
import { FROZEN_ASK_OPTIONS, FROZEN_NOTES } from '../../common/frozen/frozen.consts';
import { formatFrozen, frozenQuestion, isTestCommand, keptFrozenNote } from '../../common/frozen/frozen.utils';
import { DEFAULT_MAX_REPEATS, DOOM_ACTIONS, DOOM_MESSAGES, DOOM_NOTE, DOOM_PREFS, MIN_MAX_REPEATS } from '../../common/doom-loop/doom-loop.consts';
import type { DoomState } from '../../common/doom-loop/doom-loop.types';
import { detectDoom, differentApproachNudge, formatAntiHabits, observeEdit, observeReply, observeResult, startDoom } from '../../common/doom-loop/doom-loop.utils';
import type { HabitEvent, HabitNoteInfo } from '../../common/habits/habits.types';
import { HABIT_NOTE_LABELS, HABIT_NOTE_TEXT } from '../../common/habits/habits.consts';
import { habitNoteDetail, savedHabitFocus, savedHabitKey } from '../../common/habits/habits.utils';

/** What the user chose when the agent was about to contradict a locked decision or change a frozen zone. */
type GuardChoice = 'keep' | 'allow' | 'release' | 'stopped';
/** After the guards: the agent should revise (edits were kept out), or the user stopped the run. */
type GuardOutcome = 'revise' | 'stopped' | undefined;
import { FreshContextService } from '../fresh-context/fresh-context-service';
import { PlanReviewService } from '../plan-review/plan-review-service';
import { ModelRouter } from '../router/model-router';
import type { LearnedHabit } from '../../common/habits/learned.types';
import { learnedLabel, learnedPrefFocus } from '../../common/habits/learned.utils';
import { CONTINUE_PROMPT } from '../../common/fresh-context/fresh-context.consts';
import type { RotVerdict } from '../../common/fresh-context/fresh-context.types';
import { briefPath, briefPrompt, buildBrief, changesDiff, countFailures, countTurns, freshTitle, offerAllowed, recentFailures, rotSummary } from '../../common/fresh-context/fresh-context.utils';
import { reviewHeadline } from '../../common/plan-review/plan-review.utils';
import { classifyTask, taskTypeLabel } from '../../common/router/router.utils';
import { DEFAULT_SYSTEM_TOKENS } from '../../common/cost/cost.consts';
import { DEFAULT_RESEARCH_COST_USD, RESEARCH_POLL_MS, RESEARCH_STOPPED, RESEARCH_TOOL } from '../../common/research/research.consts';
import { ResearchService, type ResearchPoll, type ResearchView } from '../../common/research/research.types';
import { applyResearchEvent, emptyResearch, researchErrorText, researchToolResult, stripResearchFooter } from '../../common/research/research.utils';

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
    @inject(RuleHitsStore) @optional() protected readonly ruleHits?: RuleHitsStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(AgentActionsService) protected readonly actions: AgentActionsService;
    @inject(GitService) protected readonly git: GitService;
    @inject(WorktreeSetupService) protected readonly worktreeSetup: WorktreeSetupService;
    @inject(ZaprexLauncher) protected readonly zaprex: ZaprexLauncher;
    @inject(ZaprexDesktopService) protected readonly zaprexDesktop: ZaprexDesktopService;
    /** IDEA-185: pieces handed to the Zaprex desktop app, by child chat id; the lead waits on them. */
    protected readonly handoffs = new Map<string, Promise<void>>();
    @inject(ProcessStore) protected readonly processes: ProcessStore;
    @inject(BrowserController) protected readonly browser: BrowserController;
    @inject(TestStore) protected readonly tests: TestStore;
    /** IDEA-261: red run_tests results in the current user turn, capped by the max-iterations setting. */
    protected readonly testIterations = new Map<string, number>();
    @inject(ResearchService) protected readonly research: ResearchService;
    /** IDEA-109: runs waiting on the approval card, per session. */
    protected readonly approvals = new Map<string, (choice: { decision: ApprovalDecision; reason?: string; stopped?: boolean }) => void>();
    /** IDEA-105: paused runs waiting for Continue (or the countdown), per session. */
    protected readonly pauses = new Map<string, { resolve: (go: boolean) => void; timer?: ReturnType<typeof setTimeout> }>();
    /** Live edit views started while a reply streams, keyed by chat, message and path. */
    protected readonly streamingEdits = new Map<string, Promise<string | undefined>>();
    /** IDEA-248: work-loop state for the current user turn, not saved with the chat. */
    protected readonly loops = new Map<string, LoopState>();
    /** IDEA-267: IDE context attached to the latest user turn, per chat; not saved with the chat. */
    protected readonly autoContexts = new Map<string, AutoAttach>();
    /** Chats whose model loop is on the stack, so accepting a review does not start a second one. */
    protected readonly modelLoops = new Set<string>();
    /** Answers waiting on ingot/ask_user. Undefined means the user stopped. */
    protected readonly answers = new Map<string, (text: string | undefined) => void>();
    /** Messages typed while a run is in progress, delivered on the next round. */
    protected readonly steers = new Map<string, string[]>();
    /** IDEA-280: steer messages the model has not read yet (shown with a "Queued" chip). */
    protected readonly queuedSteers = new SteerQueue<AgentMessage>();
    /** IDEA-289: chats whose current run was started with /browser (the browser tools are on until it ends). */
    protected readonly browserRuns = new Set<string>();
    /** Nested runModel calls for one chat. The set stays until the outermost call returns. */
    protected readonly loopDepth = new Map<string, number>();
    /** Bumped by send and stop so a replaced or stopped turn cannot keep writing. */
    protected readonly loopGeneration = new Map<string, number>();
    /** When each chat's current run started; a long run counts as heavy for "Hand off to Rex". */
    protected readonly runStarted = new Map<string, number>();
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
    /** IDEA-292: the agent message each goal last self-checked, so one reply never counts twice. */
    protected readonly goalChecked = new Map<string, number>();
    protected pokeTimer?: ReturnType<typeof setTimeout>;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;
    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(MemoryStore) protected readonly memoryStore: MemoryStore;
    @inject(AgentHooksService) protected readonly hooks: AgentHooksService;
    @inject(AgentEventHooks) protected readonly eventHooks: AgentEventHooks;
    @inject(HabitRunner) protected readonly habitRunner: HabitRunner;
    @inject(DecisionLedger) protected readonly decisions: DecisionLedger;
    @inject(FrozenStore) protected readonly frozen: FrozenStore;
    @inject(AntiHabitStore) protected readonly antiHabits: AntiHabitStore;
    /** IDEA-304: what the current turn tried, per chat (reset by each user message and by "Try a different approach"). */
    protected readonly dooms = new Map<string, DoomState>();
    /** IDEA-302: decisions being written for a just-sent message; the run waits so the note lands before the reply. */
    protected readonly captures = new Map<string, Promise<void>>();
    /** IDEA-302 / IDEA-303: chats whose open question comes from a guard, not from ingot/ask_user. */
    protected readonly guardAsks = new Set<string>();
    @inject(FreshContextService) protected readonly freshContext: FreshContextService;
    @inject(PlanReviewService) protected readonly planReview: PlanReviewService;
    @inject(ModelRouter) protected readonly router: ModelRouter;
    /** IDEA-307: chats whose next run decides a route (set by send), and sends that never route (Build). */
    protected readonly routePending = new Set<string>();
    protected readonly noRoute = new Set<string>();
    /** IDEA-307: chats whose routed turn was already counted for Habits. */
    protected readonly routeCounted = new Set<string>();
    /** IDEA-305: chats already handed off to a fresh chat. */
    protected readonly handedOff = new Set<string>();
    /** IDEA-287: the rules loaded for a chat's last turn, for ingot/fetch_rule. */
    protected readonly sessionRules = new Map<string, readonly ProjectRule[]>();
    /** IDEA-287: the skills loaded for a chat's last turn, for ingot/fetch_rule. */
    protected readonly sessionSkills = new Map<string, readonly ProjectCommand[]>();
    /** IDEA-287: chats whose sessionStart hook ran, with the env and context it returned. */
    protected readonly hookSessions = new Map<string, { startedAt: number; env?: Readonly<Record<string, string>>; context?: string }>();
    /** IDEA-287: chats whose next run checks the prompt with beforeSubmitPrompt (set by send). */
    protected readonly submitPending = new Set<string>();
    /** IDEA-287: stop-hook follow-ups already sent per chat (`loop_count`). */
    protected readonly hookLoops = new Map<string, number>();
    /** IDEA-287: chats compacted at least once (preCompact's `is_first_compaction`). */
    protected readonly compacted = new Set<string>();
    /** IDEA-287: runs that ended because beforeSubmitPrompt blocked the prompt (no stop hook for those). */
    protected readonly promptBlocked = new Set<string>();
    protected readonly onDidSendEmitter = new Emitter<{ session: AgentSession; prompt: string }>();
    /** IDEA-296: a prompt the user sent (Habits counts repeated instructions). */
    readonly onDidSend: Event<{ session: AgentSession; prompt: string }> = this.onDidSendEmitter.event;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(RulesToolsService) @optional() protected readonly rulesTools?: RulesToolsService;
    @inject(CodeToolsService) protected readonly codeTools: CodeToolsService;
    @inject(CodebaseIndexStore) protected readonly codebaseIndex: CodebaseIndexStore;
    @inject(AgentPolicyService) protected readonly policy: AgentPolicyService;
    @inject(AgentAuditLog) protected readonly audit: AgentAuditLog;
    @inject(SandboxPresetService) protected readonly sandbox: SandboxPresetService;
    @inject(AutoReviewer) protected readonly autoReviewer: AutoReviewer;
    @inject(ArtifactService) protected readonly artifacts: ArtifactService;
    protected persistTimer?: ReturnType<typeof setTimeout>;
    /** Remove the auto-attached open file from the next new chat. */

    /** IDEA-266: the workspace this window's chats belong to; undefined in a window without a folder (nothing is saved). */
    protected windowWorkspace?: string;

    @postConstruct()
    protected restore(): void {
        void this.workspace.ready.then(() => this.loadWindowChats());
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

    /** IDEA-266: a new window does not copy another window's chats; it shows the chats of its own workspace only. */
    protected loadWindowChats(): void {
        this.windowWorkspace = this.workspace.workspace?.resource.toString();
        const loaded = windowChats(parseChats(localStorage.getItem(CHATS_STORAGE_KEY)), this.windowWorkspace);
        const ids = new Set(this.items.map(s => s.id));
        this.items = [...this.items, ...loaded.filter(s => !ids.has(s.id))];
        this.selected ??= this.tabs[0]?.id;
        this.onDidChangeEmitter.fire();
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
    protected readonly onDidSendPromptEmitter = new Emitter<SentPromptEvent>();
    /** IDEA-328: what the user typed to an agent, for learned rules. */
    readonly onDidSendPrompt: Event<SentPromptEvent> = this.onDidSendPromptEmitter.event;

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
        const removed = this.items.find(s => s.id === id);
        if (removed && this.hookSessions.has(id)) {
            void this.runEventHook(removed, 'sessionEnd', {
                session_id: id, reason: 'user_close', duration_ms: Date.now() - (this.hookSessions.get(id)?.startedAt ?? Date.now()), is_background_agent: !!removed.parent,
                final_status: removed.status === 'error' ? 'error' : 'completed'
            }).finally(() => this.forgetHookSession(id));
        }
        this.items = this.items.filter(s => s.id !== id);
        this.changed();
    }

    protected forgetHookSession(id: string): void {
        [this.hookSessions, this.hookLoops].forEach(map => map.delete(id));
        [this.submitPending, this.compacted, this.promptBlocked].forEach(set => set.delete(id));
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
    send(prompt: string, chips: readonly ContextChip[] = [], composed?: ComposedMessage, auto?: AutoAttach): AgentSession {
        const session = this.current ?? this.create();
        const routable = !this.noRoute.delete(session.id);
        const askedNow = prompt.trim();
        if (session.ask && askedNow) {
            this.answerQuestion(session.id, askedNow);
            return session;
        }
        if (askedNow && this.isRunning(session.id)) {
            this.startBrowserRun(session, askedNow);
            const steer: AgentMessage = { role: 'user', text: askedNow };
            session.messages.push(steer);
            this.queuedSteers.add(session.id, steer);
            this.onDidSendPromptEmitter.fire({ sessionId: session.id, text: askedNow });
            this.steers.set(session.id, [...(this.steers.get(session.id) ?? []), askedNow]);
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        const goalCommand = parseGoalCommand(askedNow);
        if (session.goal && session.goal.state !== 'running') {
            session.goal = undefined;
        }
        if (goalCommand && !goalCommand.objective) {
            session.messages.push({ role: 'user', text: askedNow }, { role: 'system', text: GOAL_USAGE });
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        if (session.title === NEW_AGENT_TITLE) {
            const titled = goalCommand?.objective ?? prompt;
            session.title = tabTitleFromText(titled) || titleFromPrompt(titled);
        }
        session.mode = this.mode;
        session.model = this.model;
        if (goalCommand) {
            session.goal = createGoal(goalCommand, goalLimits(key => this.preferences.get(GOAL_PREFS[key])), Date.now());
            this.goalChecked.delete(session.id);
            session.messages.push({ role: 'user', text: askedNow, expanded: `Goal: ${goalCommand.objective}` });
        } else if (composed && (composed.chips.length || composed.images.length)) {
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
        this.attachAutoContext(session, auto);
        this.browserRuns.delete(session.id);
        if (this.startBrowserRun(session, askedNow)) {
            const sent = session.messages[session.messages.length - 1];
            const full = sent.expanded ?? sent.text;
            session.messages[session.messages.length - 1] = { ...sent, expanded: `${BROWSER_RUN_NOTE}\n\n${browserRunTask(full) ?? full}` };
        }
        const asked = prompt.trim();
        if (asked && !asked.startsWith('/')) {
            this.onDidSendPromptEmitter.fire({ sessionId: session.id, text: composed?.text.trim() || asked });
        }
        this.testIterations.delete(session.id);
        this.loops.set(session.id, this.newLoop(asked));
        this.dooms.delete(session.id);
        session.doom = undefined;
        if (asked) {
            this.captureDecisions(session, composed?.text ?? asked, session.messages.length - 1);
        }
        session.route = undefined;
        session.handoffOffer = undefined;
        this.routeCounted.delete(session.id);
        if (this.commandHandlers.some(handle => handle(session, prompt.trim()))) {
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        if (asked) {
            this.onDidSendEmitter.fire({ session, prompt: composed?.text ?? asked });
        }
        if (this.flags.forceUpdate) {
            session.messages.push({ role: 'system', text: UPDATE_TEXT.chatBlocked });
            session.status = 'idle';
            session.updatedAt = Date.now();
            this.changed();
            return session;
        }
        if (session.mode === 'research') {
            this.startResearchTurn(session, asked);
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
        if (routable && asked) {
            this.routePending.add(session.id);
        }
        if (asked) {
            this.submitPending.add(session.id);
        }
        this.hookLoops.delete(session.id);
        this.startRun(session);
        return session;
    }

    protected newLoop(prompt: string): LoopState {
        return {
            prompt, wants: this.workLoopOn() && wantsWorkLoop(prompt), edits: [], checks: [], fixAttempts: 0,
            e2eNudged: false, commitNudged: false, commitBlocked: false, committed: false, verifiedEdits: 0, required: []
        };
    }

    /** Starts a new turn of the model loop for a chat (send, a handoff, Use original). */
    protected startRun(session: AgentSession): void {
        session.status = 'thinking';
        session.updatedAt = Date.now();
        const generation = (this.loopGeneration.get(session.id) ?? 0) + 1;
        this.loopGeneration.set(session.id, generation);
        this.cancelled.delete(session.id);
        this.runStarted.set(session.id, Date.now());
        // The run turns heavy once it has been going this long, even without any other change to re-render on.
        setTimeout(() => this.generationFor(session.id) === generation && this.isRunning(session.id) && this.changed(), LONG_RUN_MS);
        this.changed();
        this.runModel(session, generation).finally(() => {
            if (this.generationFor(session.id) === generation) {
                this.browserRuns.delete(session.id);
            }
            this.browser.endAgentRun(session.id);
        });
    }

    /** IDEA-307: tokens the chat's next request re-sends (history) and the system part measured on its last request. */
    requestTokens(session: AgentSession | undefined): { history: number; system?: number } {
        const usage = session?.context?.usage;
        return {
            history: session ? estimateTokens(this.historyFor(session).map(m => m.content).join('\n')) : 0,
            ...(usage ? { system: usage.system + usage.rules + usage.files + usage.memories } : {})
        };
    }

    /** The model a chat's requests go to: the router's pick for this turn, else the chat's model. */
    modelFor(session: AgentSession): string {
        const routed = session.route?.to;
        return routed && this.models.isModelConfigured(routed) ? routed : this.resolveModel(session.model);
    }

    /** IDEA-267: the composer's IDE-context chips go to the model with this turn and show under the user message. */
    protected attachAutoContext(session: AgentSession, auto: AutoAttach | undefined): void {
        if (!auto) {
            this.autoContexts.delete(session.id);
            return;
        }
        this.autoContexts.set(session.id, auto);
        const last = session.messages.length - 1;
        if (auto.items.length && session.messages[last]?.role === 'user') {
            session.messages[last] = { ...session.messages[last], auto: sentAutoContext(auto.items) };
        }
    }

    /** IDEA-289: a message starting with /browser turns the browser tools on for this run and shows the panel. */
    protected startBrowserRun(session: AgentSession, prompt: string): boolean {
        if (browserRunTask(prompt) === undefined || this.projectCommands.some(c => c.name === BROWSER_RUN_COMMAND)) {
            return false;
        }
        this.browserRuns.add(session.id);
        if (browserToolSettings(key => this.preferences.get(key)).enabled) {
            void this.browser.open(false);
        }
        return true;
    }

    /** IDEA-289: whether this chat's run gets the browser tools (Settings, plus /browser unless offered in every run). */
    protected browserOn(session: AgentSession): boolean {
        return browserToolsOn(browserToolSettings(key => this.preferences.get(key)), this.browserRuns.has(session.id));
    }

    isRunning(id: string | undefined): boolean {
        return !!id && !this.cancelled.has(id) && (this.running.has(id) || this.modelLoops.has(id));
    }

    /** The user stopped this chat's last run (cleared when they send again). */
    wasStopped(id: string): boolean {
        return this.cancelled.has(id);
    }

    /**
     * IDEA-290: a message for a chat from outside the composer (an artifact comment). A running chat reads it on its
     * next round, like a message typed during the run; an idle chat starts a new turn with it.
     */
    steer(sessionId: string, text: string): 'steered' | 'sent' | undefined {
        const session = this.items.find(s => s.id === sessionId);
        const trimmed = text.trim();
        if (!session || !trimmed) {
            return undefined;
        }
        if (this.isRunning(sessionId)) {
            const message: AgentMessage = { role: 'user', text: trimmed };
            session.messages.push(message);
            this.queuedSteers.add(sessionId, message);
            this.steers.set(sessionId, [...(this.steers.get(sessionId) ?? []), trimmed]);
            session.updatedAt = Date.now();
            this.changed();
            return 'steered';
        }
        this.reopen(sessionId);
        this.send(trimmed);
        return 'sent';
    }

    /** Stops a streaming agent (Stop button / Escape). */
    stop(id: string): void {
        // IDEA-291: a chat's task subagents stop with it.
        this.items.filter(s => s.parent === id && s.agent !== 'zaprex' && this.isRunning(s.id)).forEach(child => this.stop(child.id));
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
        this.queuedSteers.take(id);
        this.browserRuns.delete(id);
        const session = this.items.find(s => s.id === id);
        if (session) {
            session.ask = undefined;
            if (session.goal?.state === 'running') {
                this.endGoal(session, 'user', GOAL_STOPPED_TEXT);
            }
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

    /** `guard`: asked by a Decisions / Frozen Zones check, so the answer is not read as confirming a decision. */
    protected waitForAnswer(session: AgentSession, question: string, options: readonly string[], guard = false): Promise<string | undefined> {
        session.ask = { question, ...(options.length ? { options } : {}) };
        if (guard) {
            this.guardAsks.add(session.id);
        } else {
            this.guardAsks.delete(session.id);
        }
        this.changed();
        return new Promise(resolve => {
            this.answers.set(session.id, text => {
                this.guardAsks.delete(session.id);
                resolve(text);
            });
        });
    }

    /** IDEA-280: a message typed during the run that the model has not read yet. */
    isQueued(sessionId: string, message: AgentMessage): boolean {
        return this.queuedSteers.has(sessionId, message);
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
        const question = session.ask.question;
        session.ask = undefined;
        session.messages.push({ role: 'user', text: trimmed });
        if (!this.guardAsks.has(sessionId)) {
            this.captureDecisions(session, trimmed, session.messages.length - 1, decisionMarks(question));
        }
        session.updatedAt = Date.now();
        this.changed();
        resolve(trimmed);
    }

    /**
     * IDEA-302: a user message locks the decisions it states outright, and the agent's `DECISION:` proposals (in the
     * reply before it, or in the question it answers) when it confirms them. Shows "Locked in Decisions" in the chat.
     */
    protected captureDecisions(session: AgentSession, text: string, userIndex: number, extra: readonly string[] = []): void {
        const root = this.rootFor(session);
        const previous = session.messages.slice(0, userIndex).reverse().find(m => m.role === 'agent' && (m.expanded ?? m.text));
        const proposals = [...decisionMarks(previous ? previous.expanded ?? previous.text : ''), ...extra];
        const texts = decisionsToCapture(text, proposals);
        if (!root || !texts.length) {
            return;
        }
        const work = this.decisions.capture(root, texts).then(({ captured, promoted }) => {
            captured.forEach(d => this.addNote(session, { kind: 'decision', text: DECISION_NOTES.locked, detail: d.text, ref: d.id }));
            promoted.forEach(d => this.addNote(session, { kind: 'habit', text: DECISION_NOTES.habit, detail: `${d.text} → ${d.habit}`, focus: savedHabitFocus(savedHabitKey('decision', decisionKey(d.text))) }));
        }, (error: unknown) => {
            session.messages.push({ role: 'system', text: `Could not save the decision: ${error instanceof Error ? error.message : String(error)}` });
            this.changed();
        });
        this.captures.set(session.id, work);
    }

    /** IDEA-302..304: a silver "saved" note in the chat (never sent to the model). */
    addNote(session: AgentSession, note: HabitNoteInfo): void {
        const text = note.text ?? HABIT_NOTE_TEXT[note.kind];
        session.messages.push({ role: 'system', text: note.detail ? `${text}: ${note.detail}` : text, note });
        session.updatedAt = Date.now();
        this.changed();
    }

    /** The note's undo: unlock the decision or unfreeze the zone it saved. */
    async undoNote(sessionId: string, index: number): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        const note = message?.note;
        if (!session || !message || !note?.ref || note.undone) {
            return;
        }
        const root = this.rootFor(session);
        if (note.kind === 'decision') {
            await this.decisions.setLocked(note.ref, false, root);
        } else if (note.kind === 'frozen') {
            await this.frozen.unfreeze(note.ref, root);
        }
        session.messages[index] = { ...message, note: { ...note, undone: true } };
        this.addNote(session, { kind: note.kind, text: note.kind === 'decision' ? DECISION_NOTES.unlocked : FROZEN_NOTES.unfrozen, detail: note.detail });
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

    /** Root the agent works in: its worktree (IDEA-268), its project (groups) or the first workspace root. */
    rootFor(session: AgentSession): URI | undefined {
        if (session.worktree) {
            return new URI(session.worktree.path);
        }
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
            const ignore = await this.agentIgnore(root);
            for (const mention of parseMentions(prompt).filter(isSafeRelativePath).filter(m => !ignore.agent(m))) {
                await add(root.resolve(mention));
            }
            for (const folder of parseFolderMentions(prompt).filter(path => isSafeRelativePath(path.slice(0, -1)))) {
                const stat = await this.files.resolve(root.resolve(folder.slice(0, -1))).catch(() => undefined);
                if (stat?.isDirectory) {
                    const names = (stat.children ?? []).slice(0, FOLDER_LISTING_LIMIT).map(child => `${child.name}${child.isDirectory ? '/' : ''}`);
                    files.push({ path: folder, content: names.join('\n') });
                }
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
        const model = findModel(this.modelFor(session));
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

    /** IDEA-323: which `.ingot/rules` agents actually use, for `ingot rules prune`; best effort, never blocks the turn. */
    protected recordRuleHits(root: URI | undefined, rules: readonly ProjectRule[]): void {
        const paths = rules.filter(rule => rule.source === 'ingot').map(rule => rule.path);
        if (root && paths.length && this.rulesTools) {
            this.rulesTools.recordRuleHits(root.path.fsPath(), paths).catch(() => undefined);
        }
    }

    protected async runModel(session: AgentSession, generation = this.generationFor(session.id)): Promise<void> {
        this.enterLoop(session.id);
        try {
        if (this.stale(session.id, generation)) {
            return;
        }
        await this.captures.get(session.id);
        this.captures.delete(session.id);
        const root = this.rootFor(session);
        if (this.loopDepth.get(session.id) === 1 && !await this.hookTurnStart(session, root)) {
            this.promptBlocked.add(session.id);
            return;
        }
        if (this.loopDepth.get(session.id) === 1) {
            this.artifacts.begin(session, root);
        }
        const config = await this.projectConfig.load(root);
        this.projectCommands = config.commands;
        const lastUser = session.messages.map((m, i) => ({ m, i })).reverse().find(x => x.m.role === 'user');
        if (lastUser && lastUser.m.text.startsWith('/') && !parseGoalCommand(lastUser.m.text)) {
            const expansion = expandCommand(lastUser.m.text, config.commands);
            if (expansion) {
                session.messages[lastUser.i] = { ...lastUser.m, expanded: lastUser.m.expanded ? lastUser.m.expanded.replace(lastUser.m.text, expansion.text) : expansion.text };
                session.steps = [{ kind: 'run', target: `/${expansion.command.name}`, done: true }];
            }
        }
        const prompt = lastUser ? (session.messages[lastUser.i].expanded ?? lastUser.m.text) : '';
        if (this.routePending.delete(session.id) && lastUser) {
            await this.routeTurn(session, lastUser.m.text, (lastUser.m.chips?.length ?? 0) + parseMentions(prompt).length);
        }
        const context = await this.readContext(session, prompt, root);
        // Glob rules still match the file open in the editor; its content is not attached (the agent reads files via tools).
        const active = this.editors.currentEditor?.editor.uri;
        const activePath = active && root?.isEqualOrParent(active) ? root.relative(active)?.toString() : undefined;
        // IDEA-287: nested rules also follow files the agent read or edited earlier in this chat.
        const contextFiles = [...new Set([...context.paths, ...(activePath ? [activePath] : []), ...this.touchedPaths(session)])];
        const rules = applicableRules(config.rules, contextFiles);
        this.sessionRules.set(session.id, config.rules);
        this.sessionSkills.set(session.id, config.commands.filter(c => c.kind === 'skill'));
        this.ruleHits?.record({ sessionId: session.id, prompt, files: contextFiles, rules, root: root?.path.fsPath() });
        this.recordRuleHits(root, rules);
        const info = session.subagent?.readonly ? { ...modeInfo(session.mode), canEdit: false } : modeInfo(session.mode);
        const tools = info.canUseTools ? this.mcp.connectedTools : [];
        const subagents = info.canUseTools && !session.parent ? await this.projectConfig.loadSubagents(root).catch(() => []) : [];
        const auto = this.autoContexts.get(session.id);
        const memories = auto?.skipMemories ? [] : relevantMemories(await this.memoryStore.load(root).catch(() => []), prompt);
        const workspace = await this.workspaceInfo(root);
        this.github = workspace.github;
        const base = [
            AGENT_SYSTEM_PROMPTS[session.mode], session.customMode ? customModePrompt(session.customMode, config.commands) : '',
            session.goal?.state === 'running' ? goalProtocol(session.goal) : '',
            info.canEdit ? AGENT_WORKFLOW : '', info.canEdit ? AGENT_PROTOCOL : '', info.canUseTools ? TOOL_CALL_FORMAT : '',
            info.canEdit && root ? WORK_LOOP_PROTOCOL : '', root ? workspaceProtocol(workspace) : '', toolProtocol(tools),
            info.canUseTools ? builtinToolProtocol(this.toolSwitches(session)) : '', formatSubagents(subagents), this.memoryStore.generate ? MEMORY_PROTOCOL : '',
            session.parent ? '' : FOLLOW_UPS_PROTOCOL
        ].filter(Boolean).join('\n\n');
        const environment = await this.projectConfig.loadEnvironment(root).catch(() => undefined);
        const fetchTool = `${BUILTIN_TOOL_SERVER}/${FETCH_RULE_TOOL}`;
        const rulesText = [
            formatRules(rules), info.canUseTools ? formatRuleIndex(requestableRules(config.rules), fetchTool) : '',
            info.canUseTools ? formatSkillIndex(offeredSkills(config.commands, contextFiles), fetchTool) : '',
            formatEnvironment(environment?.environment, environment?.source ?? ''), this.hookSessions.get(session.id)?.context ?? ''
        ].filter(Boolean).join('\n\n');
        const habitText = await this.habitRunner.prepare(session, {
            root, prompt: lastUser?.m.text ?? '', attachments: prompt, canUseTools: info.canUseTools,
            files: [...new Set([...context.paths, ...(activePath ? [activePath] : []), ...(lastUser?.m.chips ?? []).map(c => c.path).filter(Boolean)])]
        });
        const guardText = await this.guardPrompt(root, info.canEdit);
        const memoriesText = formatMemories(memories);
        // IDEA-306: Plan mode follows the plan template Habits learned for this kind of task.
        const planTemplateText = session.mode === 'plan' ? await this.planReview.templateFor(classifyTask(lastUser?.m.text ?? '')).catch(() => '') : '';
        const autoText = formatAutoContext(auto?.items ?? []);
        const system = [base, rulesText, habitText, planTemplateText, guardText, memoriesText, context.text, autoText].filter(Boolean).join('\n\n');
        const model = findModel(this.modelFor(session));
        session.context = {
            files: context.paths, rules: rules.map(r => r.name), memories: memories.map(m => ({ id: m.id, text: m.text })),
            usage: contextUsage({
                system: estimateTokens(base), rules: estimateTokens(rulesText) + estimateTokens(habitText) + estimateTokens(planTemplateText) + estimateTokens(guardText),
                files: estimateTokens([context.text, autoText].join('\n')), memories: estimateTokens(memoriesText),
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
        let retriedEmpty = false;
        let redirected = false;
        let edited = false;
        let followUps: string[] = [];
        const rounds = this.maxToolRounds();
        try {
            for (let round = 0; ; round++) {
                if (this.gaveUp(session, generation)) {
                    return;
                }
                if (session.goal?.state === 'running' && session.goal.tokensUsed >= session.goal.tokenBudget) {
                    this.endGoal(session, 'budget', GOAL_BUDGET_TEXT);
                    session.status = 'idle';
                    this.changed();
                    return;
                }
                if (round > 0 && await this.breakDoomLoop(session, root)) {
                    return;
                }
                if (round > 0 && !session.parent && await this.freshContext.failingNow(session.messages)) {
                    // IDEA-305 auto mode: a failure streak stops the run and a fresh chat takes over from a brief.
                    session.messages.push({ role: 'system', text: `Stopped after ${countFailures(session.messages)} failed attempts: continuing in a fresh chat.` });
                    session.status = 'idle';
                    void this.handOffFresh(session.id, { auto: true });
                    return;
                }
                const parsed = await this.streamRound(session, system);
                if (this.stale(session.id, generation)) {
                    return;
                }
                if (parsed?.plan.length) {
                    await this.artifacts.writePlan(session, parsed.plan).catch(() => undefined);
                }
                if (!parsed) {
                    if (session.status !== 'error' && session.status !== 'idle' && session.status !== 'review') {
                        session.status = 'idle';
                        this.changed();
                    }
                    return;
                }
                followUps = parsed.followUps;
                const agentIndex = session.messages.map(m => m.role).lastIndexOf('agent');
                const agentText = session.messages[agentIndex]?.text ?? '';
                const asked = lastUser?.m.text ?? prompt;
                const echoed = isPromptEcho(agentText, prompt) || isPromptEcho(agentText, asked);
                const scaffold = this.libraryTemplateOn() ? parseLibraryPrompt(asked) ?? parseLibraryPrompt(prompt) : undefined;
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
                if (!retriedEmpty && round < rounds && !parsed.display.trim() && !parsed.edits.length && !parsed.toolCalls.length && !parsed.editing) {
                    retriedEmpty = true;
                    this.hidePrinted(session, agentIndex);
                    session.messages.push({ role: 'user', text: EMPTY_REPLY_NUDGE, hidden: true });
                    continue;
                }
                const recovered = !parsed.toolCalls.length && round < rounds ? shellReadsAsTools(agentText) : [];
                if (recovered.length) {
                    this.hidePrinted(session, agentIndex);
                    if (info.canEdit && parsed.edits.length) {
                        edited = true;
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
                // IDEA-267: an overview of the repo is not an answer to "fix…" or "explain src/x.ts". Send it back once.
                const misread = !parsed.toolCalls.length && !parsed.edits.length && !redirected && round < rounds ? misreadTask(asked, agentText, edited) : undefined;
                if (misread && (misread === 'explain' || info.canEdit)) {
                    redirected = true;
                    this.hidePrinted(session, agentIndex);
                    session.messages.push({ role: 'user', text: misread === 'act' ? ACT_NUDGE : EXPLAIN_NUDGE, hidden: true });
                    continue;
                }
                if (!info.canEdit && parsed.plan.length) {
                    const choice = await this.checkPlan(session, parsed.plan, root);
                    if (choice === 'stopped' || this.stale(session.id, generation)) {
                        return;
                    }
                    if (choice === 'keep' && round < rounds) {
                        continue;
                    }
                }
                const applied = info.canEdit && parsed.edits.length > 0;
                if (applied) {
                    edited = true;
                    const guarded = await this.applyParsedEdits(session, parsed.edits, parsed.plan, root);
                    if (guarded === 'stopped' || this.gaveUp(session, generation)) {
                        return;
                    }
                    if (guarded === 'revise' && !parsed.toolCalls.length && round < rounds) {
                        continue;
                    }
                }
                const cut = info.canEdit && parsed.editing && round < rounds ? parsed.editing : undefined;
                if (cut) {
                    await this.tracker.cancelStream(session.id, cut);
                }
                if (parsed.toolCalls.length && round < rounds) {
                    if (!await this.finishTools(session, generation, parsed.toolCalls)) {
                        return;
                    }
                    if (cut) {
                        session.messages.push({ role: 'user', text: cutEditNudge(cut), hidden: true });
                    }
                    continue;
                }
                if (cut) {
                    session.messages.push({ role: 'user', text: cutEditNudge(cut), hidden: true });
                    continue;
                }
                const loopNow = this.loopOf(session);
                if (!parsed.toolCalls.length && round < rounds && session.mode === 'agent' && promisesMoreWork([agentText, ...parsed.plan].join('\n'), loopNow.continues ?? 0)) {
                    loopNow.continues = (loopNow.continues ?? 0) + 1;
                    if (!(applied && this.tracker.pending().some(change => change.sessionId === session.id))) {
                        session.messages.push({ role: 'user', text: CONTINUE_NUDGE, hidden: true });
                        continue;
                    }
                    loopNow.promised = true;
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
                } else if (!pending && info.canUseTools && round < rounds && this.nudgeHabitDone(session)) {
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
                this.attachFollowUps(session, followUps, edited);
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
            const blocked = this.loopDepth.get(session.id) === 1 && this.promptBlocked.delete(session.id);
            if (this.loopDepth.get(session.id) === 1 && !blocked) {
                await this.finishArtifacts(session);
            }
            this.leaveLoop(session.id);
            this.flushPoke();
            if (!this.loopDepth.has(session.id) && !blocked && !session.parent) {
                const status = session.status === 'error' ? 'error' : this.cancelled.has(session.id) ? 'aborted' : 'completed';
                void this.runEventHook(session, 'stop', { status, loop_count: this.hookLoops.get(session.id) ?? 0 }).then(outcome => this.hookFollowUp(session, outcome));
            }
            if (!this.loopDepth.has(session.id) && !blocked) {
                this.afterGoalTurn(session, generation);
                if (!this.stale(session.id, generation) && !this.cancelled.has(session.id) && session.goal?.state !== 'running') {
                    void this.afterRun(session).catch(() => undefined);
                }
            }
        }
    }

    /**
     * IDEA-292: after a full agent turn of a running goal, read the reply's self-check and either finish,
     * stop at the iteration or budget cap, or send a hidden nudge and take another turn.
     */
    protected afterGoalTurn(session: AgentSession, generation = this.loopGeneration.get(session.id) ?? 0): void {
        const goal = session.goal;
        if (goal?.state !== 'running' || this.stale(session.id, generation) || this.cancelled.has(session.id) || this.modelLoops.has(session.id)) {
            return;
        }
        if (session.status === 'review' || session.status === 'approval' || session.status === 'paused' || session.ask) {
            return;
        }
        if (session.status === 'error') {
            this.endGoal(session, 'error', GOAL_STOPPED_TEXT);
            this.changed();
            return;
        }
        const index = session.messages.map(m => m.role).lastIndexOf('agent');
        if (index < 0 || this.goalChecked.get(session.id) === index) {
            return;
        }
        this.goalChecked.set(session.id, index);
        const reply = session.messages[index];
        const check = parseGoalCheck(reply.expanded ?? reply.text);
        const next = applyGoalCheck(goal, check, 0);
        const decision = decideGoal(next, check);
        session.goal = next;
        if (decision.kind === 'done') {
            session.goal = { ...next, state: 'done' };
            session.messages.push({ role: 'system', text: GOAL_DONE_TEXT });
        } else if (decision.kind === 'stop') {
            this.endGoal(session, decision.reason, decision.message);
        } else {
            session.messages.push({ role: 'user', text: decision.nudge, hidden: true });
            session.status = 'thinking';
            session.updatedAt = Date.now();
            this.changed();
            void this.runModel(session, generation).finally(() => this.browser.endAgentRun(session.id));
            return;
        }
        session.updatedAt = Date.now();
        this.changed();
    }

    protected goalDisplay(session: AgentSession, text: string): string {
        return session.goal ? stripGoalCheck(text) : text;
    }

    protected endGoal(session: AgentSession, reason: GoalStopReason, message: string): void {
        if (session.goal?.state !== 'running') {
            return;
        }
        session.goal = { ...session.goal, state: 'stopped', reason };
        session.messages.push({ role: 'system', text: message });
    }

    /** Goal banner Stop: ends the goal and the current run. */
    stopGoal(id: string): void {
        const session = this.items.find(s => s.id === id);
        if (!session?.goal) {
            return;
        }
        this.endGoal(session, 'user', GOAL_STOPPED_TEXT);
        this.stop(id);
    }

    dismissGoal(id: string): void {
        const session = this.items.find(s => s.id === id);
        if (session?.goal && session.goal.state !== 'running') {
            session.goal = undefined;
            this.changed();
        }
    }

    /** End of a user turn: check the diff against the approved plan, count a routed turn, look for a stale chat. */
    protected async afterRun(session: AgentSession): Promise<void> {
        if (session.parent || session.agent === 'zaprex' || this.handedOff.has(session.id)) {
            return;
        }
        await this.reviewAgainstPlan(session);
        await this.countRoute(session);
        await this.considerHandoff(session);
        this.changed();
    }

    /** IDEA-307: the router's pick for a simple step, shown as a silver note with "Use original". */
    protected async routeTurn(session: AgentSession, prompt: string, files: number): Promise<void> {
        const history = estimateTokens(this.historyFor(session).map(m => m.content).join('\n'));
        const decision = await this.router.route(this.resolveModel(session.model), prompt, { mode: session.mode, files }, (session.context?.usage?.system ?? DEFAULT_SYSTEM_TOKENS) + history).catch(() => undefined);
        if (!decision) {
            return;
        }
        session.route = decision;
        const detail = `${this.models.label(decision.to)} instead of ${this.models.label(decision.from)} · ${taskTypeLabel(decision.taskType)} step${decision.learned ? ' · from Habits' : ''}`;
        session.messages.push({ role: 'system', text: `${HABIT_NOTE_TEXT.route}: ${detail}`, note: { kind: 'route', detail, action: 'use-original', actionLabel: `Use ${this.models.label(decision.from)}` } });
        this.changed();
    }

    /** IDEA-307: a routed turn that finished counts as the user keeping that model for the task type. */
    protected async countRoute(session: AgentSession): Promise<void> {
        const route = session.route;
        if (!route || this.routeCounted.has(session.id) || session.status === 'error') {
            return;
        }
        this.routeCounted.add(session.id);
        const saved = await this.router.recordChoice(route.taskType, route.to, true);
        if (saved) {
            this.noteSaved(session, saved);
        }
    }

    /** IDEA-307 "Use original": runs the turn again on the chat's own model; Habits counts the routed model as turned down. */
    async useOriginalModel(sessionId: string, index: number): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        const route = session?.route;
        if (!session || !message?.note || message.note.kind !== 'route' || message.note.done || !route) {
            return;
        }
        if (this.isRunning(sessionId)) {
            this.stop(sessionId);
        }
        session.messages = session.messages.slice(0, index + 1);
        session.messages[index] = { ...message, note: { ...message.note, done: true, detail: `${message.note.detail ?? ''} · ran again on ${this.models.label(route.from)}` } };
        session.route = undefined;
        this.routeCounted.add(session.id);
        void this.router.recordChoice(route.taskType, route.to, false);
        this.startRun(session);
    }

    /** "Saved to Habits": a learned preference reached the Habits threshold. */
    protected noteSaved(session: AgentSession, habit: LearnedHabit): void {
        const detail = learnedLabel(habit, id => this.models.label(id));
        session.messages.push({
            role: 'system', text: `${HABIT_NOTE_TEXT.habit}: ${detail}`,
            note: { kind: 'habit', detail, focus: learnedPrefFocus(habit.id), ...(habit.savedAs ? { path: habit.savedAs, action: 'open-file' as const, actionLabel: 'Open' } : {}) }
        });
        this.changed();
    }

    /** IDEA-306: the run's changed files and commands against the steps of the plan approved with Build. */
    protected async reviewAgainstPlan(session: AgentSession): Promise<void> {
        const plan = session.approvedPlan;
        if (!plan) {
            return;
        }
        session.approvedPlan = undefined;
        const since = session.messages.map(m => m.role === 'user' && !m.hidden).lastIndexOf(true);
        const commands = session.messages.slice(since + 1).flatMap(m =>
            m.tool?.tool === 'run' && m.tool.state === 'done' && typeof m.tool.args.command === 'string' ? [m.tool.args.command] : []);
        const files = [...new Set(this.loopOf(session).edits.map(p => p.replace(/^\.\/+/, '')))];
        const review = await this.planReview.review(this.rootFor(session), plan, { files, commands });
        const detail = reviewHeadline(review);
        session.messages.push({
            role: 'system', text: `${HABIT_NOTE_TEXT.plan}: ${detail}`, planReview: review,
            note: { kind: 'plan', detail, path: plan.path, action: 'open-file', actionLabel: 'Open plan' }
        });
        this.changed();
    }

    /** IDEA-305: after a turn, a stale chat is offered a fresh start (or handed off at once in auto mode). */
    protected async considerHandoff(session: AgentSession): Promise<void> {
        const mode = this.freshContext.mode;
        if (mode === 'off' || session.handoffOffer) {
            return;
        }
        const verdict = await this.freshContext.check(session.messages, usageRatio(session.context?.usage));
        if (!verdict) {
            return;
        }
        if (mode === 'auto') {
            await this.handOffFresh(session.id, { auto: true, verdict });
            return;
        }
        if (offerAllowed(verdict, session.handoffDismissedAt)) {
            session.handoffOffer = { verdict };
            this.changed();
        }
    }

    /** IDEA-292: pins a project command or skill into the current chat's system prompt. */
    async useAsMode(name: string): Promise<CustomMode | undefined> {
        await this.loadCommands();
        const command = findModeCommand(this.projectCommands, name);
        if (!command) {
            return undefined;
        }
        const session = this.current ?? this.create();
        session.customMode = customModeFrom(command);
        session.updatedAt = Date.now();
        this.changed();
        return session.customMode;
    }

    clearMode(id: string): void {
        const session = this.items.find(s => s.id === id);
        if (session?.customMode) {
            session.customMode = undefined;
            session.updatedAt = Date.now();
            this.changed();
        }
    }

    /** IDEA-305 "Not now": the offer comes back later; Habits counts this turn count as too early. */
    dismissHandoff(sessionId: string): void {
        const session = this.items.find(s => s.id === sessionId);
        if (!session?.handoffOffer) {
            return;
        }
        const turns = countTurns(session.messages);
        session.handoffOffer = undefined;
        session.handoffDismissedAt = turns;
        void this.freshContext.record(turns, false);
        this.changed();
    }

    /**
     * IDEA-305: writes the distilled brief (goal, plan, decisions, diff, failures, where it stopped) to
     * `.ingot/handoffs/` and continues in a new chat seeded with it. Accepted handoffs teach Habits the turn threshold.
     */
    async handOffFresh(sessionId: string, options: { auto?: boolean; verdict?: RotVerdict } = {}): Promise<AgentSession | undefined> {
        const session = this.items.find(s => s.id === sessionId);
        if (!session || this.handedOff.has(sessionId)) {
            return undefined;
        }
        const root = this.rootFor(session);
        if (!root) {
            session.messages.push({ role: 'system', text: 'Open a project folder to hand off: the brief is saved under .ingot/handoffs/ in the project.' });
            this.changed();
            return undefined;
        }
        this.handedOff.add(sessionId);
        if (this.isRunning(sessionId)) {
            this.stop(sessionId);
        }
        const turns = countTurns(session.messages);
        const ratio = usageRatio(session.context?.usage);
        const verdict = options.verdict ?? session.handoffOffer?.verdict ?? await this.freshContext.check(session.messages, ratio)
            ?? { reasons: [], signals: { turns, failures: countFailures(session.messages), ratio } };
        const asked = session.messages.filter(m => m.role === 'user' && !m.hidden);
        const lastReply = [...session.messages].reverse().find(m => m.role === 'agent' && !m.hidden && m.text)?.text ?? '';
        const changes = this.tracker.changes.filter(c => c.sessionId === session.id);
        const now = new Date();
        const path = briefPath(session.title, now);
        const brief = buildBrief({
            title: session.title, savedAt: now.toISOString().slice(0, 16).replace('T', ' '), verdict,
            goal: asked[0]?.text ?? session.title, latest: asked[asked.length - 1]?.text ?? '',
            plan: session.approvedPlan?.steps.map(text => ({ text, done: false })) ?? session.plan.map(p => ({ text: p.text, done: p.state === 'done' })),
            decisions: await this.freshContext.readDecisions(root), files: [...new Set([...changes.map(c => c.path), ...this.loopOf(session).edits])],
            diff: changesDiff(changes), failures: recentFailures(session.messages), lastReply
        });
        try {
            await this.freshContext.saveBrief(root, path, brief);
        } catch (error) {
            this.handedOff.delete(sessionId);
            session.messages.push({ role: 'system', text: `Could not save the handoff brief: ${error instanceof Error ? error.message : String(error)}` });
            this.changed();
            return undefined;
        }
        const summary = rotSummary(verdict) || 'handed off by hand';
        session.handoffOffer = undefined;
        session.messages.push({ role: 'system', text: `${HABIT_NOTE_TEXT.handoff}: ${path}`, note: { kind: 'handoff', detail: summary, path, action: 'open-file', actionLabel: 'Open brief' } });
        const saved = options.auto ? undefined : await this.freshContext.record(turns, true);
        const next = this.create(freshTitle(session.title));
        next.project = session.project;
        next.mode = session.mode;
        next.model = session.model;
        next.messages.push({ role: 'system', text: `${HABIT_NOTE_TEXT.handoff}: ${path}`, note: { kind: 'handoff', detail: `from "${session.title}" · ${summary}`, path, action: 'open-file', actionLabel: 'Open brief' } });
        if (saved) {
            this.noteSaved(next, saved);
        }
        next.messages.push({ role: 'user', text: CONTINUE_PROMPT, expanded: briefPrompt(path, brief), chips: [{ label: path.split('/').pop() ?? path, path, kind: 'file' }] });
        this.closeTab(session.id);
        this.selected = next.id;
        this.loops.set(next.id, this.newLoop(CONTINUE_PROMPT));
        this.startRun(next);
        return next;
    }

    /** IDEA-296: one more round to verify the active habit's open done criteria before the run ends. */
    protected nudgeHabitDone(session: AgentSession): boolean {
        const nudge = this.habitRunner.doneNudge(session);
        if (nudge) {
            session.messages.push({ role: 'user', text: nudge, hidden: true });
        }
        return !!nudge;
    }

    /** IDEA-296: the user picked a habit in the pill (or turned it off); a running turn sees it on its next round. */
    async chooseHabit(sessionId: string, id: string | undefined): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        if (!session) {
            return;
        }
        const note = await this.habitRunner.choose(session, this.rootFor(session), id);
        if (note && this.isRunning(session.id)) {
            session.messages.push({ role: 'user', text: note, hidden: true });
        }
        session.updatedAt = Date.now();
        this.changed();
    }

    /** IDEA-287: project files the agent read or edited in this chat (nested rules apply to them). */
    protected touchedPaths(session: AgentSession): string[] {
        const paths = session.messages.flatMap(m => m.tool && m.tool.server === BUILTIN_TOOL_SERVER && m.tool.tool === 'read_file' && typeof m.tool.args.path === 'string' ? [m.tool.args.path] : []);
        return [...paths, ...session.steps.filter(s => s.kind === 'edit').map(s => s.target)].map(p => p.replace(/^\.\/+/, ''));
    }

    /** IDEA-294: runs a `hooks.json` agent event; undefined when no hook is configured (or hooks are off). */
    protected async runEventHook(session: AgentSession, event: AgentHookEvent, data: Readonly<Record<string, unknown>>, loopCount?: number): Promise<AgentHookOutcome | undefined> {
        const generation = this.loopGeneration.get(session.id) ?? 0;
        return this.eventHooks.run(event, this.rootFor(session), { conversationId: session.id, generationId: `${session.id}-${generation}`, model: this.modelFor(session) }, data,
            { sessionEnv: this.hookSessions.get(session.id)?.env, loopCount: loopCount ?? this.hookLoops.get(session.id) ?? 0 }).catch(() => undefined);
    }

    /**
     * IDEA-287: sessionStart on a chat's first run (its env and context stay with the chat), then beforeSubmitPrompt for
     * a prompt the user just sent. False: a hook kept the prompt from being sent.
     */
    protected async hookTurnStart(session: AgentSession, root: URI | undefined): Promise<boolean> {
        if (session.parent) {
            return true;
        }
        if (!this.hookSessions.has(session.id)) {
            const startedAt = Date.now();
            this.hookSessions.set(session.id, { startedAt });
            const started = await this.runEventHook(session, 'sessionStart', { session_id: session.id, is_background_agent: !!session.parent, composer_mode: session.mode });
            const { env, additionalContext } = started?.extras ?? {};
            this.hookSessions.set(session.id, { startedAt, ...(env ? { env } : {}), ...(additionalContext ? { context: hookContextText('sessionStart', additionalContext) } : {}) });
        }
        const last = this.submitPending.delete(session.id) ? [...session.messages].reverse().find(m => m.role === 'user' && !m.hidden) : undefined;
        if (!last) {
            return true;
        }
        const attachments = (last.chips ?? []).flatMap(chip => chip.path ? [{ type: 'file', file_path: root && !chip.path.startsWith('/') ? root.resolve(chip.path).path.fsPath() : chip.path }] : []);
        const outcome = await this.runEventHook(session, 'beforeSubmitPrompt', { prompt: last.text, attachments });
        if (!outcome || (outcome.extras.continue !== false && outcome.decision.permission !== 'deny')) {
            return true;
        }
        session.messages.push({ role: 'system', text: `${HOOK_TEXT.promptBlocked}${outcome.decision.userMessage ? `: ${outcome.decision.userMessage}` : '.'}` });
        if (session.messages.filter(m => m.role === 'user' && !m.hidden).length === 1) {
            session.title = NEW_AGENT_TITLE;
        }
        session.status = 'idle';
        session.updatedAt = Date.now();
        this.changed();
        return false;
    }

    /** IDEA-287: a stop hook's `followup_message` is sent as the next user message (loop flows), up to each hook's loop_limit. */
    protected hookFollowUp(session: AgentSession, outcome: AgentHookOutcome | undefined): void {
        const text = outcome?.extras.followupMessage;
        if (!text || this.isRunning(session.id) || this.cancelled.has(session.id) || session.ask || session.status === 'review' || session.status === 'approval') {
            return;
        }
        this.hookLoops.set(session.id, (this.hookLoops.get(session.id) ?? 0) + 1);
        session.messages.push({ role: 'user', text });
        this.loops.set(session.id, this.newLoop(text));
        this.startRun(session);
    }

    /** IDEA-287: afterAgentThought (a `<think>` block) and afterAgentResponse for a finished reply. Observation only. */
    protected afterReplyHooks(session: AgentSession, display: string, thoughtMs?: number): void {
        const { thought, rest } = extractThought(display);
        if (thought?.trim()) {
            void this.runEventHook(session, 'afterAgentThought', { text: thought.trim(), ...(thoughtMs ? { duration_ms: thoughtMs } : {}) });
        }
        if (rest.trim()) {
            void this.runEventHook(session, 'afterAgentResponse', { text: rest.trim() });
        }
    }

    /**
     * IDEA-287: after a tool ran: afterShellExecution / afterMCPExecution (observation), then postToolUse or postToolUseFailure.
     * Returns context a hook added (read by the model after the result) and, for MCP tools, a replaced result.
     */
    protected async afterToolHooks(session: AgentSession, call: AgentToolCall, result: AgentActionResult, durationMs: number, toolUseId: string): Promise<{ context?: string; text?: string }> {
        const cwd = this.rootFor(session)?.path.fsPath();
        const builtin = call.server === BUILTIN_TOOL_SERVER;
        if (builtin && call.tool === 'run') {
            void this.runEventHook(session, 'afterShellExecution', afterShellPayload(String(call.args.command ?? ''), result.text, durationMs, !!result.sandboxed));
        } else if (!builtin) {
            void this.runEventHook(session, 'afterMCPExecution', afterMcpPayload(call, result, durationMs));
        }
        const event = result.isError ? 'postToolUseFailure' : 'postToolUse';
        const outcome = await this.runEventHook(session, event, result.isError
            ? toolFailurePayload(call, BUILTIN_TOOL_SERVER, toolUseId, result.text, toolFailureType(result.text, false), durationMs, cwd)
            : postToolPayload(call, BUILTIN_TOOL_SERVER, toolUseId, result, durationMs, cwd));
        const replaced = !builtin && !result.isError ? outcome?.extras.updatedMcpToolOutput : undefined;
        return {
            ...(outcome?.extras.additionalContext ? { context: hookContextText(event, outcome.extras.additionalContext) } : {}),
            ...(replaced !== undefined ? { text: typeof replaced === 'string' ? replaced : JSON.stringify(replaced) } : {})
        };
    }

    /** IDEA-287: a call that never ran (blocked by a hook, the policy or the sandbox) is a permission_denied failure. */
    protected hookToolDenied(session: AgentSession, call: HookToolCall, reason: string, toolUseId: string): void {
        void this.runEventHook(session, 'postToolUseFailure', toolFailurePayload(call, BUILTIN_TOOL_SERVER, toolUseId, reason, 'permission_denied', 0, this.rootFor(session)?.path.fsPath()));
    }

    /** IDEA-294: a hook that denied (or asked about) an action shows as a hook card in the chat. */
    protected pushHookCard(session: AgentSession, outcome: AgentHookOutcome, target: string): void {
        const now = Date.now();
        session.messages.push({
            role: 'tool', from: `${BUILTIN_TOOL_SERVER}/hook`, text: hookOutcomeText(outcome.results),
            tool: { server: BUILTIN_TOOL_SERVER, tool: 'hook', args: { check: `${outcome.event} · ${outcome.decision.permission}: ${target}` }, state: outcome.decision.permission === 'deny' ? 'error' : 'done', startedAt: now, endedAt: now }
        });
    }

    /** IDEA-290: walkthrough.md and the run's end time, once the outermost loop of a turn returns. */
    protected async finishArtifacts(session: AgentSession): Promise<void> {
        const visible = (role: AgentMessage['role']): string => [...session.messages].reverse().find(m => m.role === role && !m.hidden && m.text)?.text ?? '';
        const files = [...new Set([...session.changes.map(c => c.label), ...session.steps.filter(s => s.kind === 'edit').map(s => s.target)])];
        await this.artifacts.finish(session, { reply: visible('agent'), files, plan: session.plan.map(p => p.text) }).catch(() => undefined);
        this.changed();
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
    /** Returns 'revise' when a guard kept edits out (the agent should try again), 'stopped' when the user stopped. */
    protected async applyParsedEdits(session: AgentSession, edits: readonly AgentEdit[], plan: readonly string[], root: URI | undefined): Promise<GuardOutcome> {
        if (edits.length >= MULTI_FILE_EDITS && !plan.length && session.plan.length === 0) {
            session.plan = planFromEdits(edits.map(edit => edit.path)).map((text, i) => ({ text, state: i === 0 ? 'active' : 'todo' }));
        }
        const editable = await this.sandboxEdits(session, await this.editsAllowed(session, edits, root), root);
        const guarded = await this.guardEdits(session, editable, plan, root);
        if (guarded.outcome === 'stopped') {
            return guarded.outcome;
        }
        await this.applyEdits(session, guarded.edits, root);
        return guarded.outcome;
    }

    /** IDEA-302..304: locked decisions, frozen zones and anti-habits of the project, for the system prompt. */
    protected async guardPrompt(root: URI | undefined, canEdit: boolean): Promise<string> {
        if (!root) {
            return '';
        }
        const [decisions, frozen, anti] = await Promise.all([
            this.decisions.load(root).catch(() => []),
            this.frozen.load(root).then(state => state.zones, () => []),
            this.antiHabits.load(root).catch(() => [])
        ]);
        return [
            formatDecisions(decisions, `${BUILTIN_TOOL_SERVER}/${ASK_USER_TOOL}`), DECISIONS_PROTOCOL,
            canEdit ? formatFrozen(frozen) : '', formatAntiHabits(anti)
        ].filter(Boolean).join('\n\n');
    }

    /** Reads a project file; empty when it does not exist yet. */
    protected async readText(root: URI, path: string): Promise<string> {
        const uri = this.safeUri(root, path);
        return uri && uri !== root ? this.files.read(uri).then(file => file.value, () => '') : '';
    }

    /** Asks a Decisions / Frozen Zones question in the chat and maps the picked option. */
    protected async askGuard(session: AgentSession, question: string, options: { keep: string; allow: string; release: string }): Promise<GuardChoice> {
        const answer = await this.waitForAnswer(session, question, [options.keep, options.allow, options.release], true);
        if (answer === undefined || this.cancelled.has(session.id)) {
            session.ask = undefined;
            session.messages.push({ role: 'system', text: ASK_STOPPED });
            this.changed();
            return 'stopped';
        }
        return answer === options.allow ? 'allow' : answer === options.release ? 'release' : 'keep';
    }

    /** IDEA-302: "Keep the decision" / "Go ahead this time" / "Unlock the decision" for the conflicts found. */
    protected async askDecisions(session: AgentSession, conflicts: readonly DecisionConflict[], root: URI): Promise<GuardChoice> {
        const choice = await this.askGuard(session, conflictQuestion(conflicts), { keep: DECISION_ASK_OPTIONS.keep, allow: DECISION_ASK_OPTIONS.once, release: DECISION_ASK_OPTIONS.unlock });
        if (choice === 'release') {
            for (const decision of new Map(conflicts.map(c => [c.decision.id, c.decision])).values()) {
                await this.decisions.setLocked(decision.id, false, root);
                this.addNote(session, { kind: 'decision', text: DECISION_NOTES.unlocked, detail: decision.text });
            }
        }
        return choice;
    }

    /**
     * IDEA-302 / IDEA-303: before edits land, ask in the chat about each locked decision they contradict and each
     * frozen file or function they change. Edits the user keeps out are dropped and the agent is told why.
     */
    protected async guardEdits(session: AgentSession, edits: readonly AgentEdit[], plan: readonly string[], root: URI | undefined): Promise<{ edits: AgentEdit[]; outcome: GuardOutcome }> {
        if (!root || !edits.length) {
            return { edits: [...edits], outcome: undefined };
        }
        const befores = new Map(await Promise.all(edits.map(async edit => [edit.path, await this.readText(root, edit.path)] as const)));
        let kept = [...edits];
        let revise = false;
        const conflicts = await this.decisions.conflicts(root, {
            plan, edits: edits.map(edit => ({ path: edit.path, added: addedLines(befores.get(edit.path) ?? '', edit.content) })), commands: []
        }).catch(() => []);
        if (conflicts.length) {
            const choice = await this.askDecisions(session, conflicts, root);
            if (choice === 'stopped') {
                await this.tracker.cancelStreams(session.id);
                return { edits: [], outcome: 'stopped' };
            }
            if (choice === 'keep') {
                revise = true;
                const planConflict = conflicts.some(c => !edits.some(edit => edit.path === c.where));
                const skipped = planConflict ? kept.map(edit => edit.path) : [...new Set(conflicts.map(c => c.where))];
                kept = kept.filter(edit => !skipped.includes(edit.path));
                await Promise.all(skipped.map(path => this.tracker.cancelStream(session.id, path)));
                session.messages.push({ role: 'user', text: keptDecisionNote(conflicts, skipped), hidden: true });
            }
        }
        const allowed: AgentEdit[] = [];
        for (const edit of kept) {
            const touches = await this.frozen.touches(root, edit.path, befores.get(edit.path) ?? '', edit.content).catch(() => []);
            if (!touches.length) {
                allowed.push(edit);
                continue;
            }
            const choice = await this.askGuard(session, frozenQuestion(touches), { keep: FROZEN_ASK_OPTIONS.keep, allow: FROZEN_ASK_OPTIONS.allow, release: FROZEN_ASK_OPTIONS.unfreeze });
            if (choice === 'stopped') {
                await this.tracker.cancelStreams(session.id);
                return { edits: [], outcome: 'stopped' };
            }
            if (choice === 'keep') {
                revise = true;
                await this.tracker.cancelStream(session.id, edit.path);
                session.messages.push({ role: 'user', text: keptFrozenNote(touches.map(t => t.label)), hidden: true });
                continue;
            }
            if (choice === 'release') {
                for (const touch of touches) {
                    await this.frozen.unfreeze(touch.zone.id, root);
                    this.addNote(session, { kind: 'frozen', text: FROZEN_NOTES.unfrozen, detail: touch.label });
                }
            }
            allowed.push(edit);
        }
        return { edits: allowed, outcome: revise ? 'revise' : undefined };
    }

    /** IDEA-302: a plan (Plan / Ask mode) that contradicts a locked decision. Keep sends it back for a revision. */
    protected async checkPlan(session: AgentSession, plan: readonly string[], root: URI | undefined): Promise<GuardChoice | undefined> {
        const conflicts = root ? await this.decisions.conflicts(root, { plan, edits: [], commands: [] }).catch(() => []) : [];
        if (!root || !conflicts.length) {
            return undefined;
        }
        const choice = await this.askDecisions(session, conflicts, root);
        if (choice === 'keep') {
            session.messages.push({ role: 'user', text: `${keptDecisionNote(conflicts, [])} Revise the plan so it follows the decision.`, hidden: true });
        }
        return choice;
    }

    /**
     * IDEA-302 / IDEA-303: a shell command that contradicts a locked decision, or a delete of a frozen file, asks
     * first. Returns the tool error when the user keeps it out, 'stopped' when they stopped the run.
     */
    protected async guardTool(session: AgentSession, call: AgentToolCall, root: URI | undefined): Promise<string | undefined> {
        if (!root || call.server !== BUILTIN_TOOL_SERVER) {
            return undefined;
        }
        const command = call.tool === 'run' && typeof call.args.command === 'string' ? call.args.command : '';
        const conflicts = command ? await this.decisions.conflicts(root, { plan: [], edits: [], commands: [command] }).catch(() => []) : [];
        if (conflicts.length) {
            const choice = await this.askDecisions(session, conflicts, root);
            return choice === 'stopped' ? 'stopped' : choice === 'keep' ? keptDecisionNote(conflicts, []) : undefined;
        }
        const path = call.tool === 'delete' && typeof call.args.path === 'string' ? call.args.path : '';
        if (!path) {
            return undefined;
        }
        const before = await this.readText(root, path);
        const touches = await this.frozen.touches(root, path, before, '').catch(() => []);
        if (!touches.length) {
            return undefined;
        }
        const choice = await this.askGuard(session, frozenQuestion(touches), { keep: FROZEN_ASK_OPTIONS.keep, allow: FROZEN_ASK_OPTIONS.allow, release: FROZEN_ASK_OPTIONS.unfreeze });
        if (choice === 'release') {
            for (const touch of touches) {
                await this.frozen.unfreeze(touch.zone.id, root);
                this.addNote(session, { kind: 'frozen', text: FROZEN_NOTES.unfrozen, detail: touch.label });
            }
        }
        return choice === 'stopped' ? 'stopped' : choice === 'keep' ? keptFrozenNote(touches.map(t => t.label)) : undefined;
    }

    protected doomOf(session: AgentSession): DoomState {
        return this.dooms.get(session.id) ?? startDoom();
    }

    /** IDEA-304: a command result feeds the doom-loop tracker; a test run also tells Frozen Zones what is green. */
    protected observeTool(session: AgentSession, call: AgentToolCall, result: AgentActionResult, root: URI | undefined): void {
        if (call.server !== BUILTIN_TOOL_SERVER) {
            return;
        }
        const command = call.tool === 'run' && typeof call.args.command === 'string' ? call.args.command : '';
        if (command || result.isError) {
            this.dooms.set(session.id, observeResult(this.doomOf(session), { action: command || call.tool, failed: !!result.isError, output: result.text }));
        }
        if (command && isTestCommand(command) && root) {
            void this.frozen.recordTests({ command, passed: !result.isError, at: Date.now() }, root).catch(() => undefined);
        }
    }

    /**
     * IDEA-304: the same error after N tries, a fix that breaks what the last one fixed, or "it works" claims the
     * checks keep disproving pause the run. The chat shows what was tried, and the approach is saved as an anti-habit.
     */
    protected async breakDoomLoop(session: AgentSession, root: URI | undefined): Promise<boolean> {
        if (this.preferences.get<boolean>(DOOM_PREFS.enabled, true) === false) {
            return false;
        }
        const max = Math.max(MIN_MAX_REPEATS, this.preferences.get<number>(DOOM_PREFS.maxRepeats, DEFAULT_MAX_REPEATS) ?? DEFAULT_MAX_REPEATS);
        const verdict = detectDoom(this.doomOf(session), max);
        if (!verdict) {
            return false;
        }
        await this.tracker.cancelStreams(session.id);
        session.doom = verdict;
        session.status = 'idle';
        session.messages.push({ role: 'system', text: `${DOOM_MESSAGES.paused}${verdict.reason}` });
        this.changed();
        if (root) {
            const habit = await this.antiHabits.record(root, verdict).catch(() => undefined);
            if (habit) {
                this.addNote(session, { kind: 'habit', text: DOOM_NOTE, detail: habit.text, focus: savedHabitFocus(savedHabitKey('anti', habit.id)) });
            }
        }
        session.updatedAt = Date.now();
        this.changed();
        return true;
    }

    /** IDEA-304: the doom card's buttons. Reset puts the files back to before this turn; the chat stays. */
    async resolveDoom(sessionId: string, action: keyof typeof DOOM_ACTIONS): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        const verdict = session?.doom;
        if (!session || !verdict) {
            return;
        }
        session.doom = undefined;
        this.dooms.delete(sessionId);
        if (action === 'reset') {
            const from = session.messages.map(m => m.role === 'user' && !m.hidden).lastIndexOf(true);
            try {
                await this.tracker.revertTo(sessionId, from, restorePlan(this.tracker.checkpoints, sessionId, from));
                session.messages.push({ role: 'system', text: DOOM_MESSAGES.reset(session.messages[from]?.text ?? '') });
            } catch (error) {
                session.messages.push({ role: 'system', text: `${DOOM_MESSAGES.resetFailed}${error instanceof Error ? error.message : String(error)}` });
            }
            session.status = 'idle';
        } else if (action === 'different' || action === 'keep') {
            if (action === 'different') {
                session.messages.push({ role: 'user', text: differentApproachNudge(verdict), hidden: true });
            }
            session.messages.push({ role: 'system', text: DOOM_MESSAGES[action] });
            this.cancelled.delete(sessionId);
            session.status = 'thinking';
            this.changed();
            void this.runModel(session);
            return;
        }
        session.updatedAt = Date.now();
        this.changed();
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
    protected async streamRound(session: AgentSession, system: string, retried = false): Promise<(ReturnType<typeof parseAgentOutput> & { memories: MemoryNote[]; followUps: string[] }) | undefined> {
        const generation = this.loopGeneration.get(session.id) ?? 0;
        const live = (): boolean => !this.stale(session.id, generation) && !this.cancelled.has(session.id);
        if (!live()) {
            return undefined;
        }
        const history = this.historyFor(session);
        if (this.queuedSteers.take(session.id).length) {
            // This round reads the queued messages, so no extra round is needed for them afterwards.
            this.steers.delete(session.id);
        }
        const index = session.messages.push({ role: 'agent', text: '' }) - 1;
        session.status = 'thinking';
        this.changed();
        let final = '';
        try {
            const tools = modeInfo(session.mode).canUseTools
                ? BUILTIN_TOOLS.filter(tool => builtinToolEnabled(tool.name, this.toolSwitches(session)))
                    .filter(tool => this.habitRunner.allows(session, BUILTIN_TOOL_SERVER, tool.name))
                    .map(tool => ({ name: tool.name, description: tool.description }))
                : [];
            const stream = this.models.stream(this.modelFor(session), [{ role: 'system', content: system }, ...history], text => {
                if (!live() || !session.messages[index]) {
                    return;
                }
                const parsed = parseAgentOutput(cutAfterToolCalls(text));
                this.streamEdit(session, index, parsed.editing, parsed.editingContent);
                this.writeAgentDraft(session, index, stripHabitMarks(this.goalDisplay(session, extractFollowUps(extractMemories(parsed.display).display).display)));
                if (parsed.plan.length) {
                    session.plan = parsed.plan.map((t, i) => ({ text: t, state: i === 0 ? 'active' : 'todo' }));
                    this.considerHarmony(session, parsed.edits.length);
                }
                session.status = parsed.editing ? 'editing' : 'thinking';
                session.activeFile = parsed.editing ?? parsed.edits[parsed.edits.length - 1]?.path;
                session.updatedAt = Date.now();
                this.poke();
            }, { maxTokens: AGENT_MAX_TOKENS, ...(tools.length ? { tools } : {}) });
            this.running.set(session.id, stream.cancel);
            final = cutAfterToolCalls(await stream.done);
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
        if (session.goal?.state === 'running') {
            const spent = estimateTokens(system) + estimateTokens(history.map(m => m.content).join('\n')) + estimateTokens(final);
            session.goal = { ...session.goal, tokensUsed: session.goal.tokensUsed + spent };
        }
        const parsed = parseAgentOutput(final);
        const extracted = extractMemories(parsed.display);
        const withFollowUps = extractFollowUps(extracted.display);
        const display = stripHabitMarks(this.goalDisplay(session, withFollowUps.display));
        const followUps = withFollowUps.followUps;
        const memories = extracted.memories;
        this.habitRunner.consume(session, final);
        this.dooms.set(session.id, observeReply(this.doomOf(session), display));
        // Keep the raw reply for the model (so it sees its own tool calls), show the clean text.
        const empty = extracted.display.trim() ? HABIT_TICKED_REPLY : '(empty reply)';
        this.writeAgentDraft(session, index, display || (parsed.edits.length ? `Proposed changes to ${parsed.edits.length} file(s).` : parsed.toolCalls.length ? 'Calling tools…' : empty), {
            expanded: final,
            // IDEA-186: a silent round of project reads shows only in the Explored row.
            ...(!display && !parsed.edits.length && parsed.toolCalls.length && parsed.toolCalls.every(c => c.server === BUILTIN_TOOL_SERVER && isWorkspaceTool(c.tool)) ? { hidden: true } : {})
        });
        this.afterReplyHooks(session, display, session.messages[index]?.thoughtMs);
        return { ...parsed, memories, followUps };
    }

    /**
     * Runs a round of tool calls. Actions that need approval (IDEA-109) wait on the card first; Skip returns the
     * reason to the agent as the tool result. Returns false when the user stopped the run on the card.
     */
    protected async runTools(session: AgentSession, calls: readonly AgentToolCall[]): Promise<boolean> {
        const root = this.rootFor(session);
        const rootPath = root?.path.fsPath();
        const policy = await this.policy.load(rootPath);
        const tasks = calls.filter(isTaskCall);
        if (tasks.length) {
            await this.runTasks(session, tasks, rootPath);
        }
        for (const raw of calls.filter(call => !isTaskCall(call))) {
            const startedAt = Date.now();
            const resolved = await this.resolveCall(raw, rootPath);
            if ('error' in resolved) {
                session.messages.push({ role: 'tool', from: `${raw.server}/${raw.tool}`, text: `Error: ${resolved.error}` });
                this.recordTool(session, raw, rootPath, { decision: 'auto', outcome: 'error', output: resolved.error, startedAt });
                this.changed();
                continue;
            }
            let call = withRepoDefaults(resolved.call, this.github);
            const target = `${call.server}/${call.tool}`;
            const toolUseId = `${session.id}-${startedAt}-${target}`;
            if (!toolAllowedInMode(session.mode, call, session.subagent?.readonly)) {
                const blocked = session.subagent?.readonly && modeInfo(session.mode).canUseTools ? readonlySubagentResult(session.subagent.name, target) : modeBlockedResult(session.mode, call);
                session.messages.push({
                    role: 'tool', from: target, text: `Error: ${blocked}`,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt, endedAt: Date.now() }
                });
                this.recordTool(session, call, rootPath, { decision: 'auto', outcome: 'error', output: blocked, startedAt });
                this.changed();
                continue;
            }
            if (call.server === BUILTIN_TOOL_SERVER && call.tool === ASK_USER_TOOL) {
                const question = typeof call.args.question === 'string' ? call.args.question.trim() : '';
                const options = Array.isArray(call.args.options) ? call.args.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
                if (!question) {
                    session.messages.push({ role: 'tool', from: target, text: 'Error: a question is required.' });
                    this.recordTool(session, call, rootPath, { decision: 'auto', outcome: 'error', output: 'A question is required.', startedAt });
                    this.changed();
                    continue;
                }
                const answer = await this.waitForAnswer(session, question, options);
                if (answer === undefined || this.cancelled.has(session.id)) {
                    session.ask = undefined;
                    session.messages.push({ role: 'system', text: ASK_STOPPED });
                    this.recordTool(session, call, rootPath, { decision: 'stopped', outcome: 'skipped', startedAt });
                    this.changed();
                    return false;
                }
                session.messages.push({
                    role: 'tool', from: target, text: answer,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'done', startedAt: Date.now(), endedAt: Date.now() }
                });
                this.recordTool(session, call, rootPath, { decision: 'auto', outcome: 'ok', output: answer, startedAt });
                this.changed();
                continue;
            }
            const asked = [...session.messages].reverse().find(message => message.role === 'user' && !message.hidden)?.text ?? '';
            if (isRemoteCodeFetch(call) && !userAskedForRemote(asked)) {
                session.messages.push({
                    role: 'tool', from: target, text: REMOTE_BLOCKED,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt: Date.now(), endedAt: Date.now() }
                });
                this.recordTool(session, call, rootPath, { decision: 'denied', outcome: 'blocked', reason: REMOTE_BLOCKED, startedAt });
                this.changed();
                continue;
            }
            if (call.server === BUILTIN_TOOL_SERVER && call.tool === 'run' && typeof call.args.command === 'string') {
                const userText = session.messages.filter(message => message.role === 'user' && !message.hidden).map(message => message.text).join('\n');
                const answers = session.messages.filter(message => message.role === 'tool' && message.tool?.tool === ASK_USER_TOOL).map(message => message.text);
                const refused = shellGitBlockReason(call.args.command, userText, answers);
                if (refused) {
                    session.messages.push({
                        role: 'tool', from: target, text: `Error: ${refused}`,
                        tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt: Date.now(), endedAt: Date.now() }
                    });
                    this.changed();
                    continue;
                }
            }
            const refusedByHabit = this.habitRunner.refuse(session, call);
            if (refusedByHabit) {
                session.messages.push({
                    role: 'tool', from: target, text: `Error: ${refusedByHabit}`,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt: Date.now(), endedAt: Date.now() }
                });
                this.recordTool(session, call, rootPath, { decision: 'denied', outcome: 'blocked', reason: refusedByHabit, startedAt });
                this.changed();
                continue;
            }
            const guarded = await this.guardTool(session, call, root);
            if (guarded === 'stopped') {
                return false;
            }
            if (guarded) {
                session.messages.push({
                    role: 'tool', from: target, text: `Error: ${guarded}`,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt: Date.now(), endedAt: Date.now() }
                });
                this.changed();
                continue;
            }
            const gate = await this.gateWithHooks(session, call, root, toolUseId);
            if (gate.blocked) {
                session.messages.push({ role: 'tool', from: target, text: `Error: ${gate.blocked}` });
                this.recordTool(session, call, rootPath, { decision: 'denied', outcome: 'blocked', reason: gate.blocked, startedAt });
                this.hookToolDenied(session, call, gate.blocked, toolUseId);
                this.changed();
                continue;
            }
            if (gate.args) {
                call = { ...call, args: gate.args };
            }
            // IDEA-263: `.ingot/policy.json` decides first: denied calls never reach the card; allowed ones skip it.
            const isRun = call.server === BUILTIN_TOOL_SERVER && call.tool === 'run';
            const runCwd = isRun && rootPath ? this.resolveRunCwd(rootPath, typeof call.args.cwd === 'string' ? call.args.cwd : '') : undefined;
            const context = rootPath ? await this.policy.context(rootPath, runCwd) : undefined;
            const verdict: PolicyDecision = context ? checkToolCall(policy, call, context) : { verdict: 'default' };
            if (verdict.verdict === 'deny') {
                const source = policySourceOf(verdict.reason, policy.origins);
                const text = policyBlockedText(verdict.reason, source);
                session.messages.push({
                    role: 'tool', from: target, text: `Error: ${text}`,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt, endedAt: Date.now() }
                });
                this.recordTool(session, call, rootPath, { decision: 'denied', outcome: 'blocked', reason: `${source} ${verdict.reason ?? ''}`.trim(), startedAt });
                this.changed();
                continue;
            }
            const outside = verdict.verdict === 'ask';
            let decision: AuditDecision = verdict.verdict === 'allow' ? 'allowed' : 'auto';
            const isGit = call.server === BUILTIN_TOOL_SERVER && call.tool === 'git';
            const branch = isGit && rootPath && call.args.op === 'push' && !call.args.branch
                ? (await this.git.run(rootPath, { kind: 'currentBranch' }).catch(() => ({ output: '' }))).output.trim() || undefined : undefined;
            const described = describeAction(call, branch);
            // Stopping a process the agent started itself never asks; the user's own processes do.
            const plain = call.server === BUILTIN_TOOL_SERVER && call.tool === 'process_stop' && this.processes.find(String(call.args.id))?.origin !== 'user' ? undefined : described;
            // IDEA-294: a hook that answers "ask" always shows the approval card, even for actions that run at once.
            const action = gate.ask ? { ...(plain ?? { kind: 'mcp' as const, label: call.tool, detail: String(call.args.path ?? '') }), label: `Hook asks · ${plain?.label ?? call.tool}` } : plain;
            const requireGit = this.preferences.get<boolean>(APPROVAL_PREFS.gitRequireApproval, true) !== false;
            const isBrowser = call.server === BUILTIN_TOOL_SERVER && call.tool.startsWith('browser_');
            const requireRun = action?.kind === 'terminal' ? this.runSettings.requireApproval
                : isBrowser ? browserNeedsCard(call.tool, browserToolSettings(key => this.preferences.get(key))) : true;
            // IDEA-133: a tool turned off in Settings › Agent tools is refused at once, without a card.
            const turnedOff = call.server === BUILTIN_TOOL_SERVER
                && !builtinToolEnabled(call.tool, this.toolSwitches(session));
            const policyCard = action && outside ? outsideApproval(action) : action;
            // A `.ingot/policy.json` "ask" or a hook's "ask" always shows the card, whatever the sandbox preset says.
            const mustAsk = !!policyCard && !turnedOff && (outside || !!gate.ask);
            const cardRequired = mustAsk || (!!policyCard && !turnedOff && verdict.verdict !== 'allow' && requireRun
                && needsApproval(policyCard, rootPath ?? '', this.alwaysRun, requireGit, this.alwaysRunCommands));
            // IDEA-288: the project's sandbox preset decides whether the action runs, asks, is refused or goes to auto-review.
            const sandboxed = turnedOff ? { decision: 'run' as const, action: policyCard, offline: false } : await this.sandboxGate(session, call, policyCard, rootPath, cardRequired);
            if (sandboxed.decision === 'refuse') {
                session.messages.push({
                    role: 'tool', from: target, text: `Error: ${sandboxed.refusal}`,
                    tool: { server: call.server, tool: call.tool, args: call.args, state: 'error', startedAt: Date.now(), endedAt: Date.now() }
                });
                this.recordTool(session, call, rootPath, { decision: 'denied', outcome: 'blocked', reason: sandboxed.refusal, startedAt });
                this.changed();
                continue;
            }
            const card = sandboxed.action;
            if (card && (sandboxed.decision === 'ask' || mustAsk)) {
                const choice = await this.askApproval(session, card);
                if (choice.stopped) {
                    this.recordTool(session, call, rootPath, { decision: 'stopped', outcome: 'skipped', reason: verdict.reason, startedAt });
                    return false;
                }
                if (choice.decision === 'skip') {
                    session.messages.push({ role: 'tool', from: target, text: skippedResult(card, choice.reason) });
                    this.recordTool(session, call, rootPath, { decision: 'skipped', outcome: 'skipped', reason: choice.reason ?? verdict.reason, startedAt });
                    this.changed();
                    continue;
                }
                const always = choice.decision === 'always' && !card.once && !card.alwaysAsk && !card.sandbox && !gate.ask;
                if (always && rootPath) {
                    await (card.command ? this.setAlwaysRunCommand(rootPath, card.command, true) : this.setAlwaysRun(rootPath, card.kind, true));
                }
                decision = always ? 'always' : 'approved';
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
                    this.recordTool(session, call, rootPath, { decision: 'denied', outcome: 'blocked', reason: blocked, startedAt });
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
                    const reason = `blocked by .ingot hooks (${hookStage}${failed.length ? `: ${failed.join(', ')} failed` : ''}${run.errors.length ? `; ${run.errors.join(' ')}` : ''})`;
                    session.messages.push({ role: 'tool', from: target, text: `Error: ${reason}. Fix the problem, then try the ${call.args.op} again.` });
                    this.recordTool(session, call, rootPath, { decision, outcome: 'blocked', reason, startedAt });
                    this.changed();
                    continue;
                }
                hooksRan = true;
                this.changed();
            }
            const workspaceTool = call.server === BUILTIN_TOOL_SERVER && isWorkspaceTool(call.tool);
            const codeTool = call.server === BUILTIN_TOOL_SERVER && isCodeTool(call.tool) ? call.tool : undefined;
            session.steps = [...session.steps, workspaceTool ? this.workspaceStep(call)
                : { kind: 'run', target, done: false, ...(codeTool ? { label: codeToolStep(codeTool, call.args) } : {}) }];
            session.status = 'thinking';
            // IDEA-177: the card shows at once with a spinner, then fills in with the result.
            const tool: ToolCallInfo = { server: call.server, tool: call.tool, args: call.args, state: 'running', startedAt: Date.now() };
            const at = session.messages.push({ role: 'tool', from: target, text: '', tool }) - 1;
            this.changed();
            const isResearch = call.server === BUILTIN_TOOL_SERVER && call.tool === RESEARCH_TOOL;
            const execute = (box?: SandboxSpec): Promise<AgentActionResult & { images?: ImageChip[]; research?: ResearchView }> => (isBrowser ? this.runBrowser(session, call)
                : isResearch ? this.researchTool(session, call, at)
                : call.server === BUILTIN_TOOL_SERVER ? this.runBuiltin(session, this.withMadeWithTrailer(session, call), root, hooksRan, box, sandboxed.offline) : this.mcp.callTool(call.server, call.tool, call.args))
                .catch((error: unknown) => ({ text: error instanceof Error ? error.message : String(error), isError: true }));
            // IDEA-263: restricted mode runs commands in the OS sandbox; one the user approved to leave the project runs without it.
            const box = isRun && context && !outside ? sandboxSpec(policy.policy, context) : undefined;
            let ranAt = Date.now();
            let result = await execute(box);
            let recorded = false;
            let stoppedOnCard = false;
            if (result.sandboxDenied) {
                this.recordTool(session, call, rootPath, { decision, outcome: 'blocked', reason: SANDBOX_TEXT.blocked, output: result.text, sandboxed: true, startedAt });
                recorded = true;
                const choice = await this.askApproval(session, sandboxRetryApproval(typeof call.args.command === 'string' ? call.args.command : ''));
                stoppedOnCard = !!choice.stopped;
                if (!choice.stopped && choice.decision !== 'skip') {
                    ranAt = Date.now();
                    result = await execute(undefined);
                    decision = 'approved';
                    recorded = false;
                } else {
                    result = { text: `${result.text}\n${SANDBOX_TEXT.notApproved}`, isError: true };
                }
            }
            if (!recorded) {
                this.recordTool(session, call, rootPath, { decision, outcome: result.isError ? 'error' : 'ok', output: result.text, sandboxed: result.sandboxed, startedAt });
            }
            session.steps = session.steps.map(s => s.kind === 'run' && s.target === target && !s.done ? { ...s, done: true } : s);
            this.habitRunner.afterTool(session, call, !!result.isError);
            this.observeTool(session, call, result, root);
            const after = await this.afterToolHooks(session, call, result, Date.now() - ranAt, toolUseId);
            const done: AgentMessage = {
                role: 'tool', from: target, text: `${result.isError ? 'Error: ' : ''}${after.text ?? result.text}`, ...(result.images?.length ? { images: result.images } : {}),
                ...(result.research ? { research: result.research } : {}),
                tool: { ...tool, state: result.isError ? 'error' : 'done', endedAt: Date.now() }
            };
            if (session.messages[at] && session.messages[at].tool === tool) {
                session.messages[at] = done;
            } else {
                session.messages.push(done);
            }
            if (after.context) {
                session.messages.push({ role: 'user', text: after.context, hidden: true });
            }
            if (stoppedOnCard) {
                this.changed();
                return false;
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

    /** IDEA-263: one audit log line per agent tool call (what, when, the decision and the result). */
    protected recordTool(
        session: AgentSession, call: AgentToolCall, project: string | undefined,
        entry: Pick<AuditEntryInput, 'decision' | 'outcome' | 'reason' | 'output' | 'sandboxed'> & { readonly startedAt?: number; readonly summary?: string }
    ): void {
        const { startedAt, summary, ...rest } = entry;
        this.audit.record({
            sessionId: session.id, chat: session.title, ...(project ? { project } : {}),
            tool: `${call.server}/${call.tool}`, summary: summary ?? toolSummary(call), args: call.args,
            ...rest, ...(startedAt ? { durationMs: Date.now() - startedAt } : {})
        });
    }

    /**
     * IDEA-294: `.ingotignore` and the before-hooks of `hooks.json` for one tool call. `blocked` is the tool result when
     * the call must not run; `ask` forces the approval card.
     */
    protected async gateWithHooks(session: AgentSession, call: AgentToolCall, root: URI | undefined, toolUseId: string): Promise<{ blocked?: string; ask?: boolean; args?: Record<string, unknown> }> {
        const builtin = call.server === BUILTIN_TOOL_SERVER;
        const path = typeof call.args.path === 'string' ? call.args.path.trim().replace(/^\.\/+/, '') : '';
        if (builtin && call.tool === 'read_file' && path && (await this.agentIgnore(root)).agent(path)) {
            return { blocked: `"${path}" is in .ingotignore: agents cannot read it.` };
        }
        if (!root) {
            return {};
        }
        const cwd = root.path.fsPath();
        // IDEA-287: preToolUse sees every tool first; its `updated_input` replaces the arguments ("ask" is ignored, as in Cursor).
        const pre = await this.runEventHook(session, 'preToolUse', toolPayload(call, BUILTIN_TOOL_SERVER, toolUseId, cwd));
        if (pre?.decision.permission === 'deny') {
            this.pushHookCard(session, pre, hookToolLabel(call));
            this.changed();
            return { blocked: hookBlockedText(pre) };
        }
        const updated = pre?.extras.updatedInput ? { ...call.args, ...pre.extras.updatedInput } : undefined;
        const effective = updated ? { ...call, args: updated } : call;
        const withArgs = updated ? { args: updated } : {};
        const event: AgentHookEvent | undefined = builtin ? (call.tool === 'run' ? 'beforeShellExecution' : call.tool === 'read_file' ? 'beforeReadFile' : undefined) : 'beforeMCPExecution';
        if (!event || (event === 'beforeReadFile' && !await this.eventHooks.has(event, root))) {
            return withArgs;
        }
        const file = event === 'beforeReadFile' ? root.resolve(path) : undefined;
        const data = event === 'beforeShellExecution' ? shellPayload(String(effective.args.command ?? ''), effective.args.cwd ? String(effective.args.cwd) : cwd)
            : event === 'beforeReadFile' ? { file_path: file?.path.fsPath(), content: file ? await this.files.read(file).then(r => r.value, () => '') : '', attachments: [] }
                : mcpPayload(effective);
        const outcome = await this.runEventHook(session, event, data);
        if (!outcome || outcome.decision.permission === 'allow') {
            return withArgs;
        }
        this.pushHookCard(session, outcome, event === 'beforeShellExecution' ? String(effective.args.command ?? '') : event === 'beforeReadFile' ? path : hookToolLabel(call));
        this.changed();
        return outcome.decision.permission === 'deny' ? { blocked: hookBlockedText(outcome) } : { ask: true, ...withArgs };
    }

    /**
     * IDEA-288: checks a tool call against the project's sandbox preset. `offline` runs the command with the network blocked
     * (it stayed inside a sandbox without network); an approved escape runs without that block.
     */
    protected async sandboxGate(session: AgentSession, call: AgentToolCall, described: AgentAction | undefined, rootPath: string | undefined, cardRequired: boolean):
        Promise<{ decision: 'run' | 'ask' | 'refuse'; action?: AgentAction; offline: boolean; refusal?: string }> {
        const root = this.rootFor(session);
        const preset = root ? await this.sandbox.load(root) : this.sandbox.peek(root);
        const intent = rootPath ? toolIntent(call, BUILTIN_TOOL_SERVER, rootPath) : undefined;
        const check: SandboxCheck = intent ? checkSandbox(preset, intent) : { verdict: 'inside', reasons: [] };
        const outside = check.verdict === 'outside';
        const base = described ?? { kind: 'terminal' as const, label: `${call.server}/${call.tool}`, detail: '' };
        const action: AgentAction = outside ? { ...base, sandbox: sandboxNote(check) } : base;
        const offline = !outside && blocksNetwork(preset);
        const decision = gateDecision(preset.approvals, check, cardRequired);
        if (decision === 'refuse') {
            return { decision, action, offline, refusal: refusalText(preset, check, actionLine(action, 200)) };
        }
        if (decision === 'review') {
            return { decision: await this.autoReview(session, action, check) ? 'run' : 'ask', action, offline };
        }
        return { decision, action, offline };
    }

    /** IDEA-288: auto-review's verdict, noted in the chat. True runs the action without the card. */
    protected async autoReview(session: AgentSession, action: AgentAction, check: SandboxCheck): Promise<boolean> {
        const root = this.rootFor(session);
        const preset = this.sandbox.peek(root);
        const guidance = autoRunGuidanceText((await this.policy.load(root?.path.fsPath()).catch(() => undefined))?.autoRun);
        const assessed = await this.autoReviewer.assess(session.id, this.resolveModel(session.model), actionLine(action, 200), check, preset, guidance);
        const low = assessed.risk === 'low';
        session.messages.push({ role: 'system', text: `Auto-review: ${low ? 'low risk, running' : 'needs your approval'}: ${actionLine(action)}. ${assessed.reason}` });
        this.changed();
        return low;
    }

    /** IDEA-288: agent edits in a read-only sandbox (or to the policy file) follow the approvals preset. */
    protected async sandboxEdits(session: AgentSession, edits: readonly AgentEdit[], root: URI | undefined): Promise<AgentEdit[]> {
        const rootPath = root?.path.fsPath();
        if (!root || !rootPath || !edits.length) {
            return [...edits];
        }
        const preset = await this.sandbox.load(root);
        const check = checkSandbox(preset, editIntent(edits.map(edit => edit.path), rootPath));
        const action: AgentAction = { kind: 'write', label: 'Edit files', detail: edits.map(edit => edit.path).join(', '), ...(check.verdict === 'outside' ? { sandbox: sandboxNote(check) } : {}) };
        const decision = gateDecision(preset.approvals, check, false);
        if (decision === 'run' || (decision === 'review' && await this.autoReview(session, action, check))) {
            return [...edits];
        }
        const choice = decision === 'refuse' ? undefined : await this.askApproval(session, action);
        if (choice?.decision === 'run' || choice?.decision === 'always') {
            return [...edits];
        }
        await Promise.all(edits.map(edit => this.tracker.cancelStream(session.id, edit.path)));
        session.messages.push({ role: 'system', text: choice ? skippedResult(action, choice.reason) : refusalText(preset, check, actionLine(action, 200)) });
        this.changed();
        return [];
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
                    if (!SKIPPED_DIRS.has(entry.name) && !(entry.name.startsWith('.') && entry.name !== '.ingot') && rel !== INDEX_DIR && !ignored(rel)) {
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
                    if (!SKIPPED_DIRS.has(entry.name) && !(entry.name.startsWith('.') && entry.name !== '.ingot') && rel !== INDEX_DIR) {
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

    /** IDEA-287: the body of an Agent Requested (or any) project rule, by name. */
    protected fetchRuleTool(session: AgentSession, name: string): AgentActionResult {
        const rules = this.sessionRules.get(session.id) ?? [];
        const rule = findRule(rules, name);
        if (!rule) {
            const skill = findSkill(this.sessionSkills.get(session.id) ?? [], name);
            if (skill) {
                return { text: `Skill ${skill.name} (${skill.path})${skill.scope ? `, for files under ${skill.scope}/` : ''}:\n\n${skill.body}`, isError: false };
            }
            const known = requestableRules(rules).map(r => r.name).join(', ');
            return { text: `No rule or skill "${name}".${known ? ` Rules: ${known}.` : ''}`, isError: true };
        }
        return { text: `Rule ${rule.name} (${rule.path})${rule.scope ? `, for files under ${rule.scope}/` : ''}:\n\n${rule.body}`, isError: false };
    }

    /** Ingot's built-in agent tools (IDEA-109): git, terminal command, web search / fetch, file delete. */
    protected async runBuiltin(
        session: AgentSession, call: AgentToolCall, root: URI | undefined, hooksRan = false, sandbox?: SandboxSpec, offline = false
    ): Promise<AgentActionResult> {
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
            if (isCodeTool(call.tool)) {
                return await this.runCodeTool(session, call, root);
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
                case FETCH_RULE_TOOL: return this.fetchRuleTool(session, str(call.args.name));
                case USE_HABIT_TOOL: return this.habitRunner.use(session, str(call.args.name));
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
                    const timeout = libraryCommandNeedsTime(command) ? Math.max(LIBRARY_COMMAND_TIMEOUT_SECONDS, this.runSettings.foregroundTimeoutSeconds) : undefined;
                    return await this.runCommand(cwd, command, call.args.background === true, undefined, timeout, sandbox, offline ? NETWORK_OFF_ENV : undefined);
                }
                case RUN_TESTS_TOOL: return await this.runTestsTool(session, call.args);
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
                case ARTIFACT_TOOL: {
                    const parsed = parseArtifactArgs(call.args);
                    if ('error' in parsed) {
                        return { text: parsed.error, isError: true };
                    }
                    const saved = await this.artifacts.write(session, parsed.name, parsed.content);
                    return saved
                        ? { text: `Saved ${saved}. The user reviews it in the Artifacts view; their comments come back as messages.`, isError: false }
                        : { text: 'No run folder to save the artifact in.', isError: true };
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
                default: return {
                    text: unknownToolResult(call.tool, [...WORKSPACE_TOOLS, ...BUILTIN_TOOLS].map(t => t.name)
                        .filter(name => builtinToolEnabled(name, { terminal: this.runSettings.enabled, browser: browserToolSettings(key => this.preferences.get(key)).enabled }))),
                    isError: true
                };
            }
        } catch (error) {
            return { text: error instanceof Error ? error.message : String(error), isError: true };
        }
    }

    /** IDEA-259: language-server tools. Rename and organize imports become reviewable edits like any agent edit. */
    protected async runCodeTool(session: AgentSession, call: AgentToolCall, root: URI): Promise<AgentActionResult> {
        const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
        const fileUri = (path: string): URI | undefined => {
            const uri = this.safeUri(root, path);
            return uri && uri !== root ? uri : undefined;
        };
        if (isCodeEditTool(call.tool) && !modeInfo(session.mode).canEdit) {
            return { text: `${modeInfo(session.mode).label} mode does not change files; switch to Agent to ${call.tool === 'rename_symbol' ? 'rename' : 'organize imports'}.`, isError: true };
        }
        if (call.tool === 'diagnostics') {
            const path = str(call.args.path);
            const uri = path ? fileUri(path) : undefined;
            if (path && !uri) {
                return { text: `"${path}" is not a file path inside the project.`, isError: true };
            }
            const wanted = severityFilter(call.args.severity);
            const found = (await this.codeTools.diagnostics(root, uri)).filter(d => wanted(d.severity));
            return { text: formatDiagnostics(found, path || 'the project (files the language servers have checked)'), isError: false };
        }
        if (call.tool === 'organize_imports') {
            const path = str(call.args.path);
            const uri = fileUri(path);
            if (!uri) {
                return { text: `"${path}" is not a file path inside the project.`, isError: true };
            }
            const result = await this.codeTools.organizeImportsEdits(uri);
            return result.ranCommand
                ? { text: `Organized imports in ${path} (the language server saved the file).`, isError: false }
                : this.applyCodeEdits(session, root, result, 'Organized imports', `Imports in ${path} are already organized.`);
        }
        const target = parseSymbolTarget(call.args);
        if ('error' in target) {
            return { text: target.error, isError: true };
        }
        const uri = fileUri(target.path);
        if (!uri) {
            return { text: `"${target.path}" is not a file path inside the project.`, isError: true };
        }
        const text = await this.codeTools.text(uri).catch(() => undefined);
        if (text === undefined) {
            return { text: `No file "${target.path}". Use ingot/glob to find it.`, isError: true };
        }
        const at = findSymbolPosition(text, target);
        if (!at) {
            return { text: `"${target.symbol ?? `line ${target.line}`}" is not in ${target.path}${target.symbol && target.line ? ` near line ${target.line}` : ''}.`, isError: true };
        }
        const where = `${target.path}:${at.line}:${at.column}`;
        switch (call.tool) {
            case 'go_to_definition': return { text: `${where}\n${formatLocations('definitions', await this.codeTools.definitions(root, uri, at))}`, isError: false };
            case 'find_references': return { text: `${where}\n${formatLocations('references', await this.codeTools.references(root, uri, at))}`, isError: false };
            default: {
                const newName = parseNewName(call.args);
                if (typeof newName !== 'string') {
                    return { text: newName.error, isError: true };
                }
                const result = await this.codeTools.renameEdits(uri, at, newName);
                return this.applyCodeEdits(session, root, result, `Renamed ${target.symbol ?? where} to ${newName}`, 'The language server returned no edits.');
            }
        }
    }

    /** IDEA-314: a chat in Deep research mode sends the question to the Ingot server instead of a chat model. */
    protected startResearchTurn(session: AgentSession, question: string): void {
        if (!this.models.isProviderConfigured('ingot')) {
            session.messages.push({ role: 'system', text: SIGN_IN_MESSAGE });
            session.status = 'idle';
            session.updatedAt = Date.now();
            this.changed();
            return;
        }
        const generation = (this.loopGeneration.get(session.id) ?? 0) + 1;
        this.loopGeneration.set(session.id, generation);
        this.cancelled.delete(session.id);
        const index = session.messages.push({ role: 'agent', text: '', research: emptyResearch(question, DEFAULT_RESEARCH_COST_USD) }) - 1;
        session.status = 'thinking';
        session.updatedAt = Date.now();
        this.changed();
        void this.runResearch(session, question, view => {
            if (!this.stale(session.id, generation) && session.messages[index]) {
                session.messages[index] = { ...session.messages[index], research: view };
                session.updatedAt = Date.now();
                this.poke();
            }
        }).then(({ view, markdown }) => {
            if (this.stale(session.id, generation) && view.stage !== 'stopped') {
                return;
            }
            const text = view.stage === 'done' ? stripResearchFooter(markdown) : view.error ?? (view.stage === 'stopped' ? RESEARCH_STOPPED : '');
            if (session.messages[index]) {
                session.messages[index] = { ...session.messages[index], text, research: view };
            }
            session.status = view.stage === 'error' ? 'error' : 'idle';
            session.updatedAt = Date.now();
            this.changed();
        });
    }

    /** ingot/deep_research: the same run, drawn live on the tool card; the agent gets the cited answer and the sources. */
    protected async researchTool(session: AgentSession, call: AgentToolCall, at: number): Promise<AgentActionResult & { research?: ResearchView }> {
        const question = typeof call.args.question === 'string' ? call.args.question.trim() : '';
        if (!question) {
            return { text: 'A question is required.', isError: true };
        }
        const tool = session.messages[at]?.tool;
        const { view, answer } = await this.runResearch(session, question, live => {
            if (session.messages[at]?.tool === tool) {
                session.messages[at] = { ...session.messages[at], research: live };
                this.poke();
            }
        });
        return view.stage === 'done'
            ? { text: researchToolResult(view, answer), isError: false, research: view }
            : { text: view.error ?? RESEARCH_STOPPED, isError: true, research: view };
    }

    /** Starts a run on the server and polls its events until it ends or the chat is stopped. */
    protected async runResearch(session: AgentSession, question: string, update: (view: ResearchView) => void): Promise<{ view: ResearchView; markdown: string; answer: string }> {
        let view = emptyResearch(question, DEFAULT_RESEARCH_COST_USD);
        let markdown = '';
        let answer = '';
        let id: string | undefined;
        let stopped = false;
        const stop = (): void => {
            stopped = true;
            if (id) {
                void this.research.cancel(id).catch(() => undefined);
            }
        };
        this.running.set(session.id, stop);
        try {
            id = await this.research.start(question);
            for (let from = 0; ;) {
                const poll: ResearchPoll = stopped ? { events: [], done: false } : await this.research.poll(id, from);
                from += poll.events.length;
                for (const event of poll.events) {
                    view = applyResearchEvent(view, event);
                    if (event.type === 'answer') {
                        markdown = event.markdown;
                        answer = event.answer;
                    }
                }
                if (stopped || this.cancelled.has(session.id)) {
                    stop();
                    view = { ...view, stage: 'stopped', status: RESEARCH_STOPPED };
                } else if (poll.done && view.stage !== 'done' && view.stage !== 'error') {
                    view = { ...view, stage: 'error', status: '', error: poll.error ?? researchErrorText('research_failed') };
                }
                update(view);
                if (poll.done || view.stage === 'stopped') {
                    return { view, markdown, answer };
                }
                await new Promise(resolve => setTimeout(resolve, RESEARCH_POLL_MS));
            }
        } catch (error) {
            view = { ...view, stage: 'error', status: '', error: error instanceof Error ? error.message : String(error) };
            update(view);
            return { view, markdown, answer };
        } finally {
            if (this.running.get(session.id) === stop) {
                this.running.delete(session.id);
            }
        }
    }

    /** Text edits from a language server, applied per file through the review (Accept / Reject) like any agent edit. */
    protected async applyCodeEdits(session: AgentSession, root: URI, result: CodeEditResult, summary: string, empty: string): Promise<AgentActionResult> {
        const edits: AgentEdit[] = [];
        const outside: string[] = [];
        for (const [key, fileEdits] of result.edits) {
            const uri = new URI(key);
            const path = root.relative(uri)?.toString();
            if (!path) {
                outside.push(uri.path.fsPath());
                continue;
            }
            const before = await this.codeTools.text(uri);
            const after = applyTextEdits(before, fileEdits);
            if (after !== before) {
                edits.push({ path, content: after });
            }
        }
        if (!edits.length) {
            return { text: outside.length ? `Refused: every edit was outside the project (${outside.join(', ')}).` : empty, isError: outside.length > 0 };
        }
        await this.applyEdits(session, edits, root);
        return {
            text: [
                `${summary} in ${edits.length} file(s): ${edits.map(edit => edit.path).join(', ')}. The edits wait for the user's Accept or Reject.`,
                ...(outside.length ? [`Skipped files outside the project: ${outside.join(', ')}.`] : []),
                ...(result.skipped.length ? [`Not applied: ${result.skipped.join(', ')}.`] : [])
            ].join('\n'),
            isError: false
        };
    }

    /** IDEA-261: one step of the edit -> run_tests -> fix loop. A red run counts; past the cap the tool refuses to run. */
    protected async runTestsTool(session: AgentSession, args: Record<string, unknown>): Promise<AgentActionResult> {
        if (!this.runSettings.enabled) {
            return { text: 'Running commands is turned off in Settings › Tools › Agent tools.', isError: true };
        }
        const max = clampIterations(this.preferences.get<number>(TEST_LOOP_PREFS.maxIterations, DEFAULT_TEST_ITERATIONS));
        const previous = this.testIterations.get(session.id) ?? 0;
        if (previous >= max) {
            return { text: `${TESTS_CAPPED_TEXT} (${previous} of ${max} runs used.)`, isError: true };
        }
        const result = await this.tests.run(requestFromArgs(args, this.tests.allResults));
        const step = testLoopStep(previous, max, result.status);
        this.testIterations.set(session.id, result.status === 'passed' ? 0 : step.iteration);
        return { text: formatForAgent(result, step), isError: result.status !== 'passed' };
    }

    /** IDEA-130: the agent's browser tools, run in the Ingot browser panel (they wait while the user has control). */
    protected async runBrowser(session: AgentSession, call: AgentToolCall): Promise<AgentActionResult & { images?: ImageChip[] }> {
        if (!browserToolSettings(key => this.preferences.get(key)).enabled) {
            return { text: 'The browser tool is turned off in Settings › Tools › Agent tools.', isError: true };
        }
        if (!this.browserOn(session)) {
            return { text: BROWSER_RUN_ONLY_TEXT, isError: true };
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
                if (data) {
                    await this.artifacts.writeScreenshot(session, data).catch(() => undefined);
                }
                return { ...text(shot.text), ...(data ? { images: [{ id: `shot-${Date.now().toString(36)}`, name: 'screenshot.png', mediaType: 'image/png', data }] } : {}) };
            }
            case 'browser_console': return text(await this.browser.agentConsole(session.id, consoleFilter(a.level)));
            case 'browser_network': return text(await this.browser.agentNetwork(session.id));
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
    protected async runCommand(
        cwd: string, command: string, background: boolean, onOutput?: (text: string) => void, timeoutSecondsArg?: number, sandbox?: SandboxSpec,
        env?: Readonly<Record<string, string>>
    ): Promise<AgentActionResult> {
        if (!command.trim()) {
            return { text: 'No command given.', isError: true };
        }
        const settings = this.runSettings;
        if (!settings.enabled) {
            return { text: 'Running commands is turned off in Settings › Tools › Agent tools.', isError: true };
        }
        const service = this.processes.service;
        if (background) {
            const info = await service.start({ cwd, command, background: true, origin: 'agent', ...(sandbox ? { sandbox } : {}), ...(env ? { env } : {}) });
            const out = await service.output(info.id, settings.maxOutputChars);
            const state = info.status === 'running' ? `Running in the background as ${info.id}${info.ports.length ? ` on port ${info.ports.join(', ')}` : ''}.` : `Exited with code ${info.exitCode ?? '?'}.`;
            return {
                text: `${state} Read more output with ingot/process_output, stop it with ingot/process_stop.\n${out?.text.trimEnd() ?? ''}`.trim(), isError: info.status === 'failed',
                ...(info.sandboxed ? { sandboxed: true } : {})
            };
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
            const result = await service.run({ cwd, command, origin: 'agent', timeoutMs: timeoutSeconds * 1000, maxOutput: settings.maxOutputChars, ...(sandbox ? { sandbox } : {}), ...(env ? { env } : {}) });
            const status = result.movedToBackground
                ? `Still running after ${timeoutSeconds}s: moved to the background as ${result.info.id}${result.info.ports.length ? ` (port ${result.info.ports.join(', ')})` : ''}. Use ingot/process_output or ingot/process_stop.`
                : result.info.status === 'stopped' ? 'Stopped.' : `Exit code ${result.info.exitCode ?? '?'}.`;
            return {
                text: `${result.output.trimEnd()}\n${status}`.trim(), isError: result.movedToBackground || result.info.status !== 'exited', movedToBackground: result.movedToBackground,
                ...(result.info.sandboxed ? { sandboxed: true } : {}), ...(result.sandboxDenied ? { sandboxDenied: true } : {})
            };
        } finally {
            if (poll) {
                clearInterval(poll);
            }
        }
    }

    /** One nudge when a library prompt never becomes create_library, and another when its tests fail. */
    protected nudgeLibrary(session: AgentSession, prompt: string): boolean {
        if (this.libraryNudged.has(session.id) || this.libraries.has(session.id) || !this.libraryTemplateOn()) {
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

    protected toolSwitches(session: AgentSession): BuiltinToolSwitches {
        return {
            terminal: this.runSettings.enabled,
            browser: this.browserOn(session),
            template: this.libraryTemplateOn()
        };
    }

    protected libraryTemplateOn(): boolean {
        return this.preferences.get<boolean>(LIBRARY_TEMPLATE_PREF, true) !== false;
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
        const [text, agent] = await Promise.all([this.files.read(root.resolve('.gitignore')).then(file => file.value, () => ''), this.agentIgnore(root)]);
        const git = compileGitignore(text);
        return rel => git(rel) || agent.agent(rel);
    }

    /** IDEA-287: the open project's rules, for the composer's @ menu. */
    async mentionRules(): Promise<readonly ProjectRule[]> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        return root ? (await this.projectConfig.load(root).catch(() => undefined))?.rules ?? [] : [];
    }

    /** IDEA-294: `.ingotignore` / `.cursorignore` of the project (none without a project). */
    async agentIgnore(root: URI | undefined): Promise<IgnoreRules> {
        return this.projectConfig.ignoreRules(root);
    }

    /** Ripgrep when the backend has it. Undefined asks the caller to walk the tree. */
    protected async searchWithRg(root: URI, query: { pattern?: string; path?: string; glob?: string; regex?: boolean; files: boolean }): Promise<AgentActionResult | undefined> {
        const cwd = root.path.fsPath();
        if (!cwd) {
            return undefined;
        }
        const found = await this.processes.service.workspaceSearch({ cwd, ...query, agentIgnore: true }).catch(() => undefined);
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
        this.observeTool(session, { server: BUILTIN_TOOL_SERVER, tool: 'run', args: { command } }, result, this.rootFor(session));
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
        const loop = this.loopOf(session);
        if (this.modelLoops.has(session.id)) {
            return;
        }
        if (loop.promised) {
            loop.promised = false;
            session.messages.push({ role: 'user', text: CONTINUE_NUDGE, hidden: true });
            await this.runModel(session);
            return;
        }
        if (!loop.wants) {
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
        if (!path || content === undefined || !root || !modeInfo(session.mode).canEdit || !isSafeRelativePath(path) || this.lockedFor(session, path) || this.frozen.isFileFrozen(path)) {
            return;
        }
        // IDEA-288: an edit the sandbox stops shows only once it is approved.
        if (checkSandbox(this.sandbox.peek(root), editIntent([path], root.path.fsPath())).verdict === 'outside') {
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
        const rootPath = root?.path.fsPath();
        const policy = await this.policy.load(rootPath);
        const editCall = (path: string): AgentToolCall => ({ server: BUILTIN_TOOL_SERVER, tool: 'edit', args: { path } });
        let applied = 0;
        for (const [b, batch] of batches.entries()) {
            for (const edit of batch) {
                applied++;
                if (!root || !isSafeRelativePath(edit.path)) {
                    session.messages.push({ role: 'system', text: `Skipped an edit to "${edit.path}": agents can only change files inside the project.` });
                    this.recordTool(session, editCall(edit.path), rootPath, { decision: 'denied', outcome: 'blocked', summary: `Edit ${edit.path}`, reason: 'outside the project' });
                    continue;
                }
                // IDEA-263: `paths.writable` / `paths.readOnly` in `.ingot/policy.json`.
                const write = checkEdit(policy, edit.path);
                if (write.verdict === 'deny') {
                    const source = policySourceOf(write.reason, policy.origins);
                    session.messages.push({ role: 'system', text: `Skipped an edit to "${edit.path}": ${source} ${write.reason}.` });
                    this.recordTool(session, editCall(edit.path), rootPath, { decision: 'denied', outcome: 'blocked', summary: `Edit ${edit.path}`, reason: `${source} ${write.reason}` });
                    await this.tracker.cancelStream(session.id, edit.path);
                    continue;
                }
                if ((await this.agentIgnore(root)).agent(edit.path.replace(/^\.\/+/, ''))) {
                    session.messages.push({ role: 'system', text: `Skipped an edit to "${edit.path}": it is in .ingotignore.` });
                    await this.tracker.cancelStream(session.id, edit.path);
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
                void this.runEventHook(session, 'afterFileEdit', { file_path: root.resolve(edit.path).path.fsPath(), edits: [{ old_string: change.oldText, new_string: edit.content }] });
                this.loopOf(session).edits.push(edit.path);
                this.dooms.set(session.id, observeEdit(this.doomOf(session), edit.path, edit.content));
                const stats = this.tracker.stats(change);
                this.recordTool(session, editCall(edit.path), rootPath, {
                    decision: 'auto', outcome: 'ok', summary: `Edit ${edit.path} (+${stats.added} −${stats.removed})`, ...(review.autoAccept ? { output: 'Accepted automatically.' } : {})
                });
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
            const resume = kept.length && (this.loopOf(session).wants || this.loopOf(session).promised) && !this.modelLoops.has(session.id);
            if (resume) {
                void this.resumeLoop(session).then(() => this.afterGoalTurn(session));
            }
            if (session.status === 'review') {
                session.status = kept.length ? 'done' : 'idle';
            }
            session.updatedAt = Date.now();
            this.changed();
            if (!resume) {
                this.afterGoalTurn(session);
            }
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
     * Edit a sent user message in place: restore files to before that turn (unless `revert` is false, IDEA-280),
     * drop it and everything after it, then send the new text so the agent runs again from there.
     */
    async editUserMessage(sessionId: string, index: number, text: string, revert = true): Promise<void> {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        const trimmed = text.trim();
        if (!session || message?.role !== 'user' || message.hidden || !trimmed) {
            return;
        }
        this.stop(sessionId);
        this.selected = sessionId;
        try {
            if (revert) {
                await this.tracker.revertTo(sessionId, index, restorePlan(this.tracker.checkpoints, sessionId, index));
            }
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
        this.testIterations.delete(sessionId);
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

    /** IDEA-267: suggested next prompts on the last visible reply of the turn (the model's, or ones that fit what happened). */
    protected attachFollowUps(session: AgentSession, fromModel: readonly string[], edited: boolean): void {
        if (session.parent || session.status === 'error') {
            return;
        }
        const index = session.messages.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'agent' && !m.hidden && m.text)?.i;
        if (index === undefined) {
            return;
        }
        const latest = new Map(this.loopOf(session).checks.map(check => [check.command, check.passed]));
        const checks: CheckOutcome = !latest.size ? 'none' : [...latest.values()].every(Boolean) ? 'passed' : 'failed';
        session.messages[index] = { ...session.messages[index], followUps: followUpsFor(fromModel, { edited, checks }) };
    }

    /** Saves repo facts (REMEMBER:) and preferences (PREFERENCE:) when Generate memories is on, and shows them with Undo. */
    protected async saveMemories(session: AgentSession, notes: readonly MemoryNote[], root: URI | undefined): Promise<void> {
        if (!notes.length || !this.memoryStore.generate) {
            return;
        }
        for (const note of notes) {
            const scope = root ? DEFAULT_SCOPE[note.kind] : 'global';
            const memory = await this.memoryStore.save(scope, note.text, root, note.kind).catch(() => undefined);
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

    /** IDEA-296: a "Saved to Habits" note in the open chat (none is open: nothing to show it in). */
    /** IDEA-296: Habits learned or saved a pattern: a "Saved to Habits" note in the current chat that opens it, with Undo. */
    addHabitNote(event: HabitEvent): void {
        const session = this.current;
        if (!session) {
            return;
        }
        this.addNote(session, { kind: 'habit', text: HABIT_NOTE_LABELS.saved, detail: habitNoteDetail(event), focus: event.focus, undo: event.undo });
    }

    /** A note whose Undo ran elsewhere (Habits put the pattern back): shown as undone. */
    markNoteUndone(sessionId: string, index: number): void {
        const session = this.items.find(s => s.id === sessionId);
        const message = session?.messages[index];
        if (!session || !message?.note) {
            return;
        }
        session.messages[index] = { ...message, note: { ...message.note, undone: true } };
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
        this.approvePlan(session);
        this.noRoute.add(session.id);
        this.send(BUILD_PROMPT);
    }

    /** IDEA-306: Build approves the plan: saved under .ingot/plans/, reviewed against the diff after the run, learned as a template. */
    protected approvePlan(session: AgentSession): void {
        const steps = session.plan.map(p => p.text).filter(Boolean);
        if (!steps.length) {
            return;
        }
        const asked = [...session.messages].reverse().find(m => m.role === 'user' && !m.hidden && m.text !== BUILD_PROMPT)?.text ?? session.title;
        const plan = this.planReview.approve(session.title, asked, steps);
        session.approvedPlan = plan;
        const root = this.rootFor(session);
        if (root) {
            void this.planReview.save(root, plan).catch(() => undefined);
        }
        void this.planReview.learnTemplate(root, plan).then(saved => saved && this.noteSaved(session, saved)).catch(() => undefined);
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

    /** The current chat, while its run is heavy enough to hand off to Rex (many files, a multi-step plan or a long run). */
    get heavyRun(): AgentSession | undefined {
        const session = this.current;
        if (!session || session.parent || session.agent === 'zaprex') {
            return undefined;
        }
        const started = this.isRunning(session.id) ? this.runStarted.get(session.id) : undefined;
        const prompt = [...session.messages].reverse().find(m => m.role === 'user')?.text ?? '';
        return isHeavyRunWeight(runWeight(session, Date.now(), started, parseMentions(prompt))) ? session : undefined;
    }

    /** "Hand off to Rex": Zaprex takes the open Harmony offer, else one scoped piece of the run; with nothing left to take, the Zaprex app opens. */
    handOffToRex(sessionId: string): AgentSession | undefined {
        const session = this.find(sessionId);
        if (!session) {
            return undefined;
        }
        if (!this.harmonyOffers.has(sessionId)) {
            const goal = [...session.messages].reverse().find(m => m.role === 'user')?.text ?? session.title;
            const taken = this.zaprexPieces(sessionId).map(p => p.piece).filter(k => !!k);
            const piece = pickHarmonyPiece(session.plan.map(p => p.text), goal, taken);
            if (!piece) {
                void this.zaprex.openApp();
                return undefined;
            }
            this.harmonyOffers.set(sessionId, piece);
        }
        return this.acceptHarmony(sessionId);
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

    /**
     * IDEA-291: the `ingot/task` calls of one reply run as parallel subagents. Each starts with only its prompt
     * (clean context), optionally in its own git worktree; its card in the lead chat fills in with the summary.
     */
    protected async runTasks(lead: AgentSession, calls: readonly AgentToolCall[], rootPath: string | undefined): Promise<void> {
        const from = `${BUILTIN_TOOL_SERVER}/${TASK_TOOL}`;
        const card = (call: AgentToolCall): AgentMessage => {
            const message: AgentMessage = { role: 'tool', from, text: '', tool: { server: call.server, tool: call.tool, args: call.args, state: 'running', startedAt: Date.now() } };
            lead.messages.push(message);
            return message;
        };
        const settle = (message: AgentMessage, text: string, isError: boolean): void => {
            const done: AgentMessage = { ...message, text: `${isError ? 'Error: ' : ''}${text}`, ...(message.tool ? { tool: { ...message.tool, state: isError ? 'error' : 'done', endedAt: Date.now() } } : {}) };
            const at = lead.messages.indexOf(message);
            if (at >= 0) {
                lead.messages[at] = done;
            } else {
                lead.messages.push(done);
            }
        };
        if (lead.parent) {
            calls.forEach(call => settle(card(call), NESTED_TASK_ERROR, true));
            this.changed();
            return;
        }
        calls.slice(MAX_PARALLEL_TASKS).forEach(call => settle(card(call), TOO_MANY_TASKS, true));
        const subagents = await this.projectConfig.loadSubagents(this.rootFor(lead)).catch(() => []);
        const jobs = calls.slice(0, MAX_PARALLEL_TASKS).map(call => {
            const parsed = parseTaskArgs(call.args);
            const agent = 'error' in parsed || !parsed.agent ? undefined : findSubagent(subagents, parsed.agent);
            const task = 'error' in parsed || !parsed.agent || agent ? parsed : { error: unknownSubagentError(parsed.agent, subagents) };
            return { message: card(call), task, agent };
        });
        const started = jobs.flatMap(job => 'error' in job.task ? [] : [{ job, run: this.startTask(lead, job.task, rootPath, job.agent) }]);
        jobs.filter(job => 'error' in job.task).forEach(job => settle(job.message, (job.task as { error: string }).error, true));
        if (started.length) {
            lead.messages.push({ role: 'system', text: `Started ${started.length} ${started.length === 1 ? 'subagent' : 'subagents'}: ${started.map(s => s.run.child.title).join(' · ')}`, refs: started.map(s => s.run.child.id) });
            lead.steps = [...lead.steps, ...started.map(s => ({ kind: 'run' as const, target: `${SUBAGENT_STEP_PREFIX}${s.run.child.title}`, done: false }))];
        }
        lead.status = 'thinking';
        this.changed();
        await Promise.all(started.map(async ({ job, run }) => {
            const outcome = await run.done;
            settle(job.message, taskResultText(outcome), outcome.status === 'error');
            lead.steps = lead.steps.map(s => s.target === `${SUBAGENT_STEP_PREFIX}${run.child.title}` ? { ...s, done: true } : s);
            this.changed();
        }));
    }

    protected startTask(lead: AgentSession, task: TaskRequest, rootPath: string | undefined, agent?: CustomSubagent): { child: AgentSession; done: Promise<TaskOutcome> } {
        const instructions = agent ? subagentInstructions(agent) : '';
        const model = agent?.model && this.models.isModelConfigured(agent.model) ? agent.model : lead.model;
        const child: AgentSession = {
            id: newChatId(), title: task.description, status: 'thinking', updatedAt: Date.now(), mode: 'agent', model,
            messages: [{ role: 'user', text: task.prompt, expanded: taskChildPrompt(task, undefined, instructions) }],
            plan: [], steps: [], changes: [], project: lead.project, open: false, openedAt: Date.now(), parent: lead.id, agent: 'ingot',
            ...(agent ? { subagent: { name: agent.name, readonly: agent.readonly } } : {})
        };
        this.items = [child, ...this.items];
        const fail = (error: string): TaskOutcome => {
            child.status = 'error';
            child.messages.push({ role: 'system', text: error });
            this.changed();
            return { title: child.title, status: 'error', reply: '', files: [], error };
        };
        let worktree: TaskOutcome['worktree'];
        const begun = Date.now();
        const info = { id: child.id, type: agent?.name ?? TASK_SUBAGENT_TYPE, task: task.prompt, parentId: lead.id, model: this.modelFor(child), parallel: true };
        const done = (async (): Promise<TaskOutcome> => {
            const gate = await this.runEventHook(lead, 'subagentStart', subagentStartPayload(info));
            if (gate && gate.decision.permission !== 'allow') {
                return fail(`${HOOK_TEXT.subagentBlocked}${gate.decision.userMessage ? `: ${gate.decision.userMessage}` : '.'}`);
            }
            if (task.worktree) {
                if (!rootPath) {
                    return fail('Open a project folder to run a subagent in a worktree.');
                }
                try {
                    const name = worktreeName(child.id);
                    const branch = worktreeBranch(name);
                    const path = (await this.git.run(rootPath, { kind: 'worktreeAdd', name, branch })).output.trim();
                    worktree = { path, branch };
                    child.worktree = { path: URI.fromFilePath(path).toString(), branch };
                    child.project = child.worktree.path;
                    child.messages[0] = { ...child.messages[0], expanded: taskChildPrompt(task, worktree, instructions) };
                    this.changed();
                } catch (error) {
                    return fail(`Could not create a git worktree: ${error instanceof Error ? error.message : String(error)}`);
                }
                // IDEA-287: worktrees.json setup (install dependencies, copy env files) runs before the subagent starts.
                const setup = await this.worktreeSetup.run(rootPath, worktree.path).catch((error: unknown) =>
                    ({ source: '', ran: 0, ok: false, output: '', error: error instanceof Error ? error.message : String(error) }));
                if (setup) {
                    child.messages.push({ role: 'system', text: worktreeSetupSummary(setup) });
                    this.changed();
                }
            }
            let reply = '';
            let files: string[] = [];
            let stopped = false;
            // IDEA-287: a subagentStop hook's `followup_message` sends the subagent another turn, up to the hook's loop_limit.
            for (let loops = 0; ; loops++) {
                await this.runModel(child).catch((error: unknown) => {
                    child.status = 'error';
                    child.messages.push({ role: 'system', text: `The subagent stopped: ${error instanceof Error ? error.message : String(error)}` });
                });
                stopped = this.cancelled.has(child.id);
                if (!stopped && (child.status === 'thinking' || child.status === 'editing' || child.status === 'idle')) {
                    child.status = 'done';
                }
                child.updatedAt = Date.now();
                this.changed();
                reply = [...child.messages].reverse().find(m => m.role === 'agent' && !m.hidden && m.text)?.text ?? '';
                files = [...new Set([...child.changes.map(c => c.label), ...child.steps.filter(s => s.kind === 'edit').map(s => s.target)])];
                const status = stopped ? 'aborted' : child.status === 'error' ? 'error' : 'completed';
                const outcome = await this.runEventHook(lead, 'subagentStop', subagentStopPayload(info, {
                    status, description: task.description, summary: reply, durationMs: Date.now() - begun, messageCount: child.messages.length,
                    toolCallCount: child.messages.filter(m => m.role === 'tool').length, loopCount: loops, files
                }), loops);
                const followUp = child.status === 'done' ? outcome?.extras.followupMessage : undefined;
                if (!followUp) {
                    break;
                }
                child.messages.push({ role: 'user', text: followUp });
                child.status = 'thinking';
                this.changed();
            }
            return {
                title: child.title, reply, files, ...(worktree ? { worktree } : {}),
                status: stopped ? 'stopped' : child.status === 'error' ? 'error' : child.status === 'review' ? 'review' : 'done'
            };
        })();
        return { child, done };
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
                    session.route = undefined;
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
        const usage = session.context?.usage;
        const hook = await this.runEventHook(session, 'preCompact', preCompactPayload({
            trigger: 'manual', tokens: usage?.total ?? estimateTokens(this.historyFor(session).map(m => m.content).join('\n')),
            window: usage?.window ?? findModel(this.modelFor(session))?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
            messageCount: session.messages.length, firstCompaction: !this.compacted.has(session.id)
        }));
        this.compacted.add(session.id);
        const summary = await this.summaryOf(session);
        session.messages.splice(0, session.messages.length, { role: 'agent', text: `Conversation compacted. Summary so far:\n${summary}` });
        if (hook?.decision.userMessage) {
            session.messages.push({ role: 'system', text: `${HOOK_TEXT.compactNote}: ${hook.decision.userMessage}` });
        }
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
        this.persistTimer = setTimeout(() => this.persist(), 300);
    }

    protected persist(): void {
        const workspace = this.windowWorkspace;
        if (!workspace) {
            return;
        }
        const stored = parseChats(localStorage.getItem(CHATS_STORAGE_KEY));
        localStorage.setItem(CHATS_STORAGE_KEY, serializeChats(mergeWindowChats(stored, this.items, workspace)));
    }
}
