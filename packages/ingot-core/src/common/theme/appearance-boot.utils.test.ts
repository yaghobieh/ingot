import { describe, expect, it } from 'vitest';
import { parseBoot, serializeBoot, themeKind } from './appearance-boot.utils';

describe('appearance boot cache', () => {
    it('round-trips the last applied theme', () => {
        const boot = { themeId: 'ingot-dark', kind: 'dark' as const };
        expect(parseBoot(serializeBoot(boot))).toEqual(boot);
    });

    it('ignores a missing, broken or foreign cache', () => {
        expect(parseBoot(null)).toBeUndefined();
        expect(parseBoot('')).toBeUndefined();
        expect(parseBoot('{not json')).toBeUndefined();
        expect(parseBoot(JSON.stringify({ themeId: 'x', kind: 'sepia' }))).toBeUndefined();
        expect(parseBoot(JSON.stringify({ kind: 'dark' }))).toBeUndefined();
    });

    it('maps Theia theme types to the light or dark token palette', () => {
        expect(themeKind('light')).toBe('light');
        expect(themeKind('hcLight')).toBe('light');
        expect(themeKind('dark')).toBe('dark');
        expect(themeKind('hc')).toBe('dark');
    });
});
