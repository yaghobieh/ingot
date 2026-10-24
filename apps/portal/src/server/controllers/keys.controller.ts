import 'server-only';
import { KEY_FAMILY_LABELS } from '@/constants/models.consts';
import { authed } from '@server/http/auth';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail, json, readJson, requireString } from '@server/http/http';
import type { RouteContext } from '@server/http/http.types';
import { addProviderKey, deleteProviderKey, isKeyFamily, listProviderKeys } from '@server/services/keys.service';
import { createAccessToken, listAccessTokens, revokeAccessToken } from '@server/services/token.service';

const MAX_SECRET = 500;
const MAX_LABEL = 80;

async function idParam(context: RouteContext): Promise<string> {
    const { id } = await (context as RouteContext<{ id: string }>).params;
    return id;
}

export const listKeys = authed(async (_request, user) => json({ keys: await listProviderKeys(user.id) }));

export const addKey = authed(async (request, user) => {
    const body = await readJson<{ family?: unknown; label?: string; secret?: string; baseUrl?: string }>(request);
    if (!isKeyFamily(body.family)) { fail(HTTP_STATUS.badRequest, 'invalid_family'); }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, MAX_LABEL) : KEY_FAMILY_LABELS[body.family];
    const key = await addProviderKey(user.id, {
        family: body.family,
        label,
        secret: requireString(body.secret, 'secret_required', MAX_SECRET),
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
    });
    return json({ key }, HTTP_STATUS.created);
});

export const removeKey = authed(async (_request, user, context) => {
    if (!(await deleteProviderKey(user.id, await idParam(context)))) { fail(HTTP_STATUS.notFound, 'not_found'); }
    return json({ deleted: true });
});

export const listTokens = authed(async (_request, user) => json({ tokens: await listAccessTokens(user.id) }));

/** The plaintext token is in this response only; it is never retrievable again. */
export const addToken = authed(async (request, user) => {
    const body = await readJson<{ name?: string }>(request);
    const { token, info } = await createAccessToken(user.id, requireString(body.name, 'name_required', MAX_LABEL), 'manual');
    return json({ token, info }, HTTP_STATUS.created);
});

export const removeToken = authed(async (_request, user, context) => {
    if (!(await revokeAccessToken(user.id, await idParam(context)))) { fail(HTTP_STATUS.notFound, 'not_found'); }
    return json({ revoked: true });
});
