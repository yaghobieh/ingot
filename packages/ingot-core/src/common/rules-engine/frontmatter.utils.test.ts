import { describe, expect, it } from 'vitest';
import { asList, parseFrontmatterBlock } from './frontmatter.utils';

describe('parseFrontmatterBlock', () => {
    it('reads keys, booleans, inline and dash lists with positions', () => {
        const parsed = parseFrontmatterBlock('---\ndescription: React rules\nglobs: ["src/**/*.tsx", src/**/*.ts]\nalwaysApply: false\nkeywords:\n  - cart\n  - "checkout"\n---\n\nUse hooks.\n');
        expect(parsed.present).toBe(true);
        expect(parsed.data).toEqual({ description: 'React rules', globs: ['src/**/*.tsx', 'src/**/*.ts'], alwaysApply: false, keywords: ['cart', 'checkout'] });
        const globs = parsed.entries.find(e => e.key === 'globs')!;
        expect(globs.items.map(i => i.range)).toEqual([
            { line: 2, column: 8, endLine: 2, endColumn: 22 },
            { line: 2, column: 24, endLine: 2, endColumn: 35 }
        ]);
        expect(parsed.entries.find(e => e.key === 'keywords')!.items[1].range).toEqual({ line: 6, column: 4, endLine: 6, endColumn: 14 });
        expect(parsed.body).toBe('Use hooks.');
        expect(parsed.bodyLine).toBe(8);
    });

    it('treats an empty value without list items as empty text, and splits comma strings into items', () => {
        const parsed = parseFrontmatterBlock('---\ndescription:\nglobs: src/**, test/**\n---\nBody');
        expect(parsed.data.description).toBe('');
        expect(parsed.entries[1].items.map(i => i.value)).toEqual(['src/**', 'test/**']);
        expect(asList(parsed.data.globs)).toEqual(['src/**', 'test/**']);
    });

    it('reports unclosed blocks, bad lines and duplicate keys', () => {
        const parsed = parseFrontmatterBlock('---\nalwaysApply: true\nnot a pair\nalwaysApply: false\n');
        expect(parsed.unclosed).toBe(true);
        expect(parsed.problems.map(p => p.message)).toEqual(['Expected "key: value".', 'Duplicate key "alwaysApply".', 'Frontmatter starts with "---" but is never closed.']);
    });

    it('returns the whole text as body when there is no frontmatter', () => {
        expect(parseFrontmatterBlock('# Rules\n- one').present).toBe(false);
        expect(parseFrontmatterBlock('# Rules\n- one').body).toBe('# Rules\n- one');
    });
});
