import { describe, expect, it } from 'vitest';
import {
    combineDecisions, combineExtras, hookBlockedText, hookEnv, hookMatches, hookMatchValue, hookOutcome, hookPayload, hookToolName, mergeAgentHooks, parseAgentHooks,
    parseHookOutput, parseHooksObject, parsePromptHookAnswer, promptHookText, responseExtras, underLoopLimit
} from './agent-hooks.utils';
import { AGENT_HOOK_EVENTS } from './agent-hooks.consts';
import { parseHooks } from '../git/hooks';

describe('IDEA-294 agent hooks (Cursor hooks.json)', () => {
    it('parses events with timeouts and keeps git stages working in the same file', () => {
        const text = JSON.stringify({
            version: 1,
            'pre-commit': ['npm run lint'],
            hooks: { beforeShellExecution: [{ command: './audit.sh', timeout: 5 }, 'echo hi'], afterFileEdit: [{ command: 'prettier' }], onBoot: [], stop: [{}] }
        });
        const { config, errors } = parseAgentHooks(text, '.ingot/hooks.json');
        expect(config.beforeShellExecution).toEqual([
            { command: './audit.sh', timeoutSeconds: 5, source: '.ingot/hooks.json', level: 'project' },
            { command: 'echo hi', timeoutSeconds: 30, source: '.ingot/hooks.json', level: 'project' }
        ]);
        expect(config.afterFileEdit?.[0].command).toBe('prettier');
        expect(errors).toEqual([`.ingot/hooks.json: unknown hook event "onBoot" (use ${AGENT_HOOK_EVENTS.join(', ')}).`, '.ingot/hooks.json: "stop" entry 1 needs a "command".']);
        expect(parseHooks(text)).toEqual({ config: { 'pre-commit': [{ name: 'npm run lint', run: 'npm run lint' }] }, errors: [] });
        expect(parseAgentHooks(JSON.stringify({ 'pre-push': ['npm test'] }), 'x').config).toEqual({});
        expect(parseAgentHooks('{', 'x').errors[0]).toMatch(/not valid JSON/);
        const merged = mergeAgentHooks(parseAgentHooks(JSON.stringify({ hooks: { stop: ['a'] } }), '.cursor/hooks.json').config, config);
        expect(merged.stop?.map(c => c.command)).toEqual(['a']);
        expect(merged.beforeShellExecution?.length).toBe(2);
    });

    it('reads a command answer like Cursor: JSON permission, exit code 2, and safe failures', () => {
        const ok = { stderr: '', timedOut: false, exitCode: 0 };
        expect(parseHookOutput('beforeShellExecution', { ...ok, stdout: 'log line\n{"permission":"deny","userMessage":"No rm","agent_message":"rm is blocked"}' }))
            .toEqual({ permission: 'deny', userMessage: 'No rm', agentMessage: 'rm is blocked' });
        expect(parseHookOutput('beforeShellExecution', { ...ok, stdout: '{"permission":"ask"}' }).permission).toBe('ask');
        expect(parseHookOutput('beforeReadFile', { ...ok, stdout: '' })).toEqual({ permission: 'allow' });
        expect(parseHookOutput('beforeMCPExecution', { stdout: '', stderr: 'nope', exitCode: 2, timedOut: false })).toMatchObject({ permission: 'deny', userMessage: 'nope' });
        expect(parseHookOutput('beforeShellExecution', { stdout: '', stderr: 'boom', exitCode: 1, timedOut: false })).toEqual({ permission: 'ask', userMessage: 'The hook failed (exit 1): boom' });
        expect(parseHookOutput('beforeShellExecution', { stdout: '', stderr: '', timedOut: true }).permission).toBe('ask');
        expect(parseHookOutput('afterFileEdit', { stdout: '{"permission":"deny"}', stderr: '', exitCode: 1, timedOut: false }).permission).toBe('allow');
        expect(parseHookOutput('stop', { stdout: '', stderr: '', timedOut: true }).permission).toBe('allow');
    });

    it('lets the strictest answer win and builds the payload and the blocked text', () => {
        expect(combineDecisions([{ permission: 'allow' }, { permission: 'ask', userMessage: 'a' }, { permission: 'deny', userMessage: 'b', agentMessage: 'c' }]))
            .toEqual({ permission: 'deny', userMessage: 'b', agentMessage: 'c' });
        expect(combineDecisions([])).toEqual({ permission: 'allow' });
        expect(hookPayload('beforeShellExecution', { conversationId: 'c1', generationId: 'g1', roots: ['/p'] }, { command: 'ls', cwd: '/p' })).toEqual({
            conversation_id: 'c1', generation_id: 'g1', hook_event_name: 'beforeShellExecution', workspace_roots: ['/p'], user_email: null, transcript_path: null, command: 'ls', cwd: '/p'
        });
        expect(hookBlockedText({ event: 'beforeShellExecution', decision: { permission: 'deny', agentMessage: 'Use the script' }, results: [] }))
            .toBe('Blocked by a beforeShellExecution hook: Use the script Do not retry it unless the user asks.');
    });
});

describe('IDEA-287 every Cursor hook event and option', () => {
    it('knows all of Cursor\'s agent, Tab and app events', () => {
        for (const event of ['sessionStart', 'sessionEnd', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'subagentStart', 'subagentStop', 'beforeShellExecution',
            'afterShellExecution', 'beforeMCPExecution', 'afterMCPExecution', 'beforeReadFile', 'afterFileEdit', 'beforeSubmitPrompt', 'preCompact', 'stop',
            'afterAgentResponse', 'afterAgentThought', 'beforeTabFileRead', 'afterTabFileEdit', 'workspaceOpen']) {
            expect(AGENT_HOOK_EVENTS).toContain(event);
        }
    });

    it('reads matcher, prompt hooks, failClosed and loop_limit, and drops a bad regex', () => {
        const { config, errors } = parseHooksObject({
            beforeShellExecution: [{ command: './net.sh', matcher: 'curl|wget', failClosed: true }, { command: './all.sh', matcher: '*' }, { command: './bad.sh', matcher: '(' }],
            stop: [{ type: 'prompt', prompt: 'Is it done? $ARGUMENTS', model: 'fast', loop_limit: null }, { command: './again.sh', loop_limit: 2 }]
        }, { source: '/etc/cursor/hooks.json', level: 'enterprise', cwd: '/etc/cursor' });
        expect(config.beforeShellExecution).toEqual([
            { command: './net.sh', matcher: 'curl|wget', failClosed: true, timeoutSeconds: 30, source: '/etc/cursor/hooks.json', level: 'enterprise', cwd: '/etc/cursor' },
            { command: './all.sh', timeoutSeconds: 30, source: '/etc/cursor/hooks.json', level: 'enterprise', cwd: '/etc/cursor' }
        ]);
        expect(errors[0]).toMatch(/not a valid regex/);
        expect(config.stop?.[0]).toMatchObject({ type: 'prompt', command: 'Is it done? $ARGUMENTS', model: 'fast', loopLimit: null });
        expect(config.stop?.[1].loopLimit).toBe(2);
        expect(parseHooksObject([], { source: 'team', level: 'team' }).errors[0]).toMatch(/must be an object/);
    });

    it('matches the command, the tool name, the subagent type or the event\'s fixed value', () => {
        expect(hookToolName('ingot', 'run', 'ingot')).toBe('Shell');
        expect(hookToolName('ingot', 'read_file', 'ingot')).toBe('Read');
        expect(hookToolName('github', 'create_issue', 'ingot')).toBe('MCP:create_issue');
        expect(hookMatchValue('beforeShellExecution', { command: 'curl x' })).toBe('curl x');
        expect(hookMatchValue('preToolUse', { tool_name: 'Shell' })).toBe('Shell');
        expect(hookMatchValue('subagentStart', { subagent_type: 'explore' })).toBe('explore');
        expect(hookMatchValue('beforeSubmitPrompt', {})).toBe('UserPromptSubmit');
        const hook = { command: 'x', timeoutSeconds: 1, source: 's', matcher: 'curl|wget' };
        expect(hookMatches(hook, 'curl https://x')).toBe(true);
        expect(hookMatches(hook, 'ls')).toBe(false);
        expect(hookMatches({ ...hook, matcher: undefined }, 'ls')).toBe(true);
    });

    it('fails closed when asked to, and fails open where Cursor has no approval step', () => {
        const crash = { stdout: '', stderr: 'boom', exitCode: 1, timedOut: false };
        expect(parseHookOutput('beforeShellExecution', crash, true).permission).toBe('deny');
        expect(parseHookOutput('beforeShellExecution', { stdout: '', stderr: '', exitCode: 0, timedOut: false }, true).permission).toBe('deny');
        expect(parseHookOutput('preToolUse', crash).permission).toBe('allow');
        expect(parseHookOutput('subagentStart', crash).permission).toBe('allow');
        expect(parseHookOutput('preToolUse', { stdout: '{"permission":"ask"}', stderr: '', exitCode: 0, timedOut: false }).permission).toBe('allow');
        expect(parseHookOutput('subagentStart', { stdout: '{"permission":"ask"}', stderr: '', exitCode: 0, timedOut: false }).permission).toBe('deny');
        expect(parseHookOutput('beforeSubmitPrompt', { stdout: '', stderr: 'no secrets', exitCode: 2, timedOut: false })).toMatchObject({ permission: 'deny', continue: false });
        expect(parseHookOutput('beforeSubmitPrompt', { stdout: '{"continue":false,"user_message":"Remove the key"}', stderr: '', exitCode: 0, timedOut: false }))
            .toEqual({ permission: 'deny', continue: false, userMessage: 'Remove the key' });
    });

    it('reads the response extras and merges them like Cursor', () => {
        expect(responseExtras({ followup_message: 'Run the tests', additional_context: 'Uses pnpm', env: { A: '1', N: 2, X: {} }, updated_input: { command: 'ls -la' } }))
            .toEqual({ followupMessage: 'Run the tests', additionalContext: 'Uses pnpm', env: { A: '1', N: '2' }, updatedInput: { command: 'ls -la' } });
        expect(combineExtras([{ continue: false, env: { A: '1' } }, { continue: true, env: { B: '2' }, followupMessage: 'last' }]))
            .toEqual({ continue: false, env: { A: '1', B: '2' }, followupMessage: 'last' });
        const outcome = hookOutcome('postToolUse', [{ command: 'a', durationMs: 1, permission: 'allow', additionalContext: 'one' }, { command: 'b', durationMs: 1, permission: 'allow', updatedMcpToolOutput: { n: 1 } }]);
        expect(outcome.extras).toEqual({ additionalContext: 'one', updatedMcpToolOutput: { n: 1 } });
    });

    it('stops follow-ups at loop_limit (default 5, null for none)', () => {
        const hook = { command: 'x', timeoutSeconds: 1, source: 's' };
        expect(underLoopLimit(hook, 4)).toBe(true);
        expect(underLoopLimit(hook, 5)).toBe(false);
        expect(underLoopLimit({ ...hook, loopLimit: null }, 99)).toBe(true);
        expect(underLoopLimit({ ...hook, loopLimit: 0 }, 0)).toBe(false);
    });

    it('builds prompt hooks and reads their {ok, reason} answer', () => {
        expect(promptHookText('Check: $ARGUMENTS', '{"a":1}')).toBe('Check: {"a":1}');
        expect(promptHookText('Check', 'in')).toBe('Check\n\nHook input:\nin');
        expect(parsePromptHookAnswer('beforeShellExecution', '```json\n{"ok": false, "reason": "Too risky"}\n```')).toMatchObject({ permission: 'deny', userMessage: 'Too risky' });
        expect(parsePromptHookAnswer('stop', '{"ok": false, "reason": "Tests still fail"}')).toEqual({ permission: 'allow', followupMessage: 'Tests still fail' });
        expect(parsePromptHookAnswer('beforeSubmitPrompt', '{"ok": false}')).toMatchObject({ permission: 'deny', continue: false });
        expect(parsePromptHookAnswer('beforeShellExecution', '{"ok": true}')).toEqual({ permission: 'allow' });
        expect(parsePromptHookAnswer('beforeShellExecution', 'sure').permission).toBe('ask');
    });

    it('passes the project folder under Ingot, Cursor and Claude names plus the session env', () => {
        expect(hookEnv('/p', { version: '1.2.0', userEmail: 'dev@example.com' }, { NODE_ENV: 'test' })).toEqual({
            NODE_ENV: 'test', INGOT_PROJECT_DIR: '/p', CURSOR_PROJECT_DIR: '/p', CLAUDE_PROJECT_DIR: '/p', CURSOR_VERSION: '1.2.0', CURSOR_USER_EMAIL: 'dev@example.com'
        });
        expect(hookPayload('stop', { roots: ['/p'], model: 'm', version: '1.2.0' }, { status: 'completed', loop_count: 0 })).toEqual({
            model: 'm', hook_event_name: 'stop', cursor_version: '1.2.0', ingot_version: '1.2.0', workspace_roots: ['/p'], user_email: null, status: 'completed', loop_count: 0
        });
    });
});
