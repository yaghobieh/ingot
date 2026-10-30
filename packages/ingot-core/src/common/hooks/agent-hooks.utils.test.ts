import { describe, expect, it } from 'vitest';
import { combineDecisions, hookBlockedText, hookPayload, mergeAgentHooks, parseAgentHooks, parseHookOutput } from './agent-hooks.utils';
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
            { command: './audit.sh', timeoutSeconds: 5, source: '.ingot/hooks.json' },
            { command: 'echo hi', timeoutSeconds: 30, source: '.ingot/hooks.json' }
        ]);
        expect(config.afterFileEdit?.[0].command).toBe('prettier');
        expect(errors).toEqual(['.ingot/hooks.json: unknown hook event "onBoot" (use beforeShellExecution, beforeMCPExecution, beforeReadFile, afterFileEdit, stop).', '.ingot/hooks.json: "stop" entry 1 needs a "command".']);
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
        expect(hookPayload('beforeShellExecution', { conversationId: 'c1', generationId: 'g1', roots: ['/p'] }, { command: 'ls', cwd: '/p' }))
            .toEqual({ conversation_id: 'c1', generation_id: 'g1', hook_event_name: 'beforeShellExecution', workspace_roots: ['/p'], command: 'ls', cwd: '/p' });
        expect(hookBlockedText({ event: 'beforeShellExecution', decision: { permission: 'deny', agentMessage: 'Use the script' }, results: [] }))
            .toBe('Blocked by a beforeShellExecution hook: Use the script Do not retry it unless the user asks.');
    });
});
