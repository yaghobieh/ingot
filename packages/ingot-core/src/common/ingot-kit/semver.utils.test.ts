import { describe, expect, it } from 'vitest';
import { compareSemver, defaultRangeFor, isValidRange, maxSatisfying, parseRange, satisfies } from './semver.utils';

const VERSIONS = ['1.0.0', '1.4.2', '2.0.0', '2.1.0', '2.3.1', '3.0.0-beta.1', '3.0.0'];

describe('semver ranges', () => {
    it('resolves caret, tilde, x and partial ranges to the highest allowed version', () => {
        expect(maxSatisfying(VERSIONS, '^2')).toBe('2.3.1');
        expect(maxSatisfying(VERSIONS, '^2.1')).toBe('2.3.1');
        expect(maxSatisfying(VERSIONS, '~2.1')).toBe('2.1.0');
        expect(maxSatisfying(VERSIONS, '2.x')).toBe('2.3.1');
        expect(maxSatisfying(VERSIONS, '1')).toBe('1.4.2');
        expect(maxSatisfying(VERSIONS, 'latest')).toBe('3.0.0');
        expect(maxSatisfying(VERSIONS, '*')).toBe('3.0.0');
        expect(maxSatisfying(VERSIONS, '>=1.2 <2')).toBe('1.4.2');
        expect(maxSatisfying(VERSIONS, '1.0.0 - 2.1')).toBe('2.1.0');
        expect(maxSatisfying(VERSIONS, '^1 || ^3')).toBe('3.0.0');
        expect(maxSatisfying(VERSIONS, '^4')).toBeUndefined();
    });

    it('handles 0.x carets and exact versions', () => {
        expect(satisfies('0.2.5', '^0.2.1')).toBe(true);
        expect(satisfies('0.3.0', '^0.2.1')).toBe(false);
        expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
        expect(satisfies('2.1.0', '2.1.0')).toBe(true);
        expect(satisfies('2.1.1', '=2.1.0')).toBe(false);
    });

    it('only matches prereleases a bound names', () => {
        expect(satisfies('3.0.0-beta.1', '^3')).toBe(false);
        expect(satisfies('3.0.0-beta.2', '^3.0.0-beta.1')).toBe(true);
    });

    it('rejects ranges it cannot read and orders versions', () => {
        expect(isValidRange('^two')).toBe(false);
        expect(parseRange('>=')).toBeUndefined();
        expect(compareSemver('1.0.0-beta', '1.0.0')).toBeLessThan(0);
        expect(defaultRangeFor('2.3.1')).toBe('^2.3.1');
        expect(defaultRangeFor('3.0.0-beta.1')).toBe('3.0.0-beta.1');
    });
});
