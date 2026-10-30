import { deflateRawSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import { readZipEntries } from './zip.utils';
import {
    colorThemesFromManifest, formatCount, groupThemes, loadThemeJson, parseStoreSearch, parseUserThemes, resolvePackagePath, storeSearchUrl, swatchOf, themesFromPackage
} from './theme-store.utils';

/** Test-only zip writer (deflate) for building fake .vsix packages. */
function buildZip(files: Record<string, string>): ArrayBuffer {
    const local: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
        const nameBuf = Buffer.from(name);
        const raw = Buffer.from(text);
        const data = deflateRawSync(raw);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(8, 8);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(raw.length, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        local.push(header, nameBuf, data);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt32LE(data.length, 20);
        entry.writeUInt32LE(raw.length, 24);
        entry.writeUInt16LE(nameBuf.length, 28);
        entry.writeUInt32LE(offset, 42);
        central.push(entry, nameBuf);
        offset += header.length + nameBuf.length + data.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    const all = Buffer.concat([...local, cd, end]);
    return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

const ext = (o: Record<string, unknown>) => ({ namespace: 'acme', name: 'night', version: '1.0.0', downloadCount: 1200, files: { download: 'https://x/acme.vsix', icon: 'https://x/i.png' }, ...o });

describe('IDEA-144 theme store', () => {
    it('reads entries from a .vsix (deflate)', async () => {
        const zip = buildZip({ 'extension/package.json': '{"name":"a"}', 'extension/themes/a.json': '{}', 'extension/readme.md': 'hi' });
        const entries = await readZipEntries(zip, n => n.endsWith('.json'));
        expect([...entries.keys()].sort()).toEqual(['extension/package.json', 'extension/themes/a.json']);
        expect(new TextDecoder().decode(entries.get('extension/package.json'))).toBe('{"name":"a"}');
        await expect(readZipEntries(new ArrayBuffer(30), () => true)).rejects.toThrow('Not a zip');
    });

    it('parses search results and drops icon packs', () => {
        const list = parseStoreSearch({ extensions: [ext({ displayName: 'Acme Night', averageRating: 4.5, reviewCount: 3 }), ext({ name: 'material-icon-theme' }), ext({ files: {} })] });
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ id: 'acme.night', displayName: 'Acme Night', downloads: 1200, rating: 4.5, iconUrl: 'https://x/i.png' });
        expect(parseStoreSearch(null)).toEqual([]);
        expect(storeSearchUrl('https://o/api', ' dark ', 30)).toBe('https://o/api/-/search?category=Themes&sortBy=downloadCount&sortOrder=desc&size=30&includeAllVersions=false&query=dark');
    });

    it('resolves manifest theme paths and includes', () => {
        expect(resolvePackagePath('extension/themes/a.json', '../base/b.json')).toBe('extension/base/b.json');
        expect(colorThemesFromManifest({ contributes: { themes: [{ label: 'A', uiTheme: 'vs', path: './themes/a.json' }, { label: 'T', path: './t.tmTheme' }] } }))
            .toEqual([{ label: 'A', uiTheme: 'vs', path: 'extension/themes/a.json' }]);
        const files: Record<string, string> = {
            'extension/themes/a.json': '{ "include": "./base.json", "colors": { "editor.background": "#101010" }, // dark\n "tokenColors": [{ "settings": { "foreground": "#ff0000" } }], }',
            'extension/themes/base.json': '{ "type": "dark", "colors": { "editor.foreground": "#eeeeee", "editor.background": "#000000" }, "tokenColors": "./tokens.json" }',
            'extension/themes/tokens.json': '{ "tokenColors": [{ "settings": { "foreground": "#00ff00" } }] }'
        };
        const json = loadThemeJson('extension/themes/a.json', p => files[p]);
        expect(json.colors).toEqual({ 'editor.foreground': '#eeeeee', 'editor.background': '#101010' });
        expect(json.tokenColors).toHaveLength(2);
        expect(json.include).toBeUndefined();
        expect(() => loadThemeJson('extension/x.json', () => '{ "include": "./x.json" }')).toThrow('nested too deeply');
    });

    it('builds installable themes from a package, skipping unreadable ones', () => {
        const manifest = { contributes: { themes: [{ label: 'Acme Day', uiTheme: 'vs', path: './day.json' }, { label: 'Broken', path: './missing.json' }] } };
        const { themes, skipped } = themesFromPackage(manifest, p => p === 'extension/day.json' ? '{ "type": "light", "colors": {} }' : undefined,
            { extensionId: 'acme.night', version: '1.0.0', publisher: 'acme' });
        expect(themes).toEqual([expect.objectContaining({ id: 'vsx-acme-night-acme-day', label: 'Acme Day', uiTheme: 'vs', source: expect.objectContaining({ extensionId: 'acme.night' }) })]);
        expect(skipped).toEqual(['Broken']);
    });

    it('derives a swatch, groups installed themes and formats counts', () => {
        const swatch = swatchOf({ colors: { 'editor.background': '#282A36', focusBorder: '#BD93F9' }, tokenColors: [{ settings: { foreground: '#ff79c6' } }, { settings: { foreground: 'bad' } }] }, 'vs-dark');
        expect(swatch).toEqual({ background: '#282A36', foreground: '#DFE1E5', accent: '#BD93F9', syntax: ['#FF79C6'] });
        const grouped = groupThemes([{ id: 'b', label: 'Beta', uiTheme: 'vs-dark' }, { id: 'a', label: 'Alpha', uiTheme: 'vs' }, { id: 'h', label: 'High Contrast', uiTheme: 'hc-light' }], '');
        expect(grouped.light.map(t => t.id)).toEqual(['a', 'h']);
        expect(grouped.dark.map(t => t.id)).toEqual(['b']);
        expect(groupThemes([{ id: 'b', label: 'Beta', uiTheme: 'vs-dark' }], 'alp').dark).toEqual([]);
        expect([formatCount(6_551_178), formatCount(12_400), formatCount(1_500), formatCount(42)]).toEqual(['6.6M', '12K', '1.5K', '42']);
    });

    it('IDEA-281: reads installed themes from ~/.ingot/themes.json or the legacy storage value', () => {
        const theme = { id: 'vsx-acme-night', label: 'Acme Night', uiTheme: 'vs-dark', json: { colors: {} }, source: { extensionId: 'acme.night', version: '1.0.0', publisher: 'acme' } };
        expect(parseUserThemes(JSON.stringify([theme, { id: 'broken' }]))).toEqual([theme]);
        expect(parseUserThemes([theme])).toEqual([theme]);
        expect(parseUserThemes('{not json')).toEqual([]);
        expect(parseUserThemes(undefined)).toEqual([]);
    });
});
