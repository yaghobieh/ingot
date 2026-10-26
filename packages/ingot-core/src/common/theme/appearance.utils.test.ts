import { describe, expect, it } from 'vitest';
import { slotForAppearance, themeForAppearance, toAppearanceMode } from './appearance.utils';

describe('appearance', () => {
    it('maps modes to themes and follows the OS in System mode', () => {
        expect(themeForAppearance('light', true)).toBe('ingot-light');
        expect(themeForAppearance('dark', false)).toBe('ingot-dark');
        expect(themeForAppearance('system', true)).toBe('ingot-dark');
        expect(themeForAppearance('system', false)).toBe('ingot-light');
        expect(themeForAppearance('custom', true)).toBeUndefined();
    });

    it('IDEA-144: uses the themes picked for the Light and Dark slots', () => {
        const slots = { light: 'vsx-a-day', dark: 'vsx-a-night' };
        expect(themeForAppearance('system', true, slots)).toBe('vsx-a-night');
        expect(themeForAppearance('system', false, slots)).toBe('vsx-a-day');
        expect(themeForAppearance('light', true, slots)).toBe('vsx-a-day');
        expect(themeForAppearance('dark', false, { light: 'x' })).toBe('ingot-dark');
        expect(slotForAppearance('system', true)).toBe('dark');
        expect(slotForAppearance('light', true)).toBe('light');
        expect(slotForAppearance('custom', true)).toBeUndefined();
    });

    it('defaults unknown values to System', () => {
        expect(toAppearanceMode('nope')).toBe('system');
        expect(toAppearanceMode('dark')).toBe('dark');
    });
});
