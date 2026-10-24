import 'server-only';
import type { AccessTokenInfo } from '@/types/domain.types';
import { query, queryOne } from '@server/db/db';
import { ACCESS_TOKEN_BYTES, ACCESS_TOKEN_DISPLAY_PREFIX_LENGTH, ACCESS_TOKEN_PREFIX } from '@server/utils/crypto.consts';
import { randomToken, sha256 } from '@server/utils/crypto.utils';

interface TokenRow {
    id: string;
    name: string;
    prefix: string;
    source: string;
    last_used_at: Date | null;
    created_at: Date;
}

const toInfo = (row: TokenRow): AccessTokenInfo => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    source: row.source,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
});

/** Returns the plaintext token exactly once; only its hash is stored. */
export async function createAccessToken(userId: string, name: string, source: 'manual' | 'device'): Promise<{ token: string; info: AccessTokenInfo }> {
    const token = `${ACCESS_TOKEN_PREFIX}${randomToken(ACCESS_TOKEN_BYTES)}`;
    const row = await queryOne<TokenRow>(
        'INSERT INTO access_tokens (user_id, name, token_hash, prefix, source) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, prefix, source, last_used_at, created_at',
        [userId, name, sha256(token), token.slice(0, ACCESS_TOKEN_DISPLAY_PREFIX_LENGTH), source]
    );
    if (!row) { throw new Error('token insert failed'); }
    return { token, info: toInfo(row) };
}

export async function listAccessTokens(userId: string): Promise<AccessTokenInfo[]> {
    const rows = await query<TokenRow>(
        'SELECT id, name, prefix, source, last_used_at, created_at FROM access_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC',
        [userId]
    );
    return rows.map(toInfo);
}

export async function revokeAccessToken(userId: string, id: string): Promise<boolean> {
    const rows = await query('UPDATE access_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id', [id, userId]);
    return rows.length > 0;
}

export async function userIdForAccessToken(token: string): Promise<string | undefined> {
    if (!token.startsWith(ACCESS_TOKEN_PREFIX)) { return undefined; }
    const row = await queryOne<{ user_id: string }>(
        'UPDATE access_tokens SET last_used_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id',
        [sha256(token)]
    );
    return row?.user_id;
}
