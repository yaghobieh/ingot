import { describe, expect, it } from 'vitest';
import { COMPOSER_BAR_NARROW_PX, COMPOSER_BAR_TINY_PX, composerBarWidthClass } from './composer-bar';

describe('composerBarWidthClass (IDEA-188)', () => {
    it('collapses at the narrow and tiny breakpoints', () => {
        expect(composerBarWidthClass(600)).toBe('wide');
        expect(composerBarWidthClass(COMPOSER_BAR_NARROW_PX)).toBe('wide');
        expect(composerBarWidthClass(COMPOSER_BAR_NARROW_PX - 1)).toBe('narrow');
        expect(composerBarWidthClass(COMPOSER_BAR_TINY_PX)).toBe('narrow');
        expect(composerBarWidthClass(COMPOSER_BAR_TINY_PX - 1)).toBe('tiny');
        expect(composerBarWidthClass(0)).toBe('tiny');
    });
});
