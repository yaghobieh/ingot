import { describe, expect, it } from 'vitest';
import { DARK_TOKENS, LIGHT_TOKENS } from '../theme/palette.consts';
import { isLaunchColor, launchBackground } from './launch.utils';

describe('launch window background', () => {
    it('accepts solid colors as getComputedStyle and the theme report them', () => {
        expect(isLaunchColor('rgb(43, 45, 48)')).toBe(true);
        expect(isLaunchColor('rgba(43, 45, 48, 1)')).toBe(true);
        expect(isLaunchColor('#F7F8FA')).toBe(true);
        expect(isLaunchColor('#fff')).toBe(true);
        expect(isLaunchColor(' #2B2D30 ')).toBe(true);
    });

    it('rejects transparent, empty and non-color values', () => {
        expect(isLaunchColor('rgba(0, 0, 0, 0)')).toBe(false);
        expect(isLaunchColor('#2B2D3000')).toBe(false);
        expect(isLaunchColor('transparent')).toBe(false);
        expect(isLaunchColor('')).toBe(false);
        expect(isLaunchColor(null)).toBe(false);
        expect(isLaunchColor(undefined)).toBe(false);
        expect(isLaunchColor('red; background: url(x)')).toBe(false);
        expect(isLaunchColor('url(https://x.dev/a.png)')).toBe(false);
    });

    it('uses the saved theme background', () => {
        expect(launchBackground('rgb(30, 31, 34)', false)).toBe('rgb(30, 31, 34)');
        expect(launchBackground(' #FFFFFF ', true)).toBe('#FFFFFF');
    });

    it('falls back to the Ingot canvas of the OS appearance on first launch', () => {
        expect(launchBackground(null, false)).toBe(LIGHT_TOKENS.toolbar);
        expect(launchBackground(undefined, true)).toBe(DARK_TOKENS.toolbar);
        expect(launchBackground('rgba(0, 0, 0, 0)', true)).toBe(DARK_TOKENS.toolbar);
    });
});
