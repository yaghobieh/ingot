#!/usr/bin/env node
// Renders assets/brand/app-icon.svg (and the simplified app-icon-small.svg for 16-32 px) to the
// macOS .icns, Windows .ico and Linux 1024 png, plus a preview sheet. Uses Playwright's Chromium
// for crisp SVG rasterisation and macOS `iconutil` for the .icns (skipped elsewhere).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const BRAND = 'assets/brand';
const FULL = readFileSync(join(BRAND, 'app-icon.svg'), 'utf8');
const SMALL = readFileSync(join(BRAND, 'app-icon-small.svg'), 'utf8');
const svgFor = size => (size <= 32 ? SMALL : FULL);

const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (svg, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`);
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};

const pngs = new Map();
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    pngs.set(size, await render(svgFor(size), size));
}
writeFileSync(join(BRAND, 'app-icon-1024.png'), pngs.get(1024));
// The running app's Dock / window icon (ingot-electron-main-contribution) - same art as the bundle icon.
writeFileSync('packages/ingot-core/resources/app-icon.png', pngs.get(1024));

// Windows .ico: PNG-compressed entries (16-256).
const icoSizes = [16, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((size, i) => {
    const data = pngs.get(size);
    const e = 6 + 16 * i;
    header.writeUInt8(size === 256 ? 0 : size, e); header.writeUInt8(size === 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += data.length;
});
writeFileSync(join(BRAND, 'app-icon.ico'), Buffer.concat([header, ...icoSizes.map(s => pngs.get(s))]));

// Linux hicolor set (IDEA-171): electron-builder installs every <size>x<size>.png of this folder into
// /usr/share/icons/hicolor/<size>x<size>/apps (deb) and the AppImage, so menus and docks get a crisp icon.
const LINUX_DIR = join(BRAND, 'linux');
rmSync(LINUX_DIR, { recursive: true, force: true });
mkdirSync(LINUX_DIR);
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    writeFileSync(join(LINUX_DIR, `${size}x${size}.png`), pngs.get(size) ?? await render(svgFor(size), size));
}

// macOS .icns via an .iconset (16@1x … 512@2x).
if (process.platform === 'darwin') {
    const set = join(tmpdir(), 'ingot.iconset');
    rmSync(set, { recursive: true, force: true });
    mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
        writeFileSync(join(set, `icon_${s}x${s}.png`), pngs.get(s));
        writeFileSync(join(set, `icon_${s}x${s}@2x.png`), pngs.get(s * 2) ?? await render(FULL, s * 2));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', join(BRAND, 'app-icon.icns')]);
}

// Preview sheet: every size on a light and a dark Dock-like strip.
const cells = [16, 32, 64, 128, 256, 512].map(s => `<div class="c"><img src="data:image/png;base64,${pngs.get(s).toString('base64')}" width="${s}" height="${s}"><span>${s}px</span></div>`).join('');
const big = `<img src="data:image/png;base64,${pngs.get(1024).toString('base64')}" width="360" height="360">`;
await page.setViewportSize({ width: 1600, height: 1000 });
await page.setContent(`<html><head><style>
body{margin:0;font:14px -apple-system,Inter,sans-serif}
.row{display:flex;align-items:flex-end;gap:36px;padding:36px 48px}
.light{background:#F2F3F6;color:#333}.dark{background:#1C1E24;color:#bbb}
.c{display:flex;flex-direction:column;align-items:center;gap:8px}
.hero{display:flex}.hero div{flex:1;display:flex;justify-content:center;padding:32px}
</style></head><body><div class="hero"><div class="light">${big}</div><div class="dark">${big}</div></div><div class="row light">${cells}</div><div class="row dark">${cells}</div></body></html>`);
writeFileSync(join(BRAND, 'app-icon-preview.png'), await page.screenshot({ fullPage: true }));
await browser.close();
console.log('app icon: wrote png, linux set, ico' + (process.platform === 'darwin' ? ', icns' : '') + ' and preview');
