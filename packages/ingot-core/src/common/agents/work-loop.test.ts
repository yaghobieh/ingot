import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
    checkPassed, commitBlockReason, detectChecks, detectE2eFramework, isRemoteCodeFetch, parseCheckFailures, userAskedForRemote, wantsWorkLoop, weakensTests
} from './work-loop';
import type { LoopSnapshot } from './work-loop.types';

const loop = (patch: Partial<LoopSnapshot> = {}): LoopSnapshot => ({
    wants: true, edits: ['src/total.js'], checks: [], fixAttempts: 0, e2eNudged: false, commitNudged: false,
    commitBlocked: false, committed: false, verifiedEdits: 1, ...patch
});

describe('work loop (IDEA-248)', () => {
    it('detects package checks, prefers gate, and adds e2e', () => {
        const scripts = { test: 'node --test', lint: 'eslint .', gate: 'npm test', e2e: 'playwright test' };
        expect(detectChecks({ scripts, manager: 'npm', files: ['package.json'] }, false).map(check => check.id)).toEqual(['gate']);
        expect(detectChecks({ scripts: { test: 'node --test', lint: 'eslint .' }, manager: 'pnpm', files: [] }, false).map(check => check.command))
            .toEqual(['pnpm run test', 'pnpm run lint']);
        expect(detectChecks({ scripts, manager: 'npm', files: ['playwright.config.ts'] }, true).map(check => check.id)).toEqual(['gate', 'e2e']);
        expect(detectChecks({ scripts: {}, files: ['pyproject.toml'] }, false)[0].command).toBe('python -m pytest');
        expect(detectChecks({ scripts: {}, files: ['go.mod'] }, false)[0].id).toBe('go-test');
        expect(detectE2eFramework(['playwright.config.ts'])).toBe('playwright');
        expect(detectE2eFramework(['cypress.config.js'])).toBe('cypress');
    });

    it('reads a failure and refuses a weaker test', () => {
        const failures = parseCheckFailures('src/total.test.js:4: expected 3\nnot ok 1 - adds\n');
        expect(failures[0]).toMatchObject({ file: 'src/total.test.js', line: 4 });
        expect(weakensTests('test("adds", () => {})\n', 'test.skip("adds", () => {})\n')).toBe(true);
        expect(weakensTests('test("a", () => {})\ntest("b", () => {})\n', 'test("a", () => {})\n')).toBe(true);
        expect(weakensTests('', 'test("adds", () => {})\n')).toBe(false);
    });

    it('blocks protected branches and red checks, allows a green feature branch', () => {
        const passed = loop({ checks: [{ command: 'CI=1 npm run test', passed: true, output: '' }] });
        expect(commitBlockReason('main', passed, ['CI=1 npm run test'])).toMatch(/protected/);
        expect(commitBlockReason('release/0.1.0', passed, [])).toMatch(/protected/);
        expect(commitBlockReason('feature/fix-total', loop(), ['CI=1 npm run test'])).toMatch(/have not passed/);
        expect(commitBlockReason('feature/fix-total', passed, ['CI=1 npm run test'])).toBeUndefined();
        expect(commitBlockReason('bug/IDEA-248', passed, ['CI=1 npm run test'])).toBeUndefined();
    });

    it('does not treat a backgrounded check as a pass', () => {
        expect(checkPassed({ isError: false })).toBe(true);
        expect(checkPassed({ isError: false, movedToBackground: false })).toBe(true);
        expect(checkPassed({ isError: true })).toBe(false);
        expect(checkPassed({ isError: false, movedToBackground: true })).toBe(false);
    });

    it('starts the loop for a fix and blocks guessed code fetches', () => {
        expect(wantsWorkLoop('Fix the cart total and commit')).toBe(true);
        expect(wantsWorkLoop('Add subtract to math.ts')).toBe(false);
        expect(isRemoteCodeFetch({ server: 'github', tool: 'get_file_contents', args: { owner: 'acme', repo: 'widgets', path: 'a' } })).toBe(true);
        expect(isRemoteCodeFetch({ server: 'github', tool: 'get_me', args: {} })).toBe(false);
        expect(isRemoteCodeFetch({ server: 'ingot', tool: 'web_fetch', args: { url: 'https://github.com/acme/widgets' } })).toBe(true);
        expect(userAskedForRemote('learn the current code')).toBe(false);
        expect(userAskedForRemote('show the GitHub pull request')).toBe(true);
    });

    it('scores the seed tasks', () => {
        const tasks = [
            { id: 'gate', pass: detectChecks({ scripts: { gate: 'g', test: 't' }, files: [] }, false).length === 1 },
            { id: 'e2e', pass: detectChecks({ scripts: { test: 't', e2e: 'e' }, manager: 'npm', files: [] }, true).some(check => check.id === 'e2e') },
            { id: 'pytest', pass: detectChecks({ scripts: {}, files: ['pyproject.toml'] }, false)[0]?.id === 'pytest' },
            { id: 'gradle', pass: detectChecks({ scripts: {}, files: ['build.gradle.kts'] }, false)[0]?.id === 'gradle-test' },
            { id: 'failure-line', pass: parseCheckFailures('src/a.ts:12: boom')[0]?.line === 12 },
            { id: 'protected', pass: !!commitBlockReason('master', loop(), []) },
            { id: 'feature', pass: commitBlockReason('feature/x', loop({ checks: [{ command: 'npm test', passed: true, output: '' }] }), ['npm test']) === undefined },
            { id: 'red', pass: !!commitBlockReason('feature/x', loop(), ['npm test']) },
            { id: 'weaken', pass: weakensTests('it("a", () => 1)\n', 'it.skip("a", () => 1)\n') },
            { id: 'intent', pass: wantsWorkLoop('implement the banner feature') && !wantsWorkLoop('what is a branch') },
            { id: 'remote', pass: isRemoteCodeFetch({ server: 'github', tool: 'get_file_contents', args: { path: 'README.md' } }) && !userAskedForRemote('learn this project') },
            { id: 'new-test', pass: !weakensTests('', 'test("banner", () => {})\n') }
        ];
        const passed = tasks.filter(task => task.pass).length;
        const report = { ticket: 'IDEA-248', tasks: tasks.length, passed, passRate: passed / tasks.length, results: tasks };
        expect(report.passRate).toBe(1);
        const dir = path.resolve(__dirname, '../../../../../.ingot-tmp/eval');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'idea-248.json'), `${JSON.stringify(report, undefined, 2)}\n`);
    });
});
