import { describe, expect, it } from 'vitest';
import { MADE_WITH, withMadeWith } from './made-with';

describe('withMadeWith (IDEA-183)', () => {
    it('adds the trailer after a blank line', () => {
        expect(withMadeWith('Fix the parser', 'ingot')).toBe(`Fix the parser\n\n${MADE_WITH.ingot}\n`);
        expect(withMadeWith('Add tests\n\n- cart\n', 'zaprex')).toBe(`Add tests\n\n- cart\n\n${MADE_WITH.zaprex}\n`);
    });

    it('joins an existing trailer block and never adds it twice', () => {
        const signed = 'Fix it\n\nSigned-off-by: A <a@b.c>';
        expect(withMadeWith(signed, 'ingot')).toBe(`${signed}\n${MADE_WITH.ingot}\n`);
        const once = withMadeWith('Fix it', 'ingot');
        expect(withMadeWith(once, 'zaprex')).toBe(once);
    });

    it('leaves empty messages alone', () => {
        expect(withMadeWith('  \n', 'ingot')).toBe('  \n');
    });
});
