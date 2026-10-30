import { describe, expect, it } from 'vitest';
import { commandPrograms, exploredItems, exploredLine, extractThought, highlightShell, parseProfile, parseRunResult, toolCard } from './tool-cards';

const info = (tool: string, args: Record<string, unknown>, server = 'ingot') => ({ server, tool, args, state: 'done' as const, startedAt: 0, endedAt: 10 });

describe('tool cards (IDEA-177)', () => {
    it('lists the programs a command runs', () => {
        expect(commandPrograms('export PATH="$HOME/bin:$PATH"\nfor d in a b; do\n  echo "== $d"\n  git -C "$d" status -sb\n  git remote -v | head -2\ndone\nnpm view x version 2>&1')).toEqual(['echo', 'git', 'head', 'npm']);
        expect(commandPrograms('FOO=1 ./scripts/build.sh && npx tsc')).toEqual(['build.sh', 'npx']);
    });

    it('splits run output and exit code', () => {
        expect(parseRunResult('hello\nworld\nExit code 0.')).toEqual({ output: 'hello\nworld', exitCode: 0 });
        expect(parseRunResult('Error: boom\nExit code 2.')).toEqual({ output: 'boom', exitCode: 2 });
        expect(parseRunResult('Running in the background as p1 on port 3000. Read more…\nready').note).toMatch(/^Running in the background/);
    });

    it('reads a GitHub-style profile from a tool result', () => {
        const text = 'Result: {"login":"octo","name":"Octo Cat","avatar_url":"https://a/x.png","location":"Tel Aviv","blog":"octo.dev","email":"o@x.dev","public_repos":45,"followers":2,"following":1}';
        expect(parseProfile(text)).toMatchObject({ login: 'octo', name: 'Octo Cat', website: 'https://octo.dev', repos: 45, followers: 2, following: 1 });
        expect(parseProfile('{"login":"x"}')).toBeUndefined();
        expect(parseProfile('not json')).toBeUndefined();
        const card = toolCard(info('get_me', {}, 'github'), text);
        expect(card.kind).toBe('profile');
        expect(card.title).toBe('Ran get_me');
    });

    it('builds a terminal card with a title, programs and exit code', () => {
        const card = toolCard(info('run', { command: 'git status -sb && npm test', description: 'Check the repo' }), 'ok\nExit code 1.');
        expect(card).toMatchObject({ kind: 'terminal', title: 'Check the repo', programs: ['git', 'npm'], output: 'ok', exitCode: 1 });
        expect(toolCard(info('run', { command: 'ls -la' }), 'a\nExit code 0.').title).toBe('ls -la');
    });

    it('falls back to a generic card', () => {
        expect(toolCard(info('git', { op: 'push', branch: 'main' }), 'Done.')).toMatchObject({ kind: 'generic', title: 'Git', detail: 'push main' });
        expect(toolCard(info('search_code', { query: 'foo' }, 'github'), '[]')).toMatchObject({ title: 'Ran search_code', detail: 'foo' });
    });

    it('IDEA-259: code tools get their own title, icon and symbol detail', () => {
        expect(toolCard(info('rename_symbol', { path: 'src/math.ts', symbol: 'add', new_name: 'sum' }), 'Renamed add to sum'))
            .toMatchObject({ kind: 'generic', title: 'Renamed symbol', detail: 'add → sum · src/math.ts', icon: 'symbol-key' });
        expect(toolCard(info('find_references', { path: 'src/math.ts', symbol: 'add' }), 'Error: No references found.'))
            .toMatchObject({ title: 'Found references', icon: 'references', output: 'No references found.' });
        expect(toolCard(info('diagnostics', {}, 'github'), '[]')).toMatchObject({ title: 'Ran diagnostics' });
    });

    it('summarises explored files and searches', () => {
        const steps = [{ kind: 'read', target: 'a.ts, b.ts' }, { kind: 'read', target: 'rules: x' }, { kind: 'run', target: 'ingot/web_search' }, { kind: 'search', target: 'q' }];
        expect(exploredLine(steps, false)).toBe('Explored 2 files, 2 searches');
        expect(exploredLine(steps, true)).toBe('Exploring 2 files, 2 searches');
        expect(exploredLine([{ kind: 'read', target: './' }, { kind: 'read', target: 'a.ts' }], false)).toBe('Explored 1 file, 1 folder');
        expect(exploredLine([{ kind: 'read', target: 'one.ts' }], false)).toBe('Explored 1 file');
        expect(exploredLine([], false)).toBeUndefined();
        expect(exploredItems([
            { kind: 'read', target: 'package.json' },
            { kind: 'read', target: './' },
            { kind: 'read', target: 'rules: style' },
            { kind: 'read', target: 'package.json' },
            { kind: 'search', target: 'total' }
        ])).toEqual([
            { kind: 'read', target: './' },
            { kind: 'read', target: 'package.json' },
            { kind: 'search', target: 'total' }
        ]);
    });

    it('pulls thought blocks out of a reply', () => {
        expect(extractThought('<think>plan it</think>Answer')).toEqual({ thought: 'plan it', rest: 'Answer', thinking: false });
        expect(extractThought('<thinking>still')).toEqual({ thought: 'still', rest: '', thinking: true });
        expect(extractThought('plain')).toEqual({ rest: 'plain', thinking: false });
    });

    it('highlights shell commands', () => {
        const tokens = highlightShell('git -C "$d" status | head -2 # note');
        expect(tokens.filter(t => t.kind === 'cmd').map(t => t.text)).toEqual(['git', 'head']);
        expect(tokens.find(t => t.kind === 'str')?.text).toBe('"$d"');
        expect(tokens.some(t => t.kind === 'flag' && t.text === '-C')).toBe(true);
        expect(tokens.at(-1)).toEqual({ text: '# note', kind: 'comment' });
        expect(tokens.map(t => t.text).join('')).toBe('git -C "$d" status | head -2 # note');
    });
});
