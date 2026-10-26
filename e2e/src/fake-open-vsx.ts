import { deflateRawSync } from 'zlib';
import type { Page } from '@playwright/test';

/** IDEA-144: a mocked Open VSX (search + .vsix download) served through Playwright routing - no network. */

const zip = (files: Record<string, string>): Buffer => {
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
    return Buffer.concat([...local, cd, end]);
};

export const FAKE_THEME = {
    id: 'acme.night-owlish',
    displayName: 'Acme Nightfall',
    themeLabel: 'Acme Nightfall',
    themeId: 'vsx-acme-night-owlish-acme-nightfall',
    background: '#0b1d2e'
} as const;

const DOWNLOAD = 'https://open-vsx.org/api/acme/night-owlish/1.2.0/file/acme.night-owlish-1.2.0.vsix';
const ICON = 'https://open-vsx.org/api/acme/night-owlish/1.2.0/file/icon.png';
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const vsix = (): Buffer => zip({
    'extension/package.json': JSON.stringify({
        name: 'night-owlish', publisher: 'acme', version: '1.2.0',
        contributes: { themes: [{ label: FAKE_THEME.themeLabel, uiTheme: 'vs-dark', path: './themes/nightfall.json' }] }
    }),
    'extension/themes/base.json': '{ "type": "dark", "colors": { "editor.foreground": "#d6deeb" } }',
    'extension/themes/nightfall.json': `{
        // JSONC with an include, like many store themes
        "name": "Acme Nightfall", "include": "./base.json",
        "colors": { "editor.background": "${FAKE_THEME.background}", "focusBorder": "#7e57c2", },
        "tokenColors": [{ "scope": "keyword", "settings": { "foreground": "#c792ea" } }, { "scope": "string", "settings": { "foreground": "#ecc48d" } }]
    }`
});

const search = {
    totalSize: 2,
    extensions: [
        { namespace: 'acme', name: 'night-owlish', displayName: FAKE_THEME.displayName, description: 'A calm night theme', version: '1.2.0',
            downloadCount: 12_400, averageRating: 4.6, reviewCount: 9, files: { download: DOWNLOAD, icon: ICON } },
        { namespace: 'acme', name: 'acme-icons', displayName: 'Acme Icons', version: '1.0.0', downloadCount: 900, files: { download: DOWNLOAD } }
    ]
};

/** Routes Open VSX requests of this page to the fake; returns the count of .vsix downloads. */
export async function mockOpenVsx(page: Page): Promise<{ downloads: () => number }> {
    let downloads = 0;
    await page.route('https://open-vsx.org/**', route => {
        const url = route.request().url();
        if (url.includes('/-/search')) {
            return route.fulfill({ json: search, headers: { 'access-control-allow-origin': '*' } });
        }
        if (url === DOWNLOAD) {
            downloads++;
            return route.fulfill({ body: vsix(), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
        }
        if (url === ICON) {
            return route.fulfill({ body: PNG, contentType: 'image/png' });
        }
        return route.fulfill({ status: 404, body: 'not mocked' });
    });
    return { downloads: () => downloads };
}
