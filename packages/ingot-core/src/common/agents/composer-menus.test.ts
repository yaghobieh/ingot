import { describe, expect, it } from 'vitest';
import { mentionQuery, rankFiles, SLASH_BUILTINS } from './composer-menus';

describe('composer menus (IDEA-187)', () => {
    it('finds the @query before the caret', () => {
        expect(mentionQuery('@')).toBe('');
        expect(mentionQuery('look at @src/ca')).toBe('src/ca');
        expect(mentionQuery('mail a@b')).toBeUndefined();
        expect(mentionQuery('@cart.ts done')).toBeUndefined();
    });

    it('ranks files by name first', () => {
        const files = ['src/cart.ts', 'src/cart.test.ts', 'docs/cartography.md', 'package.json', 'src/utils/scart.ts'];
        expect(rankFiles(files, 'cart.ts')[0]).toBe('src/cart.ts');
        expect(rankFiles(files, 'zzz')).toEqual([]);
        expect(rankFiles(files, 'pkgjs')).toEqual(['package.json']);
        expect(rankFiles(files, '').length).toBe(5);
    });

    it('has the built-in slash commands', () => {
        expect(SLASH_BUILTINS.map(c => c.name)).toEqual(expect.arrayContaining(['agent', 'ask', 'plan', 'new', 'compact', 'model']));
    });
});
