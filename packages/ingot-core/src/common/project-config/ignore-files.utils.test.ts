import { describe, expect, it } from 'vitest';
import { ignoreExcludeGlobs, ignoreRules } from './ignore-files.utils';

describe('IDEA-294 ignore files', () => {
    it('hides .ingotignore paths from agents and the index, .ingotindexingignore only from the index', () => {
        const rules = ignoreRules(['secrets/\n*.pem', '# cursor\n.env'], ['generated/**', undefined]);
        expect(rules.agent('secrets/key.txt')).toBe(true);
        expect(rules.agent('certs/server.pem')).toBe(true);
        expect(rules.agent('.env')).toBe(true);
        expect(rules.agent('generated/api.ts')).toBe(false);
        expect(rules.index('generated/api.ts')).toBe(true);
        expect(rules.index('secrets/key.txt')).toBe(true);
        expect(rules.agent('src/index.ts')).toBe(false);
    });

    it('turns patterns into search excludes', () => {
        expect(ignoreExcludeGlobs('# c\nsecrets/\n/dist\n!keep.txt\n\n*.pem')).toEqual(['secrets', './dist', '*.pem']);
        expect(ignoreExcludeGlobs(undefined)).toEqual([]);
    });
});
