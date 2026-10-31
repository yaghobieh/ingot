import { describe, expect, it } from 'vitest';
import { hookMatches, parseHookOutput, underLoopLimit } from './agent-hooks.utils';
import { claudeHookPayload, claudeMatcher, parseClaudeHooks } from './claude-hooks.utils';

const FILE = { source: '.claude/settings.json', level: 'claude' as const };
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, timedOut: false });

describe('IDEA-287 Claude Code hooks', () => {
    it('maps Claude events, matchers and tools to Cursor names; skips Notification; loop_limit defaults to none', () => {
        const parse = parseClaudeHooks(JSON.stringify({
            permissions: { allow: ['Bash(npm test)'] },
            hooks: {
                PreToolUse: [{ matcher: 'Bash|Edit', hooks: [{ type: 'command', command: './guard.sh', timeout: 5 }] }, { matcher: 'mcp__github__.*', hooks: [{ type: 'command', command: './mcp.sh' }] }],
                UserPromptSubmit: [{ hooks: [{ type: 'command', command: './prompt.sh' }] }],
                SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: './start.sh' }] }],
                Stop: [{ hooks: [{ type: 'prompt', prompt: 'Are all tasks done? $ARGUMENTS' }] }],
                Notification: [{ hooks: [{ type: 'command', command: './notify.sh' }] }],
                Bogus: [],
                PostToolUse: [{ matcher: 'Write' }]
            }
        }), FILE);
        expect(parse.config.preToolUse?.map(h => [h.command, h.matcher, h.timeoutSeconds, h.claudeEvent, h.level])).toEqual([
            ['./guard.sh', 'Shell|Write', 5, 'PreToolUse', 'claude'], ['./mcp.sh', 'MCP:.*', 30, 'PreToolUse', 'claude']
        ]);
        expect(parse.config.beforeSubmitPrompt?.[0].command).toBe('./prompt.sh');
        expect(parse.config.sessionStart?.[0].matcher).toBeUndefined();
        expect(parse.config.stop?.[0]).toMatchObject({ type: 'prompt', loopLimit: null });
        expect(underLoopLimit(parse.config.stop![0], 50)).toBe(true);
        expect(Object.keys(parse.config).sort()).toEqual(['beforeSubmitPrompt', 'preToolUse', 'sessionStart', 'stop']);
        expect(parse.errors).toEqual([
            '.claude/settings.json: unknown Claude Code hook "Bogus" (use PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, SessionStart, SessionEnd, PreCompact).',
            '.claude/settings.json: "PostToolUse" group 1 needs a "hooks" list.'
        ]);
        expect(hookMatches(parse.config.preToolUse![0], 'Shell')).toBe(true);
        expect(hookMatches(parse.config.preToolUse![0], 'Read')).toBe(false);
        expect(parseClaudeHooks('{"model":"x"}', FILE)).toEqual({ config: {}, errors: [] });
        expect(parseClaudeHooks('{', FILE).errors[0]).toContain('is not valid JSON');
        expect(claudeMatcher('Read|MultiEdit|NotebookEdit')).toBe('Read|Write|NotebookEdit');
    });

    it('gives Claude scripts their event name, session_id, cwd and Bash for Shell', () => {
        const payload = claudeHookPayload({ conversation_id: 'c1', hook_event_name: 'preToolUse', tool_name: 'Shell', tool_input: { command: 'ls' } }, 'PreToolUse', '/p');
        expect(payload).toMatchObject({ hook_event_name: 'PreToolUse', session_id: 'c1', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'ls' } });
        expect(claudeHookPayload({ tool_name: 'Read', cwd: '/p/src' }, 'PostToolUse', '/p')).toMatchObject({ tool_name: 'Read', cwd: '/p/src', session_id: '' });
    });

    it('reads Claude answers: hookSpecificOutput, decision block / approve and reason, for any hook', () => {
        const nested = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Blocked by policy', updatedInput: { command: 'npm ci' } } });
        expect(parseHookOutput('preToolUse', ok(nested))).toMatchObject({ permission: 'deny', userMessage: 'Blocked by policy', updatedInput: { command: 'npm ci' } });
        expect(parseHookOutput('beforeShellExecution', ok('{"decision":"block","reason":"no curl"}'))).toMatchObject({ permission: 'deny', userMessage: 'no curl' });
        expect(parseHookOutput('beforeShellExecution', ok('{"decision":"approve"}')).permission).toBe('allow');
        expect(parseHookOutput('stop', ok('{"hookSpecificOutput":{"decision":"block","reason":"Tasks incomplete"}}')).followupMessage).toBe('Tasks incomplete');
        expect(parseHookOutput('subagentStop', ok('{"decision":"block","reason":"Keep going"}')).followupMessage).toBe('Keep going');
        expect(parseHookOutput('beforeSubmitPrompt', ok('{"decision":"block","reason":"No secrets"}'))).toMatchObject({ permission: 'deny', continue: false, userMessage: 'No secrets' });
        expect(parseHookOutput('sessionStart', ok('{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Use pnpm."}}')).additionalContext).toBe('Use pnpm.');
        expect(parseHookOutput('postToolUse', ok('{"decision":"block","reason":"Lint failed"}')).additionalContext).toBe('Lint failed');
        expect(parseHookOutput('beforeShellExecution', ok('{"permission":"allow","decision":"block","reason":"x"}')).permission).toBe('allow');
    });
});
