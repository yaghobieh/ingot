import 'server-only';
import { INVITABLE_ROLES } from '@/constants/app.consts';
import type { PublicUser, TeamInfo, TeamRole } from '@/types/domain.types';
import { getConfig } from '@server/config/config';
import { query, queryOne } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail } from '@server/http/http';
import { MAIL_TEMPLATES } from '@server/services/mail.consts';
import { sendMail } from '@server/services/mail.service';
import { isValidEmail } from '@server/services/otp.service';
import { canInvite, canManage } from '@server/services/team.utils';
import { normalizeEmail } from '@server/services/user.service';
import { INVITE_TOKEN_BYTES, INVITE_TTL_DAYS, MS_PER_DAY } from '@server/utils/crypto.consts';
import { randomToken, sha256 } from '@server/utils/crypto.utils';

interface Membership {
    team_id: string;
    name: string;
    role: TeamRole;
}

export function isInvitableRole(value: unknown): value is TeamRole {
    return typeof value === 'string' && (INVITABLE_ROLES as string[]).includes(value);
}

async function membership(userId: string): Promise<Membership | undefined> {
    return queryOne<Membership>(
        'SELECT m.team_id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1',
        [userId]
    );
}

async function requireMembership(userId: string): Promise<Membership> {
    const found = await membership(userId);
    if (!found) { fail(HTTP_STATUS.notFound, 'no_team'); }
    return found;
}

export async function getTeam(userId: string): Promise<TeamInfo | null> {
    const mine = await membership(userId);
    if (!mine) { return null; }
    const members = await query<{ user_id: string; email: string; name: string; role: TeamRole }>(
        `SELECT m.user_id, u.email, u.name, m.role FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email`,
        [mine.team_id]
    );
    const invites = canInvite(mine.role) ? await query<{ id: string; email: string; role: TeamRole; expires_at: Date }>(
        'SELECT id, email, role, expires_at FROM team_invites WHERE team_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC',
        [mine.team_id]
    ) : [];
    return {
        id: mine.team_id,
        name: mine.name,
        myRole: mine.role,
        members: members.map(row => ({ userId: row.user_id, email: row.email, name: row.name, role: row.role })),
        invites: invites.map(row => ({ id: row.id, email: row.email, role: row.role, expiresAt: row.expires_at.toISOString() }))
    };
}

export async function createTeam(userId: string, name: string): Promise<TeamInfo | null> {
    if (await membership(userId)) { fail(HTTP_STATUS.conflict, 'already_in_team'); }
    const team = await queryOne<{ id: string }>('INSERT INTO teams (name) VALUES ($1) RETURNING id', [name]);
    await query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [team?.id, userId, 'owner']);
    return getTeam(userId);
}

/** Creates an invite, emails the link, and returns the link (so admins can also share it directly). */
export async function inviteMember(actor: PublicUser, rawEmail: string, role: TeamRole): Promise<{ link: string }> {
    const mine = await requireMembership(actor.id);
    if (!canInvite(mine.role) || (role === 'admin' && mine.role !== 'owner')) { fail(HTTP_STATUS.forbidden, 'forbidden'); }
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) { fail(HTTP_STATUS.badRequest, 'invalid_email'); }
    const existing = await queryOne('SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 AND u.email = $2', [mine.team_id, email]);
    if (existing) { fail(HTTP_STATUS.conflict, 'already_member'); }
    const token = randomToken(INVITE_TOKEN_BYTES);
    await query(
        'INSERT INTO team_invites (team_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [mine.team_id, email, role, sha256(token), actor.id, new Date(Date.now() + INVITE_TTL_DAYS * MS_PER_DAY)]
    );
    const link = `${getConfig().appUrl}/invite/${token}`;
    await sendMail({ to: email, ...MAIL_TEMPLATES.invite(mine.name, actor.name || actor.email, link) });
    return { link };
}

export async function inviteDetails(token: string): Promise<{ teamName: string; email: string; role: TeamRole } | undefined> {
    return queryOne<{ teamName: string; email: string; role: TeamRole }>(
        'SELECT t.name AS "teamName", i.email, i.role FROM team_invites i JOIN teams t ON t.id = i.team_id WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()',
        [sha256(token)]
    );
}

export async function acceptInvite(user: PublicUser, token: string): Promise<void> {
    const invite = await queryOne<{ id: string; team_id: string; email: string; role: TeamRole }>(
        'SELECT id, team_id, email, role FROM team_invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()',
        [sha256(token)]
    );
    if (!invite) { fail(HTTP_STATUS.gone, 'invite_invalid'); }
    if (invite.email !== user.email) { fail(HTTP_STATUS.forbidden, 'invite_email_mismatch'); }
    if (await membership(user.id)) { fail(HTTP_STATUS.conflict, 'already_in_team'); }
    await query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)', [invite.team_id, user.id, invite.role]);
    await query('UPDATE team_invites SET accepted_at = now() WHERE id = $1', [invite.id]);
}

async function targetRole(teamId: string, userId: string): Promise<TeamRole> {
    const row = await queryOne<{ role: TeamRole }>('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
    if (!row) { fail(HTTP_STATUS.notFound, 'member_not_found'); }
    return row.role;
}

export async function changeRole(actorId: string, memberId: string, role: TeamRole): Promise<void> {
    const mine = await requireMembership(actorId);
    if (!canManage(mine.role, await targetRole(mine.team_id, memberId), role)) { fail(HTTP_STATUS.forbidden, 'forbidden'); }
    await query('UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2', [mine.team_id, memberId, role]);
}

export async function removeMember(actorId: string, memberId: string): Promise<void> {
    const mine = await requireMembership(actorId);
    if (!canManage(mine.role, await targetRole(mine.team_id, memberId))) { fail(HTTP_STATUS.forbidden, 'forbidden'); }
    await query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [mine.team_id, memberId]);
}

export async function revokeInvite(actorId: string, inviteId: string): Promise<void> {
    const mine = await requireMembership(actorId);
    if (!canInvite(mine.role)) { fail(HTTP_STATUS.forbidden, 'forbidden'); }
    await query('DELETE FROM team_invites WHERE id = $1 AND team_id = $2', [inviteId, mine.team_id]);
}
