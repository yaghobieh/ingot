import { describe, expect, it } from 'vitest';
import { builtinToolEnabled, builtinToolProtocol } from './agent-actions';
import { cutEditNudge, promisesMoreWork, shellGitBlockReason, wantsCommit, wantsE2e, wantsWorkLoop } from './work-loop';
import { parseAgentOutput } from './agent-protocol';

const LIBRARY_PROMPT = 'Create a new React (Vite+TS, feature folders) and Node.js (Express+TS, routes/controllers/services) project with full CRUD APIs for a library (books, authors, loans) at path /tmp/ingot-e2e-lib';

describe('IDEA-282 agent quality loop', () => {
    it('does not read "feature folders" as a feature to ship and commit', () => {
        expect(wantsCommit(LIBRARY_PROMPT)).toBe(false);
        expect(wantsWorkLoop(LIBRARY_PROMPT)).toBe(false);
        expect(wantsE2e(LIBRARY_PROMPT)).toBe(false);
        expect(wantsCommit('Implement the feature folder layout and commit')).toBe(true);
        expect(wantsE2e('Add a feature to the books page')).toBe(true);
        expect(wantsWorkLoop('Add a playwright e2e test for /tmp/app')).toBe(true);
    });

    it('asks for a cut-off file again', () => {
        const parsed = parseAgentOutput('PLAN:\n- server\n\n<<<EDIT server/src/app.ts\nimport express from "express";\nconst app = ex');
        expect(parsed.editing).toBe('server/src/app.ts');
        expect(parsed.edits).toHaveLength(0);
        const nudge = cutEditNudge(parsed.editing ?? '');
        expect(nudge).toContain('server/src/app.ts was NOT saved');
        expect(nudge).toContain('complete block');
    });

    it('keeps going when a reply stops while naming its next step', () => {
        expect(promisesMoreWork('Next: `loanService.ts`, then the controllers.', 0)).toBe(true);
        expect(promisesMoreWork('Routes and the tests come next, then install, build and test.', 0)).toBe(true);
        expect(promisesMoreWork("I'll run npm install in server now.", 0)).toBe(true);
        expect(promisesMoreWork('Tests: next reply adds supertest CRUD tests for all three resources', 0)).toBe(true);
        expect(promisesMoreWork('### Done\nBoth apps build and all tests pass.', 0)).toBe(false);
        expect(promisesMoreWork('Run `npm install`, then run `npm run dev` in each app.', 0)).toBe(false);
        expect(promisesMoreWork('The next button is disabled until the form is valid.', 0)).toBe(false);
        expect(promisesMoreWork('Next: the routes.', 12)).toBe(false);
    });

    it('refuses a shell commit the user never asked for', () => {
        const commit = 'git init -b feature/x && git add . && git -c user.name=Bot commit -m "Init"';
        expect(shellGitBlockReason(commit, LIBRARY_PROMPT, [])).toContain('did not ask for a commit');
        expect(shellGitBlockReason('git push origin main', LIBRARY_PROMPT, [])).toBeDefined();
        expect(shellGitBlockReason(commit, `${LIBRARY_PROMPT} and commit it`, [])).toBeUndefined();
        expect(shellGitBlockReason(commit, LIBRARY_PROMPT, ['Yes, init and commit'])).toBeUndefined();
        expect(shellGitBlockReason('npm install && npm test', LIBRARY_PROMPT, [])).toBeUndefined();
        expect(shellGitBlockReason('git status', LIBRARY_PROMPT, [])).toBeUndefined();
    });

    it('runs a tool written as a fence named after it', () => {
        const parsed = parseAgentOutput('### Checking\n```ingot/list_dir\n{"path": ".", "depth": 1}\n```\nthen\n```run\n{"command": "npm test", "cwd": "server"}\n```');
        expect(parsed.toolCalls).toEqual([
            { server: 'ingot', tool: 'list_dir', args: { path: '.', depth: 1 } },
            { server: 'ingot', tool: 'run', args: { command: 'npm test', cwd: 'server' } }
        ]);
        expect(parsed.display).not.toContain('list_dir');
        expect(parseAgentOutput('Example:\n```ts\n{ a: 1 }\n```').toolCalls).toHaveLength(0);
        expect(parseAgentOutput('```bash\nnpm test\n```').display).toContain('npm test');
        expect(parseAgentOutput('Reading\n```ingot/read_file\n{"path": "pack').display).toBe('Reading');
    });

    it('hides the library template when it is turned off', () => {
        const off = { terminal: true, browser: true, template: false };
        expect(builtinToolEnabled('create_library', off)).toBe(false);
        expect(builtinToolEnabled('create_library', { terminal: true, browser: true })).toBe(true);
        expect(builtinToolEnabled('run', off)).toBe(true);
        const protocol = builtinToolProtocol(off);
        expect(protocol).not.toContain('ingot/create_library');
        expect(protocol).toContain('New project from scratch');
        expect(builtinToolProtocol()).toContain('ingot/create_library');
    });
});
