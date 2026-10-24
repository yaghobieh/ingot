import * as http from 'http';
import { crc32 } from 'zlib';
import { E2E_OVSX_PORT } from './e2e.consts';

interface FakeExtension {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly displayName: string;
    readonly description: string;
    readonly files: Record<string, string>;
}

export interface FakeOpenVsx {
    readonly url: string;
    readonly searches: string[];
    readonly downloads: string[];
    close(): Promise<void>;
}

/** Minimal ZIP writer (stored entries), enough for a .vsix. */
export const zip = (files: Record<string, string>): Buffer => {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
        const data = Buffer.from(text);
        const fileName = Buffer.from(name);
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(local, fileName, data);
        centrals.push(central, fileName);
        offset += local.length + fileName.length + data.length;
    }
    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
};

const themeExtension = (name: string, displayName: string, themeLabel: string, background: string): FakeExtension => ({
    namespace: 'ingot-e2e', name, version: '1.0.0', displayName, description: `${displayName}: a color theme served by the fake Open VSX registry.`,
    files: {
        'extension.vsixmanifest': `<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${name}" Version="1.0.0" Publisher="ingot-e2e"/><DisplayName>${displayName}</DisplayName></Metadata></PackageManifest>`,
        '[Content_Types].xml': '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/></Types>',
        'extension/package.json': JSON.stringify({
            name, publisher: 'ingot-e2e', version: '1.0.0', displayName, engines: { vscode: '^1.50.0' }, categories: ['Themes'],
            contributes: { themes: [{ label: themeLabel, uiTheme: 'vs-dark', path: './themes/theme.json' }] }
        }),
        'extension/themes/theme.json': JSON.stringify({ name: themeLabel, type: 'dark', colors: { 'editor.background': background }, tokenColors: [] })
    }
});

export const FAKE_EXTENSIONS: readonly FakeExtension[] = [
    themeExtension('midnight-gold', 'Midnight Gold Theme', 'Midnight Gold', '#14110A'),
    themeExtension('harbor-blue', 'Harbor Blue Theme', 'Harbor Blue', '#0B1E33')
];

/** Local stand-in for open-vsx.org (`VSX_REGISTRY_URL`): search, query and .vsix downloads. */
export const startFakeOpenVsx = async (): Promise<FakeOpenVsx> => {
    const base = `http://127.0.0.1:${E2E_OVSX_PORT}`;
    const searches: string[] = [];
    const downloads: string[] = [];
    const download = (e: FakeExtension) => `${base}/files/${e.namespace}.${e.name}-${e.version}.vsix`;
    const entry = (e: FakeExtension) => ({
        url: `${base}/api/${e.namespace}/${e.name}`, name: e.name, namespace: e.namespace, version: e.version, timestamp: '2026-10-01T00:00:00Z',
        downloadCount: 12_345, averageRating: 4.5, displayName: e.displayName, description: e.description,
        files: { download: download(e) }, allVersions: [{ url: `${base}/api/${e.namespace}/${e.name}/${e.version}`, version: e.version, engines: { vscode: '^1.50.0' } }]
    });
    const raw = (e: FakeExtension) => ({
        ...entry(e), namespaceUrl: `${base}/api/${e.namespace}`, reviewsUrl: `${base}/api/${e.namespace}/${e.name}/reviews`, publishedBy: { loginName: 'ingot' },
        preRelease: false, namespaceAccess: 'public', allVersions: { [e.version]: `${base}/api/${e.namespace}/${e.name}/${e.version}` },
        reviewCount: 0, namespaceDisplayName: e.namespace, verified: true, engines: { vscode: '^1.50.0' }, categories: ['Themes']
    });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', base);
        const json = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (url.pathname === '/api/-/search') {
            const query = (url.searchParams.get('query') ?? '').toLowerCase();
            searches.push(query);
            const hits = FAKE_EXTENSIONS.filter(e => `${e.name} ${e.displayName} ${e.description}`.toLowerCase().includes(query));
            return json({ offset: 0, extensions: hits.map(entry) });
        }
        if (url.pathname === '/api/v2/-/query') {
            const id = (url.searchParams.get('extensionId') ?? '').toLowerCase();
            const hits = FAKE_EXTENSIONS.filter(e => `${e.namespace}.${e.name}` === id);
            return json({ offset: 0, totalSize: hits.length, extensions: hits.map(raw) });
        }
        const file = FAKE_EXTENSIONS.find(e => url.pathname === new URL(download(e)).pathname);
        if (file) {
            downloads.push(file.name);
            res.writeHead(200, { 'content-type': 'application/octet-stream' });
            return res.end(zip(file.files));
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>(resolve => server.listen(E2E_OVSX_PORT, '127.0.0.1', resolve));
    return { url: base, searches, downloads, close: () => new Promise(resolve => server.close(() => resolve())) };
};
