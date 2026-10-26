import { describe, expect, it } from 'vitest';
import {
    findImageRefAt, fitZoom, formatBytes, formatZoom, imageCandidates, imageMimeType, isImagePath, isSvgPath, looksLikeImagePath, nextZoom, toDataUrl
} from './image-preview.utils';

describe('IDEA-145 image preview utils', () => {
    it('knows image files and their types', () => {
        for (const ext of ['png', 'JPG', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']) {
            expect(isImagePath(`a/b.${ext}`)).toBe(true);
        }
        expect(isImagePath('a.ts')).toBe(false);
        expect(isImagePath('logo.png?v=2')).toBe(true);
        expect(isSvgPath('x.SVG')).toBe(true);
        expect(imageMimeType('x.jpg')).toBe('image/jpeg');
    });

    it('zooms in steps, fits without enlarging, formats sizes', () => {
        expect(nextZoom(1, 1)).toBe(1.25);
        expect(nextZoom(1, -1)).toBe(0.9);
        expect(nextZoom(0.42, 1)).toBe(0.5);
        expect(nextZoom(8, 1)).toBe(8);
        expect(nextZoom(0.1, -1)).toBe(0.1);
        expect(fitZoom(4000, 2000, 1000, 800)).toBe(0.25);
        expect(fitZoom(100, 100, 1000, 800)).toBe(1);
        expect(formatZoom(0.333)).toBe('33%');
        expect([formatBytes(512), formatBytes(2048), formatBytes(1536), formatBytes(5 * 1024 * 1024)]).toEqual(['512 B', '2 KB', '1.5 KB', '5 MB']);
    });

    it('finds the image path under the cursor', () => {
        const line = `import logo from './assets/logo.png'; const bg = "url(img/bg.webp)";`;
        expect(findImageRefAt(line, line.indexOf('logo.png'))).toEqual({ path: './assets/logo.png', start: line.indexOf('./assets'), end: line.indexOf("';") });
        expect(findImageRefAt(line, line.indexOf('bg.webp'))?.path).toBe('img/bg.webp');
        expect(findImageRefAt(line, 2)).toBeUndefined();
        expect(findImageRefAt('![Logo](docs/shot.svg)', 10)?.path).toBe('docs/shot.svg');
        expect(looksLikeImagePath('assets/logo.png')).toBe(true);
        expect(looksLikeImagePath('https://x.dev/a.png')).toBe(false);
        expect(looksLikeImagePath('a b.png')).toBe(false);
    });

    it('resolves candidates relative to the file and the workspace roots', () => {
        expect(imageCandidates('./assets/logo.png', '/w/src', ['/w'])).toEqual(['/w/src/assets/logo.png', '/w/assets/logo.png']);
        expect(imageCandidates('/logo.png', '/w/src', ['/w'])).toEqual(['/logo.png', '/w/logo.png', '/w/public/logo.png', '/w/static/logo.png']);
        expect(imageCandidates('@/img/a.svg', undefined, ['/w'])).toEqual(['/w/src/img/a.svg']);
        expect(imageCandidates('../img/a.png', '/w/src/app', [])).toEqual(['/w/src/img/a.png']);
    });

    it('encodes data urls', () => {
        expect(toDataUrl(new TextEncoder().encode('<svg/>'), 'image/svg+xml')).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    });
});
