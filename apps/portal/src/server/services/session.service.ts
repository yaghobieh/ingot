import 'server-only';
import { query, queryOne } from '@server/db/db';
import { MS_PER_DAY, SESSION_TOKEN_BYTES, SESSION_TTL_DAYS } from '@server/utils/crypto.consts';
import { randomToken, sha256 } from '@server/utils/crypto.utils';

export interface CreatedSession {
    token: string;
    expiresAt: Date;
}

export async function createSession(userId: string): Promise<CreatedSession> {
    const token = randomToken(SESSION_TOKEN_BYTES);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * MS_PER_DAY);
    await query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, sha256(token), expiresAt]);
    return { token, expiresAt };
}

export async function userIdForSession(token: string): Promise<string | undefined> {
    const row = await queryOne<{ user_id: string }>('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
    return row?.user_id;
}

export async function destroySession(token: string): Promise<void> {
    await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}
