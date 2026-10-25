import { describe, expect, it } from 'vitest';
import { themeForAppearance, toAppearanceMode } from './appearance.utils';

describe('appearance', () => {
    it('maps modes to themes and follows the OS in System mode', () => {
        expect(themeForAppearance('light', true)).toBe('ingot-light');
        expect(themeForAppearance('dark', false)).toBe('ingot-dark');
        expect(themeForAppearance('system', true)).toBe('ingot-dark');
        expect(themeForAppearance('system', false)).toBe('ingot-light');
        expect(themeForAppearance('custom', true)).toBeUndefined();
    });

    it('defaults unknown values to System', () => {
        expect(toAppearanceMode('nope')).toBe('system');
        expect(toAppearanceMode('dark')).toBe('dark');
    });
});
