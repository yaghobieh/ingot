import {
    AGENT_HOOK_EVENTS, AGENT_HOOK_MAX_TIMEOUT_SECONDS, AGENT_HOOK_TIMEOUT_SECONDS, ASK_DENIES_EVENTS, ASK_IGNORED_EVENTS, DEFAULT_HOOK_LOOP_LIMIT, GATING_HOOK_EVENTS,
    HOOK_CLAUDE_PROJECT_ENV, HOOK_CURSOR_PROJECT_ENV, HOOK_DENY_EXIT_CODE, HOOK_MATCH_VALUES, HOOK_PROJECT_ENV, HOOK_TOOL_NAMES, HOOK_USER_EMAIL_ENV, HOOK_VERSION_ENV,
    MATCH_ALL, MCP_TOOL_PREFIX, PROMPT_HOOK_ARGUMENTS
} from './agent-hooks.consts';
import type {
    AgentHookCommand, AgentHookEvent, AgentHookOutcome, AgentHooksConfig, AgentHooksParse, HookCommandResult, HookDecision, HookFileSource, HookPayloadBase,
    HookPermission, HookResponse, HookResponseExtras, HookRunOutput
} from './agent-hooks.types';

const PERMISSIONS: readonly string[] = ['allow', 'deny', 'ask'];
const RANK: Record<HookPermission, number> = { allow: 0, ask: 1, deny: 2 };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

export const isAgentHookEvent = (name: string): name is AgentHookEvent => (AGENT_HOOK_EVENTS as readonly string[]).includes(name);
export const isGatingEvent = (event: AgentHookEvent): boolean => GATING_HOOK_EVENTS.includes(event);

const validMatcher = (matcher: string): boolean => {
    try {
        new RegExp(matcher);
        return true;
    } catch {
        return false;
    }
};

/** One entry of an event's list: `"cmd"`, `{ "command" }` or `{ "type": "prompt", "prompt" }`, with Cursor's per-hook options. */
export const parseHookEntry = (event: string, item: unknown, i: number, file: HookFileSource, errors: string[]): AgentHookCommand[] => {
    const entry = typeof item === 'string' ? { command: item } : isObject(item) ? item : {};
    const prompt = entry.type === 'prompt';
    const raw = prompt ? entry.prompt ?? entry.command : entry.command;
    const command = typeof raw === 'string' ? raw.trim() : '';
    if (!command) {
        errors.push(`${file.source}: "${event}" entry ${i + 1} needs a "${prompt ? 'prompt' : 'command'}".`);
        return [];
    }
    const matcher = typeof entry.matcher === 'string' && entry.matcher !== '' && entry.matcher !== MATCH_ALL ? entry.matcher : undefined;
    if (matcher !== undefined && !validMatcher(matcher)) {
        errors.push(`${file.source}: "${event}" entry ${i + 1} has a matcher that is not a valid regex (${matcher}).`);
        return [];
    }
    const timeout = typeof entry.timeout === 'number' && entry.timeout > 0 ? Math.min(entry.timeout, AGENT_HOOK_MAX_TIMEOUT_SECONDS) : AGENT_HOOK_TIMEOUT_SECONDS;
    const loop = 'loop_limit' in entry ? entry.loop_limit : entry.loopLimit;
    const loopLimit = loop === null ? null : typeof loop === 'number' && loop >= 0 ? Math.floor(loop) : undefined;
    return [{
        command, timeoutSeconds: timeout, source: file.source, level: file.level, ...(file.cwd ? { cwd: file.cwd } : {}),
        ...(prompt ? { type: 'prompt' as const } : {}), ...(prompt && typeof entry.model === 'string' && entry.model.trim() ? { model: entry.model.trim() } : {}),
        ...(matcher !== undefined ? { matcher } : {}),
        ...(entry.failClosed === true || entry.fail_closed === true ? { failClosed: true } : {}),
        ...(loopLimit !== undefined ? { loopLimit } : {})
    }];
};

/** The `"hooks"` object of a hooks file (or of the account's team hooks): event → list of hooks. */
export const parseHooksObject = (hooks: unknown, file: HookFileSource): AgentHooksParse => {
    if (hooks === undefined) {
        return { config: {}, errors: [] };
    }
    if (!isObject(hooks)) {
        return { config: {}, errors: [`${file.source}: "hooks" must be an object of event → commands.`] };
    }
    const errors: string[] = [];
    const config: Partial<Record<AgentHookEvent, AgentHookCommand[]>> = {};
    for (const [event, list] of Object.entries(hooks)) {
        if (!isAgentHookEvent(event)) {
            errors.push(`${file.source}: unknown hook event "${event}" (use ${AGENT_HOOK_EVENTS.join(', ')}).`);
            continue;
        }
        if (!Array.isArray(list)) {
            errors.push(`${file.source}: "${event}" must be a list of commands.`);
            continue;
        }
        config[event] = list.flatMap((item: unknown, i) => parseHookEntry(event, item, i, file, errors));
    }
    return { config, errors };
};

/**
 * Reads the `"hooks"` section of a hooks file in Cursor's format:
 * `{ "version": 1, "hooks": { "beforeShellExecution": [{ "command": "./check.sh", "timeout": 10, "matcher": "curl|wget" }] } }`.
 * Git stages (`pre-commit`, `pre-push`) in the same file are left to the git hooks; bad entries become errors.
 */
export const parseAgentHooks = (text: string | undefined, source: string, cwd?: string, level: HookFileSource['level'] = 'project'): AgentHooksParse => {
    if (!text?.trim()) {
        return { config: {}, errors: [] };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { config: {}, errors: [`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    return parseHooksObject(isObject(raw) ? raw.hooks : undefined, { source, level, ...(cwd ? { cwd } : {}) });
};

/** Commands of every file run, in file order (enterprise, team, project, user). */
export const mergeAgentHooks = (...configs: readonly AgentHooksConfig[]): AgentHooksConfig => {
    const merged: Partial<Record<AgentHookEvent, AgentHookCommand[]>> = {};
    for (const config of configs) {
        for (const event of AGENT_HOOK_EVENTS) {
            if (config[event]?.length) {
                merged[event] = [...(merged[event] ?? []), ...config[event]!];
            }
        }
    }
    return merged;
};

/** `Shell`, `Read`, `Write`… for built-in tools; `MCP:<tool>` for MCP tools (what preToolUse / postToolUse matchers see). */
export const hookToolName = (server: string, tool: string, builtinServer: string): string =>
    server === builtinServer ? HOOK_TOOL_NAMES[tool] ?? tool : `${MCP_TOOL_PREFIX}${tool}`;

/** The value an event's matcher is tested against: the command, the tool, the subagent type or a fixed name. */
export const hookMatchValue = (event: AgentHookEvent, data: Readonly<Json>): string | undefined => {
    const text = (key: string): string | undefined => typeof data[key] === 'string' ? data[key] as string : undefined;
    switch (event) {
        case 'beforeShellExecution':
        case 'afterShellExecution':
            return text('command');
        case 'preToolUse':
        case 'postToolUse':
        case 'postToolUseFailure':
            return text('tool_name');
        case 'subagentStart':
        case 'subagentStop':
            return text('subagent_type');
        default:
            return HOOK_MATCH_VALUES[event];
    }
};

/** No matcher (or `*`) runs always; events without a match value ignore it. */
export const hookMatches = (hook: AgentHookCommand, value: string | undefined): boolean => {
    if (!hook.matcher || value === undefined) {
        return true;
    }
    try {
        return new RegExp(hook.matcher).test(value);
    } catch {
        return false;
    }
};

const lastJsonObject = (text: string): Json | undefined => {
    const candidates = [text.trim(), ...text.trim().split(/\r?\n/).reverse()];
    for (const candidate of candidates) {
        if (!candidate.startsWith('{')) {
            continue;
        }
        try {
            const value = JSON.parse(candidate) as unknown;
            if (isObject(value)) {
                return value;
            }
        } catch {
            // not JSON: try the next line
        }
    }
    return undefined;
};

const message = (json: Json, camel: string, snake: string): string | undefined => {
    const value = json[camel] ?? json[snake];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** The extra fields of a response (`continue`, `followup_message`, `additional_context`, `env`, `updated_input`…), camel or snake case. */
export const responseExtras = (json: Json): HookResponseExtras => {
    const followup = message(json, 'followupMessage', 'followup_message');
    const context = message(json, 'additionalContext', 'additional_context');
    const env = isObject(json.env) ? Object.fromEntries(Object.entries(json.env).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])) : undefined;
    const input = json.updated_input ?? json.updatedInput;
    const output = json.updated_mcp_tool_output ?? json.updatedMcpToolOutput;
    return {
        ...(typeof json.continue === 'boolean' ? { continue: json.continue } : {}),
        ...(followup ? { followupMessage: followup } : {}),
        ...(context ? { additionalContext: context } : {}),
        ...(env && Object.keys(env).length ? { env } : {}),
        ...(isObject(input) ? { updatedInput: input } : {}),
        ...(output !== undefined ? { updatedMcpToolOutput: output } : {})
    };
};

/**
 * IDEA-287: Claude Code's answers in Cursor's fields, as Cursor reads them from any hook: the nested `hookSpecificOutput`
 * (`permissionDecision`, `permissionDecisionReason`, `updatedInput`, `additionalContext`) and the flat `decision` /
 * `reason`. `"block"` denies a permission hook, keeps a prompt from being sent, sends the reason as the stop / subagentStop
 * follow-up and adds it as context after a tool. Cursor's own fields win when both are present.
 */
export const fromClaudeResponse = (event: AgentHookEvent, json: Json): Json => {
    const nested = isObject(json.hookSpecificOutput) ? json.hookSpecificOutput : {};
    const field = (key: string): unknown => nested[key] ?? json[key];
    const decision = field('decision');
    const reason = typeof field('reason') === 'string' ? field('reason') as string : undefined;
    const block = decision === 'block';
    const permission = field('permissionDecision') ?? (block ? 'deny' : decision === 'approve' ? 'allow' : undefined);
    const userMessage = field('permissionDecisionReason') ?? (block ? reason : undefined) ?? (json.continue === false ? json.stopReason : undefined);
    const followup = block && (event === 'stop' || event === 'subagentStop') ? reason : undefined;
    const context = field('additionalContext') ?? (block && (event === 'postToolUse' || event === 'postToolUseFailure') ? reason : undefined);
    return {
        ...(permission !== undefined && isGatingEvent(event) ? { permission } : {}),
        ...(userMessage !== undefined ? { user_message: userMessage } : {}),
        ...(field('updatedInput') !== undefined ? { updated_input: field('updatedInput') } : {}),
        ...(context !== undefined ? { additional_context: context } : {}),
        ...(followup ? { followup_message: followup } : {}),
        ...(block && event === 'beforeSubmitPrompt' ? { continue: false } : {}),
        ...json
    };
};

/** Cursor's quirks: "ask" is not enforced for preToolUse and means "deny" for subagentStart. */
const effectivePermission = (event: AgentHookEvent, permission: HookPermission): HookPermission =>
    permission !== 'ask' ? permission : ASK_IGNORED_EVENTS.includes(event) ? 'allow' : ASK_DENIES_EVENTS.includes(event) ? 'deny' : 'ask';

/**
 * A command's answer. JSON `{ "permission": "allow" | "deny" | "ask", "user_message"?, "agent_message"?, … }` on stdout
 * (camelCase works too); exit code 2 denies. Permission hooks: stdout that is not JSON, or an unknown permission, denies
 * (as in Cursor). A failure (crash, timeout, other exit code, no output) asks the user instead of silently allowing,
 * or denies with `failClosed`; observation hooks always let the action through.
 */
export const parseHookOutput = (event: AgentHookEvent, output: HookRunOutput, failClosed = false): HookResponse => {
    const gating = isGatingEvent(event);
    const prompt = event === 'beforeSubmitPrompt';
    // Events without an approval card (preToolUse, subagentStart) fail open unless failClosed.
    const askable = gating && !ASK_IGNORED_EVENTS.includes(event) && !ASK_DENIES_EVENTS.includes(event);
    const fail = (userMessage: string): HookResponse => failClosed && (gating || prompt)
        ? { permission: 'deny', userMessage, ...(prompt ? { continue: false } : {}) }
        : askable ? { permission: 'ask', userMessage } : { permission: 'allow' };
    if (output.timedOut) {
        return fail('The hook timed out.');
    }
    const stderr = output.stderr.trim();
    if (output.exitCode === HOOK_DENY_EXIT_CODE) {
        return gating || prompt
            ? { permission: 'deny', userMessage: stderr || 'Blocked by a hook.', ...(stderr ? { agentMessage: stderr } : {}), ...(prompt ? { continue: false } : {}) }
            : { permission: 'allow' };
    }
    if (output.exitCode !== undefined && output.exitCode !== 0) {
        return fail(`The hook failed (exit ${output.exitCode})${stderr ? `: ${stderr.split('\n')[0]}` : '.'}`);
    }
    if (!output.stdout.trim()) {
        return gating && failClosed ? fail('The hook printed nothing.') : { permission: 'allow' };
    }
    const answer = lastJsonObject(output.stdout);
    if (!answer) {
        return gating ? { permission: 'deny', userMessage: 'The hook did not answer with JSON.' } : { permission: 'allow' };
    }
    const json = fromClaudeResponse(event, answer);
    const extras = responseExtras(json);
    const user = message(json, 'userMessage', 'user_message');
    const agent = message(json, 'agentMessage', 'agent_message');
    const messages = { ...(user ? { userMessage: user } : {}), ...(agent ? { agentMessage: agent } : {}) };
    if (prompt) {
        return { permission: extras.continue === false ? 'deny' : 'allow', ...messages, ...extras };
    }
    if (!gating) {
        return { permission: 'allow', ...messages, ...extras };
    }
    const raw = json.permission;
    if (raw !== undefined && (typeof raw !== 'string' || !PERMISSIONS.includes(raw))) {
        return { permission: 'deny', userMessage: user ?? `The hook answered an unknown permission (${String(raw)}).` };
    }
    return { permission: effectivePermission(event, (raw as HookPermission | undefined) ?? 'allow'), ...messages, ...extras };
};

/** The strictest answer wins (deny > ask > allow); messages of the deciding commands are joined. */
export const combineDecisions = (decisions: readonly HookDecision[]): HookDecision => {
    const permission = decisions.reduce<HookPermission>((worst, d) => RANK[d.permission] > RANK[worst] ? d.permission : worst, 'allow');
    const deciding = decisions.filter(d => d.permission === permission);
    const join = (key: 'userMessage' | 'agentMessage'): string | undefined => deciding.map(d => d[key]).filter(Boolean).join('\n') || undefined;
    const user = join('userMessage');
    const agent = join('agentMessage');
    return { permission, ...(user ? { userMessage: user } : {}), ...(agent ? { agentMessage: agent } : {}) };
};

/** As Cursor: any `continue: false` wins; `env` merges; other fields come from the last response that has them. */
export const combineExtras = (responses: readonly HookResponseExtras[]): HookResponseExtras => responses.reduce<HookResponseExtras>((acc, r) => ({
    ...acc,
    ...(r.continue !== undefined ? { continue: acc.continue === false ? false : r.continue } : {}),
    ...(r.followupMessage ? { followupMessage: r.followupMessage } : {}),
    ...(r.additionalContext ? { additionalContext: r.additionalContext } : {}),
    ...(r.env ? { env: { ...acc.env, ...r.env } } : {}),
    ...(r.updatedInput ? { updatedInput: r.updatedInput } : {}),
    ...(r.updatedMcpToolOutput !== undefined ? { updatedMcpToolOutput: r.updatedMcpToolOutput } : {})
}), {});

/** A stop / subagentStop follow-up counts only while the script is under its `loop_limit` (default 5, `null` = no limit). */
export const underLoopLimit = (hook: AgentHookCommand, loopCount: number): boolean => {
    const limit = hook.loopLimit === undefined ? DEFAULT_HOOK_LOOP_LIMIT : hook.loopLimit;
    return limit === null || loopCount < limit;
};

/** The JSON a command gets on stdin: Cursor's common fields plus the event's own. Fields Ingot does not have are null or left out. */
export const hookPayload = (event: AgentHookEvent, base: HookPayloadBase, data: Readonly<Json>): Json => ({
    ...(base.conversationId ? { conversation_id: base.conversationId } : {}),
    ...(base.generationId ? { generation_id: base.generationId } : {}),
    ...(base.model ? { model: base.model } : {}),
    hook_event_name: event,
    ...(base.version ? { cursor_version: base.version, ingot_version: base.version } : {}),
    workspace_roots: [...base.roots],
    user_email: base.userEmail ?? null,
    ...(base.conversationId ? { transcript_path: null } : {}),
    ...data
});

/** Environment of a hook command: the project folder under Ingot's, Cursor's and Claude Code's names, plus the chat's sessionStart env. */
export const hookEnv = (projectDir: string, base: Pick<HookPayloadBase, 'version' | 'userEmail'>, sessionEnv?: Readonly<Record<string, string>>): Record<string, string> => ({
    ...sessionEnv,
    [HOOK_PROJECT_ENV]: projectDir,
    [HOOK_CURSOR_PROJECT_ENV]: projectDir,
    [HOOK_CLAUDE_PROJECT_ENV]: projectDir,
    ...(base.version ? { [HOOK_VERSION_ENV]: base.version } : {}),
    ...(base.userEmail ? { [HOOK_USER_EMAIL_ENV]: base.userEmail } : {})
});

/** A prompt hook's text for the model: `$ARGUMENTS` becomes the hook input; without it the input is appended. */
export const promptHookText = (prompt: string, input: string): string =>
    prompt.includes(PROMPT_HOOK_ARGUMENTS) ? prompt.split(PROMPT_HOOK_ARGUMENTS).join(input) : `${prompt}\n\nHook input:\n${input}`;

/**
 * A prompt hook's verdict `{ "ok": boolean, "reason"? }`. Not ok: permission hooks deny, beforeSubmitPrompt does not send,
 * stop / subagentStop continue with the reason as the follow-up. An answer that is not JSON counts as a failure.
 */
export const parsePromptHookAnswer = (event: AgentHookEvent, answer: string, failClosed = false): HookResponse => {
    const json = lastJsonObject(answer.replace(/```(?:json)?/g, ''));
    if (!json || typeof json.ok !== 'boolean') {
        return parseHookOutput(event, { stdout: '', stderr: 'The prompt hook did not answer {"ok": …}.', exitCode: 1, timedOut: false }, failClosed);
    }
    const reason = typeof json.reason === 'string' && json.reason.trim() ? json.reason.trim() : undefined;
    if (json.ok) {
        return { permission: 'allow' };
    }
    const text = reason ?? 'The prompt hook said no.';
    if (event === 'stop' || event === 'subagentStop') {
        return { permission: 'allow', followupMessage: text };
    }
    if (event === 'beforeSubmitPrompt') {
        return { permission: 'deny', userMessage: text, continue: false };
    }
    return isGatingEvent(event) ? { permission: effectivePermission(event, 'deny'), userMessage: text, agentMessage: text } : { permission: 'allow', userMessage: text };
};

/** IDEA-287: the merged outcome of an event's commands. */
export const hookOutcome = (event: AgentHookEvent, results: readonly HookCommandResult[]): AgentHookOutcome =>
    ({ event, decision: combineDecisions(results), results, extras: combineExtras(results) });

/** Tool result the agent gets when a hook blocks an action. */
export const hookBlockedText = (outcome: Pick<AgentHookOutcome, 'event' | 'decision'>): string =>
    `Blocked by a ${outcome.event} hook${outcome.decision.agentMessage ? `: ${outcome.decision.agentMessage}` : outcome.decision.userMessage ? `: ${outcome.decision.userMessage}` : '.'} Do not retry it unless the user asks.`;

/** The hook card body: one line per command with its answer. */
export const hookOutcomeText = (results: readonly HookCommandResult[]): string =>
    results.map(r => `${r.command} → ${r.permission}${r.userMessage ? `: ${r.userMessage}` : ''}`).join('\n');
