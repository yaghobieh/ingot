import { describe, expect, it } from 'vitest';
import {
    formatMatches, formatScale, isMarkdownPath, isPdfPath, isWorkspaceTarget, lineForTop, nextPdfScale, normalizeAnchors, parsePageInput, topForLine
} from './document-preview.utils';

describe('IDEA-146 document preview utils', () => {
    it('knows Markdown and PDF files', () => {
        expect(isMarkdownPath('README.md')).toBe(true);
        expect(isMarkdownPath('docs/a.MARKDOWN')).toBe(true);
        expect(isMarkdownPath('a.mdx')).toBe(true);
        expect(isMarkdownPath('a.txt')).toBe(false);
        expect(isPdfPath('spec.PDF')).toBe(true);
        expect(isPdfPath('spec.pdf.md')).toBe(false);
    });

    it('maps source lines to preview offsets and back', () => {
        const anchors = normalizeAnchors([{ line: 10, top: 400 }, { line: 0, top: 0 }, { line: 4, top: 100 }, { line: 5, top: 90 }, { line: 4, top: 120 }]);
        expect(anchors).toEqual([{ line: 0, top: 0 }, { line: 4, top: 100 }, { line: 10, top: 400 }]);
        expect(topForLine(anchors, 2, 1000, 20)).toBe(50);
        expect(topForLine(anchors, 7, 1000, 20)).toBe(250);
        expect(topForLine(anchors, 15, 1000, 20)).toBe(700);
        expect(topForLine(anchors, 40, 1000, 20)).toBe(1000);
        for (const line of [0, 2, 4, 7, 10, 15]) {
            expect(lineForTop(anchors, topForLine(anchors, line, 1000, 20), 1000, 20)).toBeCloseTo(line);
        }
        expect(topForLine([], 3, 100, 10)).toBe(0);
        expect(lineForTop([{ line: 3, top: 60 }], 30, 100, 10)).toBe(1.5);
    });

    it('zooms PDFs in steps and reads page numbers', () => {
        expect(nextPdfScale(1, 1)).toBe(1.25);
        expect(nextPdfScale(1, -1)).toBe(0.75);
        expect(nextPdfScale(1.1, 1)).toBe(1.25);
        expect(nextPdfScale(5, 1)).toBe(5);
        expect(nextPdfScale(0.25, -1)).toBe(0.25);
        expect(parsePageInput(' 3 ', 10)).toBe(3);
        expect(parsePageInput('99', 10)).toBe(10);
        expect(parsePageInput('0', 10)).toBe(1);
        expect(parsePageInput('x', 10)).toBeUndefined();
        expect(formatScale(1.254)).toBe('125%');
        expect(formatMatches(2, 12)).toBe('2 of 12');
        expect(formatMatches(0, 0)).toBe('No results');
    });

    it('tells workspace links from web links and anchors', () => {
        expect(isWorkspaceTarget('img/a.png')).toBe(true);
        expect(isWorkspaceTarget('../docs/guide.md#setup')).toBe(true);
        expect(isWorkspaceTarget('https://x.dev/a.png')).toBe(false);
        expect(isWorkspaceTarget('data:image/png;base64,AA')).toBe(false);
        expect(isWorkspaceTarget('#intro')).toBe(false);
        expect(isWorkspaceTarget('//cdn.x/a.png')).toBe(false);
    });
});
