import { describe, expect, it } from 'vitest';
import { agentHookPrompt, hookCardInfo, agentVerdict, fixWithAgentPrompt, gitHookScript, hooksTemplate, isIngotHook, parseHooks } from './hooks';

describe('agent git hooks (IDEA-178)', () => {
    it('parses shell and agent steps, with readable errors', () => {
        const { config, errors } = parseHooks(JSON.stringify({
            'pre-commit': ['npm run lint', { name: 'Review', agent: 'No secrets' }, { name: 'bad' }],
            'pre-push': [{ run: 'npm test', timeoutSeconds: 60 }],
            'post-merge': []
        }));
        expect(config['pre-commit']).toEqual([{ name: 'npm run lint', run: 'npm run lint' }, { name: 'Review', agent: 'No secrets' }]);
        expect(config['pre-push']).toEqual([{ name: 'npm test', run: 'npm test', timeoutSeconds: 60 }]);
        expect(errors).toEqual(['"pre-commit" step 3 needs "run" (a command) or "agent" (a prompt).', 'Unknown hook "post-merge" (use "pre-commit" or "pre-push").']);
        expect(parseHooks('{').errors[0]).toMatch(/not valid JSON/);
        expect(parseHooks(undefined)).toEqual({ config: {}, errors: [] });
    });

    it('generates a valid template', () => {
        const { config, errors } = parseHooks(hooksTemplate());
        expect(errors).toEqual([]);
        expect(config['pre-commit']?.length).toBe(2);
        expect(config['pre-push']?.length).toBe(1);
    });

    it('reads PASS / FAIL from an agent step and fails safe', () => {
        expect(agentVerdict('PASS')).toEqual({ passed: true, reason: 'Passed' });
        expect(agentVerdict('**FAIL: console.log left in a.ts**\n- remove it')).toEqual({ passed: false, reason: 'console.log left in a.ts' });
        expect(agentVerdict('Looks fine to me').passed).toBe(false);
        const prompt = agentHookPrompt({ name: 'R', agent: 'No secrets.' }, 'pre-commit', 'x'.repeat(13000));
        expect(prompt).toContain('No secrets.');
        expect(prompt).toContain('(diff cut)');
    });

    it('builds the Fix with agent prompt and the git hook', () => {
        const prompt = fixWithAgentPrompt('pre-commit', [{ step: { name: 'Lint', run: 'npm run lint' }, state: 'failed', output: 'a.ts: error', exitCode: 1, startedAt: 0 }]);
        expect(prompt).toContain('Step "Lint" (command: npm run lint) failed with exit code 1');
        expect(prompt).toContain('a.ts: error');
        const hook = gitHookScript('pre-push');
        expect(hook.startsWith('#!/bin/sh')).toBe(true);
        expect(isIngotHook(hook)).toBe(true);
        expect(isIngotHook('#!/bin/sh\nnpx lint-staged')).toBe(false);
        expect(hook).toContain('INGOT_HOOKS_RAN');
    });

    it('draws hook steps as tool cards (terminal for shell steps, compact for agent checks)', () => {
        const shell = hookCardInfo({ step: { name: 'Lint', run: 'npm run lint' }, state: 'failed', output: 'bad', exitCode: 2, startedAt: 5, endedAt: 9 }, 'pre-commit');
        expect(shell.info).toMatchObject({ server: 'ingot', tool: 'run', state: 'error', args: { command: 'npm run lint', description: 'pre-commit · Lint' } });
        expect(shell.text).toBe('bad\nExit code 2.');
        const agent = hookCardInfo({ step: { name: 'Review', agent: 'No TODOs.' }, state: 'passed', output: 'PASS', startedAt: 1 }, 'pre-push');
        expect(agent.info).toMatchObject({ tool: 'hook', state: 'done' });
        expect(agent.text).toBe('PASS');
    });
});
