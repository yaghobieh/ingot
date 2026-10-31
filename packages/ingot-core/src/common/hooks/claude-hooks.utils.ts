import {
    CLAUDE_HOOK_EVENTS, CLAUDE_MCP_TOOL_PATTERN, CLAUDE_SKIPPED_EVENTS, CLAUDE_TOOL_EVENTS, CLAUDE_TOOL_NAME_PATTERN, CLAUDE_TOOL_NAMES, CURSOR_TO_CLAUDE_TOOL,
    MCP_TOOL_PREFIX
} from './agent-hooks.consts';
import type { AgentHookCommand, AgentHookEvent, AgentHooksParse, HookFileSource } from './agent-hooks.types';
import { parseHookEntry } from './agent-hooks.utils';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

/** `Bash|Edit` → `Shell|Write`, `mcp__github__.*` → `MCP:.*`: a Claude Code matcher in the tool names Ingot's hooks see. */
export const claudeMatcher = (matcher: string): string =>
    matcher.replace(CLAUDE_MCP_TOOL_PATTERN, MCP_TOOL_PREFIX).replace(CLAUDE_TOOL_NAME_PATTERN, name => CLAUDE_TOOL_NAMES[name]);

/**
 * IDEA-287: the hooks of a Claude Code settings file, mapped as Cursor maps them:
 * `{ "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "./check.sh", "timeout": 10 }] }] } }`.
 * Events Cursor does not map (`Notification`, `PermissionRequest`) are skipped; `loop_limit` defaults to no limit.
 */
export const parseClaudeHooks = (text: string | undefined, file: HookFileSource): AgentHooksParse => {
    if (!text?.trim()) {
        return { config: {}, errors: [] };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { config: {}, errors: [`${file.source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const hooks = isObject(raw) ? raw.hooks : undefined;
    if (hooks === undefined) {
        return { config: {}, errors: [] };
    }
    if (!isObject(hooks)) {
        return { config: {}, errors: [`${file.source}: "hooks" must be an object of event → matcher groups.`] };
    }
    const errors: string[] = [];
    const config: Partial<Record<AgentHookEvent, AgentHookCommand[]>> = {};
    for (const [name, groups] of Object.entries(hooks)) {
        const event = CLAUDE_HOOK_EVENTS[name];
        if (!event) {
            if (!CLAUDE_SKIPPED_EVENTS.includes(name)) {
                errors.push(`${file.source}: unknown Claude Code hook "${name}" (use ${Object.keys(CLAUDE_HOOK_EVENTS).join(', ')}).`);
            }
            continue;
        }
        if (!Array.isArray(groups)) {
            errors.push(`${file.source}: "${name}" must be a list of matcher groups.`);
            continue;
        }
        groups.forEach((group: unknown, i) => {
            const entry = isObject(group) ? group : {};
            const matcher = CLAUDE_TOOL_EVENTS.includes(name) && typeof entry.matcher === 'string' ? claudeMatcher(entry.matcher) : undefined;
            if (!Array.isArray(entry.hooks)) {
                errors.push(`${file.source}: "${name}" group ${i + 1} needs a "hooks" list.`);
                return;
            }
            const commands = entry.hooks.flatMap((hook: unknown, j) => parseHookEntry(event, isObject(hook)
                ? { ...hook, ...(matcher !== undefined ? { matcher } : {}), loop_limit: 'loop_limit' in hook ? hook.loop_limit : null }
                : hook, j, file, errors));
            config[event] = [...(config[event] ?? []), ...commands.map(command => ({ ...command, claudeEvent: name }))];
        });
    }
    return { config, errors };
};

/** What a Claude Code hook reads on stdin: Cursor's payload with Claude's event name, `session_id`, `cwd` and `Bash` for Shell. */
export const claudeHookPayload = (payload: Readonly<Json>, claudeEvent: string, cwd: string): Json => ({
    ...payload,
    hook_event_name: claudeEvent,
    session_id: typeof payload.conversation_id === 'string' ? payload.conversation_id : '',
    cwd: typeof payload.cwd === 'string' ? payload.cwd : cwd,
    ...(typeof payload.tool_name === 'string' ? { tool_name: CURSOR_TO_CLAUDE_TOOL[payload.tool_name] ?? payload.tool_name } : {})
});
