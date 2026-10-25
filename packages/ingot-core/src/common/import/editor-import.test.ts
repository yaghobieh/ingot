import { describe, expect, it } from 'vitest';
import { compareVersions, latestPerId, mergeKeybindings, mergeSettings, openVsxPath, parseExtensionFolder, parseExtensionsManifest, parseJsonc, userSettingsDirs } from './editor-import';

describe('import from another editor (IDEA-107)', () => {
    it('reads extension folder names', () => {
        expect(parseExtensionFolder('esbenp.prettier-vscode-11.0.0')).toEqual({ id: 'esbenp.prettier-vscode', version: '11.0.0' });
        expect(parseExtensionFolder('ms-python.python-2024.2.1-darwin-arm64')).toEqual({ id: 'ms-python.python', version: '2024.2.1' });
        expect(parseExtensionFolder('.obsolete')).toBeUndefined();
        expect(parseExtensionFolder('extensions.json')).toBeUndefined();
    });
    it('reads extensions.json', () => {
        const json = JSON.stringify([
            { identifier: { id: 'Acme.Tools' }, version: '1.2.0', relativeLocation: 'acme.tools-1.2.0' },
            { identifier: { id: 'x.y' }, version: '0.1.0', location: { fsPath: '/abs/x.y-0.1.0' } },
            { identifier: {} }
        ]);
        expect(parseExtensionsManifest(json)).toEqual([
            { id: 'acme.tools', version: '1.2.0', location: 'acme.tools-1.2.0' },
            { id: 'x.y', version: '0.1.0', location: '/abs/x.y-0.1.0' }
        ]);
        expect(parseExtensionsManifest('not json')).toEqual([]);
    });
    it('keeps the newest version of each id', () => {
        expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
        const list = latestPerId([{ id: 'a.b', version: '1.0.0' }, { id: 'a.b', version: '1.2.0' }, { id: 'c.d', version: '0.1.0' }]);
        expect(list).toEqual([{ id: 'a.b', version: '1.2.0' }, { id: 'c.d', version: '0.1.0' }]);
    });
    it('builds Open VSX paths and settings folders', () => {
        expect(openVsxPath('esbenp.prettier-vscode')).toBe('/api/esbenp/prettier-vscode');
        expect(openVsxPath('nodot')).toBeUndefined();
        expect(userSettingsDirs('darwin', 0)[0]).toMatch(/^Library\/Application Support\/.+\/User$/);
        expect(userSettingsDirs('linux', 1)[0]).toMatch(/^\.config\/.+\/User$/);
    });
    it('parses JSONC and merges without overwriting', () => {
        const parsed = parseJsonc('{\n // comment\n "editor.fontSize": 14, /* c */ "url": "http://x//y",\n}') as Record<string, unknown>;
        expect(parsed).toEqual({ 'editor.fontSize': 14, url: 'http://x//y' });
        expect(mergeSettings({ 'editor.fontSize': 12 }, { 'editor.fontSize': 14, 'editor.tabSize': 2 })).toEqual({ merged: { 'editor.fontSize': 12, 'editor.tabSize': 2 }, added: 1, skipped: 1 });
        const keys = mergeKeybindings([{ key: 'cmd+k', command: 'a' }], [{ key: 'cmd+k', command: 'a' }, { key: 'cmd+j', command: 'b' }, { command: 'c' }]);
        expect(keys.added).toBe(1);
        expect(keys.skipped).toBe(2);
    });
});
