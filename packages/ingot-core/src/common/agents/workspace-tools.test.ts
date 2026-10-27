import { describe, expect, it } from 'vitest';
import { githubRepoFromRemote, globMatcher, grepMatcher, numberLines, printsShellInsteadOfRunning, withRepoDefaults, workspaceProtocol } from './workspace-tools';

describe('workspace tools (IDEA-186)', () => {
    it('reads owner/repo from the git remote', () => {
        expect(githubRepoFromRemote('https://github.com/yaghobieh/ingot.git')).toEqual({ owner: 'yaghobieh', repo: 'ingot' });
        expect(githubRepoFromRemote('git@github.com:yaghobieh/ingot.git')).toEqual({ owner: 'yaghobieh', repo: 'ingot' });
        expect(githubRepoFromRemote('ssh://git@github.com/a-b/c.d')).toEqual({ owner: 'a-b', repo: 'c.d' });
        expect(githubRepoFromRemote('https://gitlab.com/a/b.git')).toBeUndefined();
        expect(githubRepoFromRemote('')).toBeUndefined();
    });

    it('tells the agent to read locally first and names the real repo', () => {
        const text = workspaceProtocol({ name: 'shop', branch: 'main', github: { owner: 'yaghobieh', repo: 'ingot' } });
        expect(text).toContain('ingot/read_file');
        expect(text).toContain('FIRST');
        expect(text).toContain('owner "yaghobieh", repo "ingot"');
        expect(text).not.toContain('ingot-labs');
        expect(workspaceProtocol({})).toContain('no GitHub remote');
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

    it('matches grep patterns and globs, numbers lines', () => {
        expect(grepMatcher('usecart', false)('export const useCart')).toBe(true);
        expect(grepMatcher('use[A-Z]', true)('useCart')).toBe(true);
        expect(grepMatcher('(', true)('a (b')).toBe(true);
        expect(globMatcher('*.ts')('src/a.ts')).toBe(true);
        expect(globMatcher('src/**/*.tsx')('src/x/y.tsx')).toBe(true);
        expect(globMatcher('*.ts')('src/a.tsx')).toBe(false);
        expect(numberLines('a\nb\nc', 2, 3)).toEqual({ text: '   2| b\n   3| c', total: 3, shown: [2, 3] });
    });
});
