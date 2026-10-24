import type { TeamRole } from '@/types/domain.types';

const RANK: Record<TeamRole, number> = { owner: 3, admin: 2, member: 1 };

export function canInvite(role: TeamRole): boolean {
    return RANK[role] >= RANK.admin;
}

/** Owners manage everyone; admins manage members only; nobody can grant ownership here. */
export function canManage(actor: TeamRole, target: TeamRole, nextRole?: TeamRole): boolean {
    if (nextRole === 'owner' || target === 'owner') { return false; }
    if (actor === 'owner') { return true; }
    return actor === 'admin' && target === 'member' && (nextRole === undefined || nextRole === 'member');
}
