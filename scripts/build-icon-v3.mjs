#!/usr/bin/env node
// IDEA-63 v3: writes the static </> master (assets/brand/app-icon*.svg), the Dock launch animation frames
// (packages/ingot-core/resources/dock-anim/frame-NN.png) and preview frames + sheet for review.
// Then run `npm run brand:app-icon` for the png/ico/icns.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { markSvg } from './icon-mark.mjs';

const FRAMES = 30; // 1.5 s at 20 fps
const DOCK_DIR = 'packages/ingot-core/resources/dock-anim';
const PREVIEW_DIR = process.env.INGOT_ICON_PREVIEW_DIR ?? 'assets/icon-concepts/v3-preview';

writeFileSync('assets/brand/app-icon.svg', markSvg(1));
writeFileSync('assets/brand/app-icon-small.svg', markSvg(1, { small: true }));
writeFileSync('assets/icon-concepts/d-mark.svg', markSvg(1));
writeFileSync('assets/icon-concepts/d-mark-small.svg', markSvg(1, { small: true }));

const browser = await chromium.launch();
const page = await browser.newPage();
const shot = async (svg, size, bg) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:${bg ?? 'transparent'}">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`);
    return page.screenshot({ omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
};

rmSync(DOCK_DIR, { recursive: true, force: true });
mkdirSync(DOCK_DIR, { recursive: true });
rmSync(PREVIEW_DIR, { recursive: true, force: true });
mkdirSync(PREVIEW_DIR, { recursive: true });
for (let i = 0; i < FRAMES; i++) {
    const t = i / (FRAMES - 1);
    const name = `frame-${String(i).padStart(2, '0')}.png`;
    writeFileSync(join(DOCK_DIR, name), await shot(markSvg(t), 256));
    writeFileSync(join(PREVIEW_DIR, `light-${name}`), await shot(markSvg(t), 360, '#F2F3F6'));
    writeFileSync(join(PREVIEW_DIR, `dark-${name}`), await shot(markSvg(t), 360, '#1B2647'));
}

// Static sheet: 512/128/32/16 on light and dark.
const b64 = async (size, small) => (await shot(markSvg(1, { small }), size)).toString('base64');
const sizes = [[512, false], [128, false], [32, true], [16, true]];
const cellList = [];
for (const [s, small] of sizes) {
    // Sequential: the renders share one page.
    cellList.push(`<div class="c"><img src="data:image/png;base64,${await b64(s, small)}" width="${s}" height="${s}"><span>${s}px</span></div>`);
}
const cells = cellList.join('');
await page.setViewportSize({ width: 1100, height: 600 });
await page.setContent(`<html><head><style>body{margin:0;font:14px -apple-system,Inter,sans-serif}
.row{display:flex;align-items:flex-end;gap:48px;padding:36px 48px}.light{background:#F2F3F6;color:#333}.dark{background:#1C1E24;color:#bbb}
.c{display:flex;flex-direction:column;align-items:center;gap:10px}</style></head>
<body><div class="row light">${cells}</div><div class="row dark">${cells}</div></body></html>`);
writeFileSync(join(PREVIEW_DIR, 'icon-v3-preview.png'), await page.screenshot({ fullPage: true }));
await browser.close();
console.log(`icon v3: master svg, ${FRAMES} Dock frames and preview in ${PREVIEW_DIR}`);
