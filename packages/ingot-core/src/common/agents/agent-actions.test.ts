import { describe, expect, it } from 'vitest';
import {
    builtinToolEnabled, builtinToolProtocol, actionLine, activityLine, describeAction, gitOperationFor, needsApproval, skippedResult, toAlwaysRunCommands, toAlwaysRunMap, updateAlwaysRun, updateAlwaysRunCommands
} from './agent-actions';

const git = (args: Record<string, unknown>) => ({ server: 'ingot', tool: 'git', args });

describe('IDEA-109 agent actions', () => {
    it('describes git writes for the card and lets reads through', () => {
        expect(describeAction(git({ op: 'commit', message: 'Fix the parser\n\nlong body' }))).toEqual({ kind: 'git', label: 'Git commit', detail: 'Fix the parser' });
        expect(describeAction(git({ op: 'push' }), 'feature/x')?.detail).toBe('feature/x → origin');
        expect(describeAction(git({ op: 'push', branch: 'main', remote: 'up' }))?.detail).toBe('main → up');
        expect(describeAction(git({ op: 'status' }))).toBeUndefined();
        expect(describeAction({ server: 'ingot', tool: 'web_search', args: { query: 'Mantine components list' } })).toEqual({ kind: 'web', label: 'Search web', detail: 'Mantine components list' });
        expect(describeAction({ server: 'files', tool: 'read', args: { path: 'a.ts' } })).toEqual({ kind: 'mcp', label: 'files: read', detail: 'a.ts' });
    });

    it('maps git calls to operations', () => {
        expect(gitOperationFor({ op: 'commit', message: 'm' })).toMatchObject({ kind: 'commit', message: 'm', amend: false });
        expect(gitOperationFor({ op: 'push', branch: 'b' })).toMatchObject({ kind: 'pushTo', remote: 'origin', localBranch: 'b', force: false });
        expect(gitOperationFor({ op: 'reset', ref: 'HEAD~1', mode: 'hard' })).toEqual({ kind: 'reset', ref: 'HEAD~1', mode: 'hard' });
        expect(() => gitOperationFor({ op: 'gc' })).toThrow(/Unknown git op/);
    });

    it('Always Run is per project and per kind, and revocable', () => {
        const map = updateAlwaysRun(undefined, '/p', 'git');
        const commit = { kind: 'git' as const, label: 'Git commit', detail: 'x' };
        expect(needsApproval(commit, '/p', map, true)).toBe(false);
        expect(needsApproval(commit, '/other', map, true)).toBe(true);
        expect(needsApproval({ ...commit, kind: 'terminal' }, '/p', map, true)).toBe(true);
        expect(needsApproval(commit, '/other', {}, false)).toBe(false);
        expect(updateAlwaysRun(map, '/p', 'git', true)).toEqual({});
        expect(toAlwaysRunMap({ '/p': ['git', 'bogus'], '/q': 'x' })).toEqual({ '/p': ['git'] });
    });

    it('formats the card, the activity line and the skip result', () => {
        expect(actionLine({ kind: 'web', label: 'Search web', detail: 'Mantine components list 8 notable ones with docs' }, 40)).toBe('Search web: Mantine components list 8 n…');
        expect(activityLine([{ kind: 'read', target: 'a.ts, b.ts' }, { kind: 'read', target: 'rules: x' }, { kind: 'run', target: 'ingot/web_search' }, { kind: 'search', target: 'q' }])).toBe('Exploring 2 files, 2 searches');
        expect(activityLine([])).toBeUndefined();
        expect(skippedResult({ kind: 'git', label: 'Git push', detail: 'main → origin' }, 'not yet')).toContain('Reason: not yet');
    });

    it('IDEA-131: run tools describe their command; reads run at once', () => {
        const run = (args: Record<string, unknown>) => describeAction({ server: 'ingot', tool: 'run', args });
        expect(run({ command: ' npm test ' })).toEqual({ kind: 'terminal', label: 'Run command', detail: 'npm test', command: 'npm test' });
        expect(run({ command: 'npm run dev', background: true })?.label).toBe('Run in background');
        for (const tool of ['scripts', 'processes', 'process_output']) {
            expect(describeAction({ server: 'ingot', tool, args: {} })).toBeUndefined();
        }
        expect(describeAction({ server: 'ingot', tool: 'process_stop', args: { id: 'p2' } })).toEqual({ kind: 'terminal', label: 'Stop process', detail: 'p2' });
    });

    it('IDEA-131: Always Run for commands is per command', () => {
        const test = { kind: 'terminal' as const, label: 'Run command', detail: 'npm test', command: 'npm test' };
        const commands = updateAlwaysRunCommands(undefined, '/p', 'npm test');
        expect(needsApproval(test, '/p', {}, true, commands)).toBe(false);
        expect(needsApproval({ ...test, detail: 'rm -rf x', command: 'rm -rf x' }, '/p', {}, true, commands)).toBe(true);
        expect(needsApproval(test, '/q', {}, true, commands)).toBe(true);
        expect(updateAlwaysRunCommands(updateAlwaysRunCommands(commands, '/p', 'npm test'), '/p', 'npm run build')).toEqual({ '/p': ['npm test', 'npm run build'] });
        expect(updateAlwaysRunCommands(commands, '/p', 'npm test', true)).toEqual({});
        expect(toAlwaysRunCommands({ '/p': ['npm test', ' ', 3], '/q': [] })).toEqual({ '/p': ['npm test'] });
    });

    it('IDEA-130: browser actions read well on the card', () => {
        const b = (tool: string, args: Record<string, unknown>) => describeAction({ server: 'ingot', tool, args });
        expect(b('browser_open', { url: 'http://localhost:5173' })).toEqual({ kind: 'browser', label: 'Open page', detail: 'http://localhost:5173' });
        expect(b('browser_click', { text: 'Sign in' })?.detail).toBe('"Sign in"');
        expect(b('browser_type', { label: 'Search', text: 'red shoes', submit: true })?.detail).toBe('"red shoes" into "Search" and submit');
        expect(b('browser_type', { ref: 4, text: 'x' })?.detail).toBe('"x" into [4]');
        expect(b('browser_read', {})?.kind).toBe('browser');
    });

    it('IDEA-133: Agent tools settings hide the command and browser tools from the prompt', () => {
        const all = builtinToolProtocol();
        expect(all).toContain('ingot/run:');
        expect(all).toContain('ingot/browser_open:');
        const off = builtinToolProtocol({ terminal: false, browser: false });
        expect(off).not.toContain('ingot/run:');
        expect(off).not.toContain('ingot/run_script:');
        expect(off).not.toContain('ingot/browser_');
        expect(off).toContain('ingot/scripts:');
        expect(off).toContain('ingot/processes:');
        expect(builtinToolEnabled('browser_read', { terminal: true, browser: false })).toBe(false);
        expect(builtinToolEnabled('process_stop', { terminal: false, browser: true })).toBe(true);
    });
});
