import { describe, expect, it } from 'vitest';
import { formatAboutText, formatWindowTitle } from './product.utils';

describe('formatWindowTitle', () => {
    it('joins workspace, file and product name', () => {
        expect(formatWindowTitle({ workspace: 'alloy', file: 'index.ts' })).toBe('alloy — index.ts — Ingot');
    });

    it('skips empty parts', () => {
        expect(formatWindowTitle({ workspace: '', file: undefined })).toBe('Ingot');
    });
});

describe('formatAboutText', () => {
    it('includes the version and license', () => {
        expect(formatAboutText()).toBe('Ingot 0.1.0 · Apache-2.0');
    });
});
