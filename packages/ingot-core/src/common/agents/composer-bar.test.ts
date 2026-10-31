import { describe, expect, it } from 'vitest';
import { COMPOSER_BAR_NARROW_PX, COMPOSER_BAR_TINY_PX, COMPOSER_INLINE_IDS, COMPOSER_OVERFLOW_IDS, composerBarWidthClass } from './composer-bar';

describe('composerBarWidthClass (IDEA-188)', () => {
    it('collapses at the narrow and tiny breakpoints', () => {
        expect(composerBarWidthClass(600)).toBe('wide');
        expect(composerBarWidthClass(COMPOSER_BAR_NARROW_PX)).toBe('wide');
        expect(composerBarWidthClass(COMPOSER_BAR_NARROW_PX - 1)).toBe('narrow');
        expect(composerBarWidthClass(COMPOSER_BAR_TINY_PX)).toBe('narrow');
        expect(composerBarWidthClass(COMPOSER_BAR_TINY_PX - 1)).toBe('tiny');
        expect(composerBarWidthClass(0)).toBe('tiny');
    });

    it('keeps attach, model and send in the bar and moves the extras into the menu', () => {
        expect(COMPOSER_INLINE_IDS).toEqual(['ingot-composer-attach', 'ingot-composer-model', 'ingot-composer-sandbox', 'ingot-composer-more', 'ingot-composer-send']);
        expect([...COMPOSER_OVERFLOW_IDS]).toEqual(['ingot-composer-mode', 'ingot-composer-review', 'ingot-context-ring', 'ingot-composer-mic']);
        expect(COMPOSER_INLINE_IDS).not.toContain('ingot-composer-zaprex');
        expect(COMPOSER_OVERFLOW_IDS).not.toContain('ingot-composer-zaprex');
    });
});
