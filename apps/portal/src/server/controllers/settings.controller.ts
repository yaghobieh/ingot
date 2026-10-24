import 'server-only';
import { authed } from '@server/http/auth';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail, json, readJson } from '@server/http/http';
import { getSettings, patchSettings } from '@server/services/settings.service';

/** GET /api/settings: synced IDE + portal settings `{ data, version, updatedAt }`. */
export const getSyncedSettings = authed(async (_request, user) => json(await getSettings(user.id)));

/** PUT /api/settings `{ data: {...}, baseVersion?: n }`: shallow-merges keys; 409 on a stale baseVersion. */
export const putSyncedSettings = authed(async (request, user) => {
    const body = await readJson<{ data?: unknown; baseVersion?: unknown }>(request);
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) { fail(HTTP_STATUS.badRequest, 'data_required'); }
    const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : undefined;
    return json(await patchSettings(user.id, body.data as Record<string, unknown>, baseVersion));
});
