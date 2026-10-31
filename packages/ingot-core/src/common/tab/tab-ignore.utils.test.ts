import { describe, expect, it } from 'vitest';
import { TAB_DEFAULT_IGNORE } from './tab.consts';
import { isIgnoredPath, parseIgnoreRules } from './tab-ignore.utils';

const ignored = (path: string, lines: string[]): boolean => isIgnoredPath(path, parseIgnoreRules(lines));

describe('.ingotignore matching (IDEA-285)', () => {
    it('skips blank lines and comments', () => {
        expect(parseIgnoreRules(['', '  ', '# secrets', '/'])).toEqual([]);
    });

    it('matches a bare name at any depth', () => {
        expect(ignored('secrets.ts', ['secrets.ts'])).toBe(true);
        expect(ignored('src/deep/secrets.ts', ['secrets.ts'])).toBe(true);
        expect(ignored('src/secrets.tsx', ['secrets.ts'])).toBe(false);
    });

    it('supports * and ? without crossing folders', () => {
        expect(ignored('src/keys/prod.pem', ['*.pem'])).toBe(true);
        expect(ignored('a1.txt', ['a?.txt'])).toBe(true);
        expect(ignored('src/a/b.ts', ['src/*.ts'])).toBe(false);
    });

    it('anchors patterns with a slash to the workspace root', () => {
        expect(ignored('config/prod.json', ['/config/*.json'])).toBe(true);
        expect(ignored('config/prod.json', ['config/*.json'])).toBe(true);
        expect(ignored('app/config/prod.json', ['config/*.json'])).toBe(false);
        expect(ignored('app/config/prod.json', ['**/config/*.json'])).toBe(true);
    });

    it('ignores everything under an ignored folder', () => {
        expect(ignored('private/notes/a.md', ['private/'])).toBe(true);
        expect(ignored('src/private/a.md', ['private/'])).toBe(true);
        expect(ignored('private', ['private/'])).toBe(false);
        expect(ignored('vendor/lib/x.js', ['vendor/**'])).toBe(true);
    });

    it('lets a later ! rule re-include a file', () => {
        expect(ignored('.env.example', ['.env*', '!.env.example'])).toBe(false);
        expect(ignored('.env.local', ['.env*', '!.env.example'])).toBe(true);
    });

    it('escapes regex characters in names', () => {
        expect(ignored('a+b.ts', ['a+b.ts'])).toBe(true);
        expect(ignored('aab.ts', ['a+b.ts'])).toBe(false);
    });

    it('never sends env files, keys or the Ingot config by default', () => {
        for (const path of ['.env', 'api/.env.production', 'certs/server.key', 'ingot.config.json', '.ssh/id_rsa.pub', '.ingotignore']) {
            expect(ignored(path, [...TAB_DEFAULT_IGNORE])).toBe(true);
        }
        expect(ignored('src/env.ts', [...TAB_DEFAULT_IGNORE])).toBe(false);
    });
});
