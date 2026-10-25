import { describe, expect, it } from 'vitest';
import { chipLabel, chipPreview, COMPOSER_MIN_HEIGHT, composerHeight, expandWithChips, lineCount, sameClipboardText } from './context-chips';

const chip = { id: '1', path: 'scripts/dev-db.mjs', uri: 'file:///p/scripts/dev-db.mjs', start: 25, end: 28, text: 'a\nb\nc\nd\n' };

describe('context chips', () => {
    it('labels with file name and line range', () => {
        expect(chipLabel(chip)).toBe('dev-db.mjs (25-28)');
        expect(chipLabel({ ...chip, end: 25 })).toBe('dev-db.mjs (25)');
    });

    it('compares clipboard text across line endings and counts lines', () => {
        expect(sameClipboardText('a\r\nb\r\n', 'a\nb')).toBe(true);
        expect(sameClipboardText('a\nb', 'a\nc')).toBe(false);
        expect(lineCount('a\nb\n')).toBe(2);
    });

    it('previews the first lines and expands the prompt with fenced snippets', () => {
        expect(chipPreview('1\n2\n3', 2)).toBe('1\n2\n…');
        expect(expandWithChips('Why?', [chip])).toBe('Why?\n\nSelected code from scripts/dev-db.mjs (lines 25-28):\n```\na\nb\nc\nd\n```');
        expect(expandWithChips('Why?', [])).toBe('Why?');
    });

    it('sizes the composer: min 4 lines, grows to half the panel, manual drag wins', () => {
        expect(composerHeight(10, 800)).toBe(COMPOSER_MIN_HEIGHT);
        expect(composerHeight(300, 800)).toBe(300);
        expect(composerHeight(900, 800)).toBe(400);
        expect(composerHeight(10, 800, 500)).toBe(500);
        expect(composerHeight(10, 800, 2000)).toBe(640);
    });
});
