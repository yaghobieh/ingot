import 'server-only';
import { TEAM_ROLES } from '@/constants/app.consts';
import type { TeamRole } from '@/types/domain.types';
import { authed } from '@server/http/auth';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail, json, readJson, requireString } from '@server/http/http';
import type { RouteContext } from '@server/http/http.types';
import { acceptInvite, changeRole, createTeam, getTeam, inviteMember, isInvitableRole, removeMember, revokeInvite } from '@server/services/team.service';

const MAX_TEAM_NAME = 80;

async function idParam(context: RouteContext): Promise<string> {
    const { id } = await (context as RouteContext<{ id: string }>).params;
    return id;
}

export const readTeam = authed(async (_request, user) => json({ team: await getTeam(user.id) }));

export const newTeam = authed(async (request, user) => {
    const body = await readJson<{ name?: string }>(request);
    return json({ team: await createTeam(user.id, requireString(body.name, 'name_required', MAX_TEAM_NAME)) }, HTTP_STATUS.created);
});

export const invite = authed(async (request, user) => {
    const body = await readJson<{ email?: string; role?: unknown }>(request);
    if (!isInvitableRole(body.role)) { fail(HTTP_STATUS.badRequest, 'invalid_role'); }
    const result = await inviteMember(user, requireString(body.email, 'invalid_email'), body.role);
    return json({ ...result, team: await getTeam(user.id) }, HTTP_STATUS.created);
});

export const cancelInvite = authed(async (_request, user, context) => {
    await revokeInvite(user.id, await idParam(context));
    return json({ team: await getTeam(user.id) });
});

export const accept = authed(async (request, user) => {
    const body = await readJson<{ token?: string }>(request);
    await acceptInvite(user, requireString(body.token, 'invite_invalid'));
    return json({ team: await getTeam(user.id) });
});

export const updateMember = authed(async (request, user, context) => {
    const body = await readJson<{ role?: unknown }>(request);
    if (typeof body.role !== 'string' || !(TEAM_ROLES as string[]).includes(body.role)) { fail(HTTP_STATUS.badRequest, 'invalid_role'); }
    await changeRole(user.id, await idParam(context), body.role as TeamRole);
    return json({ team: await getTeam(user.id) });
});

export const deleteMember = authed(async (_request, user, context) => {
    await removeMember(user.id, await idParam(context));
    return json({ team: await getTeam(user.id) });
});
