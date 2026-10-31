import { describe, expect, it } from 'vitest';
import { SETTINGS_TREE } from './settings.consts';
import { coerceSetting, flattenPages, pagesFor, searchPages, settingLabel, themeIdFromLabel, uiThemeFor, visiblePreferences } from './settings.utils';

const describeKey = (key: string) => (key === 'editor.fontSize' ? { key, description: 'Controls the font size in pixels.' } : undefined);

describe('settings', () => {
    it('flattens the tree with breadcrumb paths', () => {
        const font = flattenPages(SETTINGS_TREE).find(p => p.page.id === 'editor-font')!;
        expect(font.path).toEqual(['Editor', 'Font']);
    });

    it('labels keys like classic IDEs', () => {
        expect(settingLabel('editor.fontSize')).toBe('Font Size');
        expect(settingLabel('workbench.colorTheme')).toBe('Color Theme');
    });

    it('searches pages and keeps ancestors', () => {
        const hits = searchPages(SETTINGS_TREE, 'pixels', describeKey);
        expect([...hits].sort()).toEqual(['editor', 'editor-font']);
        expect(searchPages(SETTINGS_TREE, 'theme', describeKey).has('appearance')).toBe(true);
        expect(searchPages(SETTINGS_TREE, '', describeKey).size).toBe(flattenPages(SETTINGS_TREE).length);
        const font = flattenPages(SETTINGS_TREE).find(p => p.page.id === 'editor-font')!.page;
        expect(visiblePreferences(font, 'size', describeKey)).toEqual(['editor.fontSize']);
        expect(visiblePreferences(font, '', describeKey).length).toBe(4);
    });

    it('coerces values and builds theme ids', () => {
        expect(coerceSetting('14', 'number')).toBe(14);
        expect(coerceSetting('abc', 'number')).toBeUndefined();
        expect(coerceSetting(true, 'boolean')).toBe(true);
        expect(themeIdFromLabel('My Night Owl!')).toBe('user-my-night-owl');
        expect(uiThemeFor('light')).toBe('vs');
        expect(uiThemeFor('dark')).toBe('vs-dark');
        expect(uiThemeFor('hc')).toBe('hc-black');
    });

    it('shows the Team Rules page to admins only (IDEA-287)', () => {
        const ids = (admin: boolean): string[] => flattenPages(pagesFor(SETTINGS_TREE, admin)).map(p => p.page.id);
        expect(ids(true)).toContain('team-rules');
        expect(ids(false)).not.toContain('team-rules');
        expect(ids(false)).toContain('user-rules');
    });
});
