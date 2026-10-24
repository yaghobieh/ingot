import 'server-only';
import { authed } from '@server/http/auth';
import { HTTP_STATUS } from '@server/http/http.consts';
import { handle, json, readJson, requireString } from '@server/http/http';
import { decideUserCode, lookupUserCode, pollDeviceAuth, startDeviceAuth } from '@server/services/device.service';

const MAX_CODE = 20;
const MAX_DEVICE_CODE = 200;

/** POST /api/device/code `{ clientName }` (IDE, no auth). */
export const startDevice = handle(async request => {
    const body = await readJson<{ clientName?: string }>(request);
    return json(await startDeviceAuth(typeof body.clientName === 'string' ? body.clientName : ''));
});

/** POST /api/device/token `{ device_code }` (IDE polls). OAuth-style errors while pending. */
export const pollDevice = handle(async request => {
    const body = await readJson<{ device_code?: string }>(request);
    const result = await pollDeviceAuth(requireString(body.device_code, 'invalid_request', MAX_DEVICE_CODE));
    if (result.status === 'approved') { return json({ access_token: result.accessToken, token_type: 'Bearer' }); }
    const error = result.status === 'pending' ? 'authorization_pending' : result.status === 'denied' ? 'access_denied' : 'expired_token';
    return json({ error }, HTTP_STATUS.badRequest);
});

export const lookupDevice = authed(async request => {
    const code = requireString(new URL(request.url).searchParams.get('code'), 'device_code_invalid', MAX_CODE);
    return json(await lookupUserCode(code));
});

export const decideDevice = authed(async (request, user) => {
    const body = await readJson<{ code?: string; approve?: boolean }>(request);
    await decideUserCode(user.id, requireString(body.code, 'device_code_invalid', MAX_CODE), body.approve === true);
    return json({ ok: true });
});
