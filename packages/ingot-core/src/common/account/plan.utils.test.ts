import { describe, expect, it } from 'vitest';
import { isAdminUser, isProPlusPlan, normalizePlan } from './plan.utils';

describe('account plan', () => {
    it('normalizes the spellings ingot-server uses', () => {
        expect(normalizePlan(' Pro Plus ')).toBe('proplus');
        expect(normalizePlan('PRO_PLUS')).toBe('proplus');
        expect(normalizePlan(undefined)).toBe('');
    });
    it('only PRO+ unlocks the Rex app', () => {
        for (const plan of ['pro+', 'PRO+', 'pro_plus', 'pro-plus', 'Pro Plus', 'proplus']) {
            expect(isProPlusPlan(plan)).toBe(true);
        }
        for (const plan of ['free', 'pro', 'Pro', 'team', 'pro++', '', undefined]) {
            expect(isProPlusPlan(plan)).toBe(false);
        }
    });
    it('treats the admin role and owner accounts as admin', () => {
        expect(isAdminUser({ email: 'someone@ingot.dev', role: 'admin' })).toBe(true);
        expect(isAdminUser({ email: ' YAGHOBIEH@gmail.com ' })).toBe(true);
        expect(isAdminUser({ email: 'someone@ingot.dev', role: 'user' })).toBe(false);
        expect(isAdminUser(undefined)).toBe(false);
    });
});
