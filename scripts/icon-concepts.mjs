#!/usr/bin/env node
// IDEA-63: generates three app icon concepts (full + simplified small art) into assets/icon-concepts
// and a preview sheet (large, 32 px, 16 px on light and dark). `--pick <id>` copies one concept to
// assets/brand/app-icon*.svg so `npm run brand:app-icon` turns it into the png/ico/icns.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const OUT = 'assets/icon-concepts';
// macOS Big Sur grid: 824 px tile on a 1024 canvas, ~22.5% corner radius.
const TILE = '<rect x="100" y="100" width="824" height="824" rx="186"';

/** Shared defs: navy squircle with forge glow, and the gold palette. */
const defs = ({ bgTop, bgBottom, glow, glowOpacity }) => `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bgTop}"/><stop offset="1" stop-color="${bgBottom}"/></linearGradient>
  <radialGradient id="forge" cx="0.5" cy="0.86" r="0.62"><stop offset="0" stop-color="${glow}" stop-opacity="${glowOpacity}"/><stop offset="0.55" stop-color="${glow}" stop-opacity="${glowOpacity * 0.28}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".18" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF4C7"/><stop offset=".35" stop-color="#FFD66B"/><stop offset=".75" stop-color="#E9A82A"/><stop offset="1" stop-color="#C98512"/></linearGradient>
  <linearGradient id="front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2B437"/><stop offset=".55" stop-color="#C47F14"/><stop offset="1" stop-color="#8E550A"/></linearGradient>
  <linearGradient id="side" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C98516"/><stop offset="1" stop-color="#6B3D06"/></linearGradient>
  <linearGradient id="spec" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
  <clipPath id="sq">${TILE}/></clipPath>`;

const background = small => `
  ${TILE} fill="url(#bg)"/>
  <g clip-path="url(#sq)"><rect x="0" y="0" width="1024" height="1024" fill="url(#forge)"/>${small ? '' : '<rect x="100" y="100" width="824" height="824" fill="url(#rim)"/>'}</g>`;

/** A 3/4 view gold bar. Top face is a parallelogram G-F-E-D; `mark` is drawn in top-face local space (0..360 × 0..100). */
const ingot = ({ dy = 0, mark, small }) => {
    const p = (x, y) => `${x},${y + dy}`;
    const A = p(250, 700), B = p(700, 700), C = p(812, 604), D = p(300, 580), E = p(660, 580), F = p(752, 470), G = p(392, 470);
    // local (x,y) -> G + x*(1,0) + y*(D-G)/100
    const m = `matrix(1 0 -0.92 1.1 392 ${470 + dy})`;
    const scale = small ? 1.4 : 1.18;
    return `<g transform="translate(512 ${small ? 560 : 548}) scale(${scale}) translate(-526 ${-600 - dy})">
  <ellipse cx="530" cy="${730 + dy}" rx="300" ry="34" fill="#000" opacity=".5" filter="url(#shadow)"/>
  <polygon points="${B} ${C} ${F} ${E}" fill="url(#side)"/>
  <polygon points="${A} ${B} ${E} ${D}" fill="url(#front)"/>
  <polygon points="${D} ${E} ${F} ${G}" fill="url(#top)"/>
  ${small ? '' : `<polygon points="${p(318, 574)} ${p(470, 574)} ${p(560, 478)} ${p(408, 478)}" fill="url(#spec)" opacity=".55"/>`}
  <polyline points="${A} ${D} ${G}" fill="none" stroke="#FFE7A0" stroke-opacity=".7" stroke-width="${small ? 6 : 3}" stroke-linejoin="round"/>
  <polyline points="${D} ${E} ${F}" fill="none" stroke="#FFF6D6" stroke-opacity=".9" stroke-width="${small ? 6 : 3}" stroke-linejoin="round"/>
  <polyline points="${E} ${B}" fill="none" stroke="#FFD27A" stroke-opacity=".45" stroke-width="3"/>
  <g transform="${m}">${mark}</g></g>`;
};

/** Debossed strokes: a light lower-right lip and a dark cut, so the mark reads as stamped into the gold. */
const stamp = (d, width) => `
  <path d="${d}" transform="translate(2 3)" fill="none" stroke="#FFF7DA" stroke-opacity=".85" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${d}" fill="none" stroke="#8A560A" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${d}" transform="translate(-1 -1.5)" fill="none" stroke="#5E3804" stroke-opacity=".55" stroke-width="${width * 0.45}" stroke-linecap="round" stroke-linejoin="round"/>`;

const CODE = 'M128 22 L82 50 L128 78 M196 16 L164 84 M232 22 L278 50 L232 78';
const PROMPT = 'M96 22 L144 50 L96 78 M176 80 L262 80';

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><title>Ingot app icon</title>${body}</svg>`;

const conceptA = small => svg(`<defs>${defs({ bgTop: '#1E2E63', bgBottom: '#0A1128', glow: '#FF8A2A', glowOpacity: 0.42 })}</defs>
  ${background(small)}<g clip-path="url(#sq)">${ingot({ dy: 10, small, mark: stamp(CODE, small ? 26 : 16) })}</g>`);

const conceptB = small => svg(`<defs>${defs({ bgTop: '#232A6B', bgBottom: '#0B0F2A', glow: '#FFB347', glowOpacity: 0.34 })}
  <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#9FB4FF" stroke-opacity=".07" stroke-width="2"/></pattern></defs>
  ${background(small)}${small ? '' : '<g clip-path="url(#sq)"><rect x="100" y="100" width="824" height="520" fill="url(#grid)"/></g>'}
  <g clip-path="url(#sq)">${ingot({ dy: 20, small, mark: stamp(PROMPT, small ? 28 : 17) })}</g>
  ${small ? '' : '<rect x="270" y="210" width="16" height="78" rx="3" fill="#7FB0FF" opacity=".0"/>'}`);

/** Molten: front elevation bar with the code mark cut through and glowing like poured metal. */
const conceptC = small => {
    const glowMark = 'M430 470 L370 520 L430 570 M540 455 L484 585 M594 470 L654 520 L594 570';
    return svg(`<defs>${defs({ bgTop: '#18214D', bgBottom: '#070B1C', glow: '#FF6A1A', glowOpacity: 0.55 })}
  <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE08A"/><stop offset=".45" stop-color="#F0AE33"/><stop offset="1" stop-color="#A9650C"/></linearGradient>
  <linearGradient id="lid" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E9A830"/><stop offset=".5" stop-color="#FFF1BE"/><stop offset="1" stop-color="#E9A830"/></linearGradient>
  <filter id="hot" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${small ? 8 : 14}"/></filter></defs>
  ${background(small)}
  <g clip-path="url(#sq)"><ellipse cx="512" cy="742" rx="320" ry="40" fill="#000" opacity=".6" filter="url(#shadow)"/></g>
  <polygon points="222,720 802,720 718,380 306,380" fill="url(#face)"/>
  <polygon points="306,380 718,380 690,340 334,340" fill="url(#lid)"/>
  ${small ? '' : '<polygon points="320,392 470,392 420,700 250,700" fill="url(#spec)" opacity=".28"/>'}
  <polyline points="222,720 306,380 718,380 802,720" fill="none" stroke="#FFF2C4" stroke-opacity=".75" stroke-width="${small ? 7 : 4}" stroke-linejoin="round"/>
  <path d="${glowMark}" fill="none" stroke="#FF7A1A" stroke-width="${small ? 56 : 44}" stroke-linecap="round" stroke-linejoin="round" filter="url(#hot)" opacity=".95"/>
  <path d="${glowMark}" fill="none" stroke="#5A2A03" stroke-width="${small ? 40 : 30}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${glowMark}" fill="none" stroke="#FFD27A" stroke-width="${small ? 22 : 16}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${glowMark}" fill="none" stroke="#FFFBEA" stroke-width="${small ? 9 : 6}" stroke-linecap="round" stroke-linejoin="round"/>
  ${small ? '' : [[300, 300, 5], [742, 268, 4], [690, 210, 3], [352, 236, 3], [810, 330, 3]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFB347" opacity=".7"/>`).join('')}`);
};

export const CONCEPTS = [
    { id: 'a-stamped-code', name: 'A · Stamped &lt;/&gt; on a 3/4 gold bar', art: conceptA },
    { id: 'b-prompt', name: 'B · Prompt ›_ on a blueprint grid', art: conceptB },
    { id: 'c-molten', name: 'C · Molten &lt;/&gt; cut through the bar', art: conceptC }
];

mkdirSync(OUT, { recursive: true });
for (const c of CONCEPTS) {
    writeFileSync(join(OUT, `${c.id}.svg`), c.art(false));
    writeFileSync(join(OUT, `${c.id}-small.svg`), c.art(true));
}

const pick = process.argv.indexOf('--pick');
if (pick > 0) {
    const id = process.argv[pick + 1];
    copyFileSync(join(OUT, `${id}.svg`), 'assets/brand/app-icon.svg');
    copyFileSync(join(OUT, `${id}-small.svg`), 'assets/brand/app-icon-small.svg');
    console.log(`app icon set to concept ${id}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const shot = async (art, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${art.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`);
    return (await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })).toString('base64');
};
const rows = [];
for (const c of CONCEPTS) {
    const big = await shot(c.art(false), 640);
    const s32 = await shot(c.art(true), 32);
    const s16 = await shot(c.art(true), 16);
    const s64 = await shot(c.art(false), 64);
    const img = (b, s) => `<img src="data:image/png;base64,${b}" width="${s}" height="${s}">`;
    rows.push(`<div class="concept"><div class="name">${c.name}</div><div class="cells">
      <div class="big">${img(big, 420)}</div>
      <div class="sm light">${img(s64, 64)}${img(s32, 32)}${img(s16, 16)}</div>
      <div class="sm dark">${img(s64, 64)}${img(s32, 32)}${img(s16, 16)}</div></div></div>`);
}
await page.setViewportSize({ width: 1560, height: 820 });
await page.setContent(`<html><head><style>
body{margin:0;font:15px -apple-system,Inter,sans-serif;background:#ECEEF3;display:flex;gap:0}
.concept{flex:1;padding:28px;border-right:1px solid #d5d8e0}.name{font-weight:600;margin-bottom:14px;color:#222}
.big{display:flex;justify-content:center;padding:10px 0 18px}
.sm{display:flex;align-items:center;justify-content:center;gap:22px;padding:14px;border-radius:10px;margin-top:10px}
.light{background:#F8F9FB}.dark{background:#1C1E24}
</style></head><body>${rows.join('')}</body></html>`);
const sheet = await page.screenshot({ fullPage: true, scale: 'device' });
writeFileSync(join(OUT, 'icon-concepts.png'), sheet);
await browser.close();
console.log('icon concepts written to', OUT);
