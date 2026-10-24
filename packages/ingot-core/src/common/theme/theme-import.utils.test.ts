import { describe, expect, it } from 'vitest';
import { parseVsCodeTheme, stripJsonc, upsertTheme } from './theme-import.utils';

const THEME = `{
  // Night Owl–style sample
  "name": "Sample Night",
  "type": "dark",
  "colors": { "editor.background": "#011627", "url": "http://x/y" /* inline */ },
  "tokenColors": [ { "scope": "comment", "settings": { "foreground": "#637777" } }, ],
}`;

describe('VS Code theme import', () => {
    it('strips comments and trailing commas but not strings', () => {
        const parsed = JSON.parse(stripJsonc(THEME));
        expect(parsed.colors.url).toBe('http://x/y');
        expect(parsed.tokenColors).toHaveLength(1);
    });

    it('parses a theme into an Ingot theme', () => {
        const theme = parseVsCodeTheme(THEME, 'night.json');
        expect(theme).toMatchObject({ id: 'user-sample-night', label: 'Sample Night', uiTheme: 'vs-dark' });
        expect(parseVsCodeTheme('{"type":"light","colors":{}}', 'paper-color-theme.json')).toMatchObject({ label: 'paper', uiTheme: 'vs' });
    });

    it('rejects files that are not color themes', () => {
        expect(() => parseVsCodeTheme('nope', 'a.json')).toThrow(/valid JSON/);
        expect(() => parseVsCodeTheme('{"name":"x"}', 'a.json')).toThrow(/not a VS Code color theme/);
        expect(() => parseVsCodeTheme('{"colors":{},"include":"./base.json"}', 'a.json')).toThrow(/include/);
    });

    it('upserts by id', () => {
        const a = parseVsCodeTheme(THEME, 'a.json');
        expect(upsertTheme([a], { ...a, uiTheme: 'vs' })).toEqual([{ ...a, uiTheme: 'vs' }]);
    });
});
