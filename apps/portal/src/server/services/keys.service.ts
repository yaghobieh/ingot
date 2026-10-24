import 'server-only';
import { KEY_FAMILIES } from '@/constants/models.consts';
import type { KeyFamily, ProviderKeyInfo } from '@/types/domain.types';
import { getConfig } from '@server/config/config';
import { query, queryOne } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail } from '@server/http/http';
import { encryptSecret, lastChars } from '@server/utils/crypto.utils';

interface KeyRow {
    id: string;
    family: KeyFamily;
    label: string;
    last4: string;
    base_url: string;
    created_at: Date;
}

const MIN_KEY_LENGTH = 8;
const toInfo = (row: KeyRow): ProviderKeyInfo => ({ id: row.id, family: row.family, label: row.label, last4: row.last4, baseUrl: row.base_url, createdAt: row.created_at.toISOString() });

export function isKeyFamily(value: unknown): value is KeyFamily {
    return typeof value === 'string' && (KEY_FAMILIES as string[]).includes(value);
}

function encryptionKey(): string {
    const key = getConfig().security.encryptionKey;
    if (!key) { fail(HTTP_STATUS.unavailable, 'encryption_not_configured'); }
    return key;
}

/** Stores a bring-your-own key encrypted with AES-256-GCM. The plaintext is never returned again. */
export async function addProviderKey(userId: string, input: { family: KeyFamily; label: string; secret: string; baseUrl: string }): Promise<ProviderKeyInfo> {
    if (input.secret.length < MIN_KEY_LENGTH) { fail(HTTP_STATUS.badRequest, 'key_too_short'); }
    if (input.family === 'custom' && !/^https:\/\//.test(input.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(input.baseUrl)) {
        fail(HTTP_STATUS.badRequest, 'invalid_base_url');
    }
    const encrypted = encryptSecret(input.secret, encryptionKey());
    const row = await queryOne<KeyRow>(
        'INSERT INTO provider_keys (user_id, family, label, ciphertext, iv, auth_tag, last4, base_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, family, label, last4, base_url, created_at',
        [userId, input.family, input.label, encrypted.ciphertext, encrypted.iv, encrypted.authTag, lastChars(input.secret), input.family === 'custom' ? input.baseUrl : '']
    );
    if (!row) { throw new Error('key insert failed'); }
    return toInfo(row);
}

export async function listProviderKeys(userId: string): Promise<ProviderKeyInfo[]> {
    const rows = await query<KeyRow>('SELECT id, family, label, last4, base_url, created_at FROM provider_keys WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return rows.map(toInfo);
}

export async function deleteProviderKey(userId: string, id: string): Promise<boolean> {
    const rows = await query('DELETE FROM provider_keys WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    return rows.length > 0;
}
