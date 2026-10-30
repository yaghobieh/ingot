import { describe, expect, it } from 'vitest';
import { githubRepoFromRemote, globMatcher, grepMatcher, compileGitignore, isPromptEcho, answerFromProject, answerFromFiles, asksAboutOpenProject, fileQuestionGlob, globPaths, numberLines, parseRgFiles, printsShellInsteadOfRunning, PROJECT_QUESTION, rgArgs, shellReadsAsTools, textForRead, withRepoDefaults, workspaceProtocol } from './workspace-tools';

describe('workspace tools (IDEA-186)', () => {
    it('reads owner/repo from the git remote', () => {
        expect(githubRepoFromRemote('https://github.com/yaghobieh/ingot.git')).toEqual({ owner: 'yaghobieh', repo: 'ingot' });
        expect(githubRepoFromRemote('git@github.com:yaghobieh/ingot.git')).toEqual({ owner: 'yaghobieh', repo: 'ingot' });
        expect(githubRepoFromRemote('ssh://git@github.com/a-b/c.d')).toEqual({ owner: 'a-b', repo: 'c.d' });
        expect(githubRepoFromRemote('https://gitlab.com/a/b.git')).toBeUndefined();
        expect(githubRepoFromRemote('')).toBeUndefined();
    });

    it('tells the agent to read locally first and names the real repo', () => {
        const text = workspaceProtocol({ name: 'shop', branch: 'main', path: '/work/shop', github: { owner: 'yaghobieh', repo: 'ingot' } });
        expect(text).toContain('ingot/read_file');
        expect(text).toContain('ingot/glob');
        expect(text).toContain('source of truth');
        expect(text).toContain('/work/shop');
        expect(text).toContain('FIRST');
        expect(text).toContain('owner "yaghobieh", repo "ingot"');
        expect(text).not.toContain('ingot-labs');
        expect(workspaceProtocol({})).toContain('no GitHub remote');
        expect(workspaceProtocol({})).toContain('source of truth');
    });

    it('fills empty GitHub owner / repo from the remote, keeps explicit ones', () => {
        const gh = { owner: 'yaghobieh', repo: 'ingot' };
        expect(withRepoDefaults({ server: 'github', tool: 'get_file_contents', args: { owner: '', repo: '', path: 'a' } }, gh).args)
            .toEqual({ owner: 'yaghobieh', repo: 'ingot', path: 'a' });
        expect(withRepoDefaults({ server: 'github', tool: 'x', args: { owner: 'o', repo: 'r' } }, gh).args).toEqual({ owner: 'o', repo: 'r' });
        expect(withRepoDefaults({ server: 'fs', tool: 'x', args: { owner: '' } }, gh).args).toEqual({ owner: '' });
    });

    it('spots printed shell commands', () => {
        expect(printsShellInsteadOfRunning('Run this:\n```bash\ncat package.json\n```')).toBe(true);
        expect(printsShellInsteadOfRunning('```ts\nconst a = 1;\n```')).toBe(false);
    });

    it('turns printed reads and commands into tool calls and refuses paths that leave the project', () => {
        const calls = shellReadsAsTools('```bash\ncat src/a.ts\nhead -n 5 README.md\nls src\nnpm test\ncat ../secret\n```');
        expect(calls.map(call => call.tool)).toEqual(['read_file', 'read_file', 'list_dir', 'run']);
        expect(calls[0].args).toEqual({ path: 'src/a.ts' });
        expect(calls[1].args).toEqual({ path: 'README.md', end: 5 });
        expect(calls[2].args).toEqual({ path: 'src' });
        expect(calls[3].args).toEqual({ command: 'npm test' });
        expect(shellReadsAsTools('grep useCart src')).toEqual([{ server: 'ingot', tool: 'grep', args: { pattern: 'useCart', path: 'src' } }]);
        expect(shellReadsAsTools(['cat a.ts', 'cat b.ts', 'cat c.ts', 'cat d.ts', 'cat e.ts'].join('\n'))).toHaveLength(4);
        expect(shellReadsAsTools('cat ../secret')).toEqual([]);
        expect(shellReadsAsTools('cat /etc/passwd')).toEqual([]);
        expect(textForRead('disk', undefined)).toBe('disk');
        expect(textForRead('disk', 'editor')).toBe('editor');
        expect(textForRead(undefined, '')).toBe('');
    });

    it('treats a repeated project question as an echo and answers from the files', () => {
        const asked = 'what do you know about ingot, learn from the code';
        expect(isPromptEcho(`### Gateway reply\nEcho: ${asked}`, asked)).toBe(true);
        expect(isPromptEcho('Echo: First task about the cart', 'First task about the cart')).toBe(true);
        expect(isPromptEcho('This repo builds an IDE.', asked)).toBe(false);
        expect(PROJECT_QUESTION.test(asked)).toBe(true);
        expect(PROJECT_QUESTION.test('First task about the cart')).toBe(false);
        expect(PROJECT_QUESTION.test('learn about the current code')).toBe(true);
        expect(asksAboutOpenProject('what can you tell me about this projetc')).toBe(true);
        expect(asksAboutOpenProject('but what is the idea?')).toBe(true);
        expect(asksAboutOpenProject('First task about the cart')).toBe(false);
        expect(fileQuestionGlob('do you know if there is tsx files here?')).toBe('**/*.tsx');
        expect(fileQuestionGlob('but what is the idea?')).toBeUndefined();
        expect(fileQuestionGlob('First task about the cart')).toBeUndefined();
        const files = answerFromFiles('ingot', '**/*.tsx', ['src/app.tsx', 'packages/ui/button.tsx']);
        expect(files).toContain('2 .tsx files');
        expect(files).toContain('`src/app.tsx`');
        expect(files).toContain('open folder `ingot`');
        expect(answerFromFiles('ingot', '**/*.tsx', [])).toContain('No .tsx files');
        expect(globPaths('2 file(s):\nsrc/app.tsx\nNo files matched')).toEqual(['src/app.tsx']);
        const answer = answerFromProject('ingot', [
            { path: 'package.json', text: JSON.stringify({ name: 'ingot', description: 'An open-source AI IDE.', scripts: { gate: 'npm test', start: 'theia start' } }) },
            { path: 'README.md', text: '# Ingot\n\nA calm desktop IDE.\n' }
        ]);
        expect(answer).toContain('**ingot**');
        expect(answer).toContain('An open-source AI IDE.');
        expect(answer).toContain('The idea: A calm desktop IDE.');
        expect(answer).toContain('`gate`');
        expect(answer).not.toContain('Echo:');
    });

    it('matches grep patterns and globs, numbers lines', () => {
        expect(grepMatcher('usecart', false)('export const useCart')).toBe(true);
        expect(grepMatcher('use[A-Z]', true)('useCart')).toBe(true);
        expect(grepMatcher('(', true)('a (b')).toBe(true);
        expect(globMatcher('*.ts')('src/a.ts')).toBe(true);
        expect(globMatcher('src/**/*.tsx')('src/x/y.tsx')).toBe(true);
        expect(globMatcher('*.ts')('src/a.tsx')).toBe(false);
        expect(numberLines('a\nb\nc', 2, 3)).toEqual({ text: '   2| b\n   3| c', total: 3, shown: [2, 3] });
    });

    it('respects .gitignore and builds ripgrep arguments', () => {
        const ignore = compileGitignore('secret.txt\n*.log\ndist/\n!keep.log\n');
        expect(ignore('secret.txt')).toBe(true);
        expect(ignore('src/secret.txt')).toBe(true);
        expect(ignore('notes.log')).toBe(true);
        expect(ignore('keep.log')).toBe(false);
        expect(ignore('dist/app.js')).toBe(true);
        expect(ignore('src/total.js')).toBe(false);
        const args = rgArgs({ pattern: 'total', path: 'src', glob: '*.js', files: false });
        expect(args).toContain('--fixed-strings');
        expect(args).toContain('--hidden');
        expect(args).not.toContain('--no-ignore');
        expect(parseRgFiles('src/a.js\nsecret.txt\n')).toEqual(['src/a.js', 'secret.txt']);
        // IDEA-287 / IDEA-294: several file globs, plus .ingotignore files.
        const files = rgArgs({ files: true, globs: ['**/AGENTS.md', '**/.ingot/rules/**/*.md'], ignoreFiles: ['.ingotignore'] });
        expect(files.join(' ')).toContain('--ignore-file .ingotignore');
        expect(files.join(' ')).toContain('--files --glob **/AGENTS.md --glob **/.ingot/rules/**/*.md');
    });
});
