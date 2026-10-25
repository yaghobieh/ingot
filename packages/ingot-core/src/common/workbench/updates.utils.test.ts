import { describe, expect, it } from 'vitest';
import { compareVersions, toUpdateCheck } from './updates.utils';

describe('Check for Updates (IDEA-117)', () => {
    it('compares versions numerically, ignoring a v prefix and pre-release suffix', () => {
        expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
        expect(compareVersions('v0.10.0', '0.9.9')).toBeGreaterThan(0);
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('0.2.0-beta.1', 'v0.2.0')).toBe(0);
    });

    it('reports no release, up to date or an available update', () => {
        expect(toUpdateCheck('0.1.0', undefined)).toEqual({ kind: 'no-release', current: '0.1.0' });
        expect(toUpdateCheck('0.1.0', 'v0.1.0')).toEqual({ kind: 'up-to-date', current: '0.1.0', latest: '0.1.0' });
        expect(toUpdateCheck('0.1.0', 'v0.2.0')).toEqual({ kind: 'available', current: '0.1.0', latest: '0.2.0' });
    });
});
