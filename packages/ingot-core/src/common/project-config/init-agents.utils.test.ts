import { describe, expect, it } from 'vitest';
import { detectStack, orderedScripts, packageManagerOf, packageSignals, scaffoldAgentsMd } from './init-agents.utils';

describe('IDEA-295 /init scaffolds AGENTS.md', () => {
    const pkg = packageSignals(JSON.stringify({
        name: 'shop', description: 'A small shop.', workspaces: ['packages/*'],
        scripts: { postinstall: 'x', lint: 'eslint .', build: 'tsc', test: 'vitest run', dev: 'vite' },
        dependencies: { react: '^19' }, devDependencies: { typescript: '~5', vitest: '^2' }
    }))!;

    it('detects the package manager from the lockfile', () => {
        expect(packageManagerOf(['package.json', 'pnpm-lock.yaml', 'package-lock.json'])).toBe('pnpm');
        expect(packageManagerOf(['package-lock.json'])).toBe('npm');
        expect(packageManagerOf(['README.md'])).toBeUndefined();
    });

    it('reads package.json and detects the stack', () => {
        expect(pkg).toMatchObject({ name: 'shop', description: 'A small shop.', workspaces: ['packages/*'] });
        expect(detectStack({ dependencies: pkg.dependencies, files: ['package.json', 'tsconfig.json', 'Dockerfile'] })).toEqual(['TypeScript', 'Docker', 'React', 'Vitest']);
        expect(detectStack({ dependencies: [], files: ['package.json'] })).toEqual(['Node.js']);
        expect(orderedScripts(pkg.scripts).map(([n]) => n)).toEqual(['dev', 'build', 'test', 'lint']);
        expect(packageSignals('nope')).toBeUndefined();
    });

    it('writes stack, scripts, layout and checks', () => {
        const md = scaffoldAgentsMd({
            name: 'shop', description: pkg.description, packageManager: 'npm', scripts: pkg.scripts, dependencies: pkg.dependencies,
            files: ['package.json', 'tsconfig.json'], folders: ['src', 'e2e', 'misc'], workspaces: pkg.workspaces, rules: ['.ingot/rules/style.md']
        });
        expect(md).toContain('# AGENTS.md — shop');
        expect(md).toContain('## Stack\n\n- TypeScript\n- React\n- Vitest');
        expect(md).toContain('- `npm run dev` — vite');
        expect(md).toContain('- `npm test` — vitest run');
        expect(md).toContain('- `src/` — source code');
        expect(md).toContain('- `misc/`\n');
        expect(md).toContain('- Workspaces: `packages/*`');
        expect(md).toContain('run `npm run lint`, `npm test`');
        expect(md).toContain('`.ingot/rules/style.md`');
        expect(scaffoldAgentsMd({ name: 'x', scripts: {}, dependencies: [], files: [], folders: [], rules: [], packageManager: 'pnpm' })).toContain('build and test it');
    });
});
