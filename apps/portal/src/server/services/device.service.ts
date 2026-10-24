import 'server-only';
import { getConfig } from '@server/config/config';
import { query, queryOne } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail } from '@server/http/http';
import { createAccessToken } from '@server/services/token.service';
import { DEVICE_CODE_BYTES, DEVICE_CODE_TTL_SECONDS, DEVICE_POLL_INTERVAL_SECONDS, MS_PER_SECOND } from '@server/utils/crypto.consts';
import { generateUserCode, normalizeUserCode, randomToken, sha256 } from '@server/utils/crypto.utils';

export type DevicePollResult =
    | { status: 'pending' }
    | { status: 'denied' }
    | { status: 'expired' }
    | { status: 'approved'; accessToken: string };

const MAX_CLIENT_NAME = 80;

/** Step 1 (IDE): start an RFC 8628-style device authorization. */
export async function startDeviceAuth(clientName: string) {
    const deviceCode = randomToken(DEVICE_CODE_BYTES);
    const userCode = generateUserCode();
    await query(
        'INSERT INTO device_codes (device_code_hash, user_code, client_name, expires_at) VALUES ($1, $2, $3, $4)',
        [sha256(deviceCode), userCode, clientName.slice(0, MAX_CLIENT_NAME) || 'Ingot IDE', new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * MS_PER_SECOND)]
    );
    const verificationUri = `${getConfig().appUrl}/device`;
    return {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
        expires_in: DEVICE_CODE_TTL_SECONDS,
        interval: DEVICE_POLL_INTERVAL_SECONDS
    };
}

/** Step 2 (browser): look up a pending code so the user can confirm which app is asking. */
export async function lookupUserCode(rawCode: string): Promise<{ clientName: string }> {
    const row = await queryOne<{ client_name: string }>(
        "SELECT client_name FROM device_codes WHERE user_code = $1 AND status = 'pending' AND expires_at > now()",
        [normalizeUserCode(rawCode)]
    );
    if (!row) { fail(HTTP_STATUS.notFound, 'device_code_invalid'); }
    return { clientName: row.client_name };
}

export async function decideUserCode(userId: string, rawCode: string, approve: boolean): Promise<void> {
    const rows = await query(
        "UPDATE device_codes SET status = $3, user_id = $2 WHERE user_code = $1 AND status = 'pending' AND expires_at > now() RETURNING id",
        [normalizeUserCode(rawCode), userId, approve ? 'approved' : 'denied']
    );
    if (rows.length === 0) { fail(HTTP_STATUS.notFound, 'device_code_invalid'); }
}

/** Step 3 (IDE): poll; the access token is issued exactly once. */
export async function pollDeviceAuth(deviceCode: string): Promise<DevicePollResult> {
    const row = await queryOne<{ id: string; status: string; user_id: string | null; client_name: string; expired: boolean }>(
        'SELECT id, status, user_id, client_name, expires_at < now() AS expired FROM device_codes WHERE device_code_hash = $1',
        [sha256(deviceCode)]
    );
    if (!row || row.status === 'consumed') { return { status: 'expired' }; }
    if (row.status === 'denied') { return { status: 'denied' }; }
    if (row.status === 'approved' && row.user_id) {
        const claimed = await query("UPDATE device_codes SET status = 'consumed' WHERE id = $1 AND status = 'approved' RETURNING id", [row.id]);
        if (claimed.length === 0) { return { status: 'expired' }; }
        const { token } = await createAccessToken(row.user_id, row.client_name, 'device');
        return { status: 'approved', accessToken: token };
    }
    return row.expired ? { status: 'expired' } : { status: 'pending' };
}
