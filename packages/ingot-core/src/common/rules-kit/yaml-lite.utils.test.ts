import { describe, expect, it } from 'vitest';
import { parseYaml } from './yaml-lite.utils';

describe('parseYaml (rule test subset)', () => {
    it('reads maps, lists of maps, flow lists, scalars and comments', () => {
        const doc = parseYaml([
            '# rule tests',
            'name: Naming',
            'runs: 2',
            'rules: [engineering, "ui"]',
            'tests:',
            '  - name: types file',
            '    prompt: Where does the CartItem type go?  # inline comment',
            '    assert:',
            '      - contains: cart.types.ts',
            '      - not_matches: "export default"',
            '    mock: \'It goes in cart.types.ts\'',
            '  - prompt: Second',
            '    assert:',
            '    - max_words: 40',
            'empty: []',
            'flag: true',
            'nothing: ~'
        ].join('\n'));
        expect(doc).toEqual({
            name: 'Naming', runs: 2, rules: ['engineering', 'ui'],
            tests: [
                { name: 'types file', prompt: 'Where does the CartItem type go?', assert: [{ contains: 'cart.types.ts' }, { not_matches: 'export default' }], mock: 'It goes in cart.types.ts' },
                { prompt: 'Second', assert: [{ max_words: 40 }] }
            ],
            empty: [], flag: true, nothing: null
        });
    });

    it('reads literal and folded block scalars', () => {
        const doc = parseYaml('a: |\n  line one\n  line two\n\nb: >-\n  folded\n  text\n\n  next\nc: x');
        expect(doc).toEqual({ a: 'line one\nline two\n', b: 'folded text\nnext', c: 'x' });
    });

    it('keeps colons inside values and quoted strings with escapes', () => {
        expect(parseYaml('judge: The reply says: use import type\nq: "a\\nb \\"c\\""')).toEqual({ judge: 'The reply says: use import type', q: 'a\nb "c"' });
    });

    it('reports the line of a syntax error', () => {
        expect(() => parseYaml('a: 1\n  b: 2')).toThrow('line 2');
        expect(() => parseYaml('just text')).toThrow('line 1');
    });
});
