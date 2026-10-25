import { describe, expect, it } from 'vitest';
import { INGOT_THEMES, THEME_IDS } from './theme.consts';
import { buildThemeJson } from './theme.utils';

const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

describe('buildThemeJson', () => {
    it('produces valid hex colors for every theme', () => {
        for (const theme of INGOT_THEMES) {
            const json = buildThemeJson(theme);
            for (const [id, value] of Object.entries(json.colors)) {
                expect(value, `${theme.id} ${id}`).toMatch(HEX);
            }
        }
    });

    it('uses a neutral (JetBrains-style) status bar, not a blue one', () => {
        const light = INGOT_THEMES.find(t => t.id === THEME_IDS.light)!;
        const json = buildThemeJson(light);
        expect(json.colors['statusBar.background']).toBe(light.tokens.toolbar);
        expect(json.type).toBe('light');
    });

    it('marks dark themes as dark', () => {
        const dark = INGOT_THEMES.find(t => t.id === THEME_IDS.dark)!;
        expect(buildThemeJson(dark).type).toBe('dark');
    });
});
