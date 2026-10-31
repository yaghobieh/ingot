import { describe, expect, it } from 'vitest';
import {
    convertWorktreesJson, parseWorktreesJson, tailOutput, worktreeSetupFiles, worktreeSetupFor, worktreeSetupPlan, worktreeSetupSummary
} from './worktree-setup.utils';
import { WORKTREE_SETUP_OUTPUT_CHARS } from './worktree-setup.consts';

describe('IDEA-287 worktrees.json setup', () => {
    it('reads the setup keys (comments allowed) and picks the platform entry, else setup-worktree', () => {
        const config = parseWorktreesJson(`{
            // install first
            "setup-worktree-unix": ["npm ci", "cp $ROOT_WORKTREE_PATH/.env .env"],
            "setup-worktree-windows": "setup.ps1",
            "setup-worktree": ["npm install"],
        }`)!;
        expect(worktreeSetupFor(config, 'darwin')).toEqual(['npm ci', 'cp $ROOT_WORKTREE_PATH/.env .env']);
        expect(worktreeSetupFor(config, 'win32')).toBe('setup.ps1');
        expect(worktreeSetupFor({ any: ['npm install'] }, 'linux')).toEqual(['npm install']);
        expect(worktreeSetupFor({}, 'linux')).toBeUndefined();
        expect(parseWorktreesJson('[1]')).toBeUndefined();
        expect(parseWorktreesJson('{"setup-worktree": ["", 3]}')).toEqual({});
    });

    it('resolves a script path against the folder of its worktrees.json', () => {
        expect(worktreeSetupPlan(['npm ci'], '/repo/.cursor')).toEqual({ kind: 'commands', commands: ['npm ci'] });
        expect(worktreeSetupPlan('./setup.sh', '/repo/.cursor/')).toEqual({ kind: 'script', script: '/repo/.cursor/setup.sh' });
        expect(worktreeSetupPlan('/opt/setup.sh', '/repo/.cursor')).toEqual({ kind: 'script', script: '/opt/setup.sh' });
        expect(worktreeSetupPlan('C:\\setup.ps1', 'C:\\repo\\.cursor')).toEqual({ kind: 'script', script: 'C:\\setup.ps1' });
    });

    it('looks in .ingot first and in .cursor only while it is read live', () => {
        expect(worktreeSetupFiles(true)).toEqual(['.ingot/worktrees.json', '.cursor/worktrees.json']);
        expect(worktreeSetupFiles(false)).toEqual(['.ingot/worktrees.json']);
    });

    it('Convert points script paths back at .cursor and keeps command lists', () => {
        const converted = JSON.parse(convertWorktreesJson('{"setup-worktree-unix": "setup.sh", "setup-worktree": ["npm ci"], "other": "x"}'));
        expect(converted).toEqual({ 'setup-worktree-unix': '../.cursor/setup.sh', 'setup-worktree': ['npm ci'], other: 'x' });
        expect(convertWorktreesJson('not json')).toBe('not json');
    });

    it('summarizes the run and keeps the end of long output', () => {
        expect(worktreeSetupSummary({ source: '.ingot/worktrees.json', ran: 2, ok: true, output: '' })).toBe('Worktree setup ran (.ingot/worktrees.json, 2 commands).');
        expect(worktreeSetupSummary({ source: '.cursor/worktrees.json', ran: 1, ok: false, output: '', error: 'npm ci: exit 1' }))
            .toBe('Worktree setup failed (.cursor/worktrees.json, 1 command): npm ci: exit 1');
        const long = 'x'.repeat(WORKTREE_SETUP_OUTPUT_CHARS) + 'END';
        expect(tailOutput(long).endsWith('END')).toBe(true);
        expect(tailOutput(long).length).toBe(WORKTREE_SETUP_OUTPUT_CHARS + 1);
    });
});
