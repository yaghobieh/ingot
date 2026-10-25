import { describe, expect, it } from 'vitest';
import { accountInitials, parseAccount } from './account.utils';

describe('account (IDEA-92)', () => {
    it('makes avatar initials', () => {
        expect(accountInitials({ name: 'John Yaghobieh' })).toBe('JY');
        expect(accountInitials({ name: 'zan' })).toBe('Z');
        expect(accountInitials({ name: ' ', email: 'a@b.c' })).toBe('A');
    });
    it('parses the stored account', () => {
        expect(parseAccount('{"name":"Zan","email":"z@x.dev"}')).toEqual({ name: 'Zan', email: 'z@x.dev' });
        expect(parseAccount('{"name":""}')).toBeUndefined();
        expect(parseAccount('nope')).toBeUndefined();
        expect(parseAccount(null)).toBeUndefined();
    });
});
