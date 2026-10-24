import { describe, expect, it } from 'vitest';
import { canInvite, canManage } from '@server/services/team.utils';

describe('team roles', () => {
    it('lets owners and admins invite', () => {
        expect(canInvite('owner')).toBe(true);
        expect(canInvite('admin')).toBe(true);
        expect(canInvite('member')).toBe(false);
    });
    it('enforces role management rules', () => {
        expect(canManage('owner', 'admin', 'member')).toBe(true);
        expect(canManage('owner', 'member', 'owner')).toBe(false);
        expect(canManage('admin', 'member')).toBe(true);
        expect(canManage('admin', 'member', 'admin')).toBe(false);
        expect(canManage('admin', 'admin')).toBe(false);
        expect(canManage('member', 'member')).toBe(false);
        expect(canManage('owner', 'owner')).toBe(false);
    });
});
