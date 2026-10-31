import { describe, expect, it } from 'vitest';
import { directiveObject, extractDirectives, findDirectiveConflicts } from './directives.utils';

describe('directives', () => {
    it('extracts what a rule asks for and forbids, skipping code and headings', () => {
        const directives = extractDirectives('# Style\n- Always use **tabs** for indentation.\n- Never use `default exports`.\n```\nnever run this\n```\nPlease prefer named exports. Keep it short.', 10);
        expect(directives.map(d => [d.polarity, d.object, d.line])).toEqual([
            [1, 'tabs', 11],
            [-1, 'default exports', 12],
            [1, 'named exports', 16]
        ]);
    });

    it('normalizes objects', () => {
        expect(directiveObject('use the semicolons in TypeScript files.')).toBe('semicolons');
        expect(directiveObject('using console.log')).toBe('console.log');
    });

    it('finds opposite and mutually exclusive directives', () => {
        const a = extractDirectives('Use tabs.\nUse semicolons.\nUse npm for scripts.');
        const b = extractDirectives('Never use tab.\nNo semicolons.\nUse 2 spaces for indentation.\nUse pnpm.');
        expect(findDirectiveConflicts(a, b).map(c => `${c.reason}: ${c.a.object} / ${c.b.object}`)).toEqual([
            'opposite: tabs / tab',
            'exclusive: tabs / 2 spaces',
            'opposite: semicolons / semicolons',
            'exclusive: npm / pnpm'
        ]);
        expect(findDirectiveConflicts(extractDirectives('Use tabs, not spaces.'), extractDirectives('Use tabs.'))).toEqual([]);
    });
});
