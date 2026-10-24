import 'server-only';
import type { SyncedSettings } from '@/types/domain.types';
import { query, queryOne } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail } from '@server/http/http';

interface SettingsRow {
    data: Record<string, unknown>;
    version: number;
    updated_at: Date;
}

const toSynced = (row: SettingsRow): SyncedSettings => ({ data: row.data, version: row.version, updatedAt: row.updated_at.toISOString() });

export async function getSettings(userId: string): Promise<SyncedSettings> {
    const row = await queryOne<SettingsRow>('SELECT data, version, updated_at FROM user_settings WHERE user_id = $1', [userId]);
    return row ? toSynced(row) : { data: {}, version: 0, updatedAt: new Date(0).toISOString() };
}

/**
 * Merges a settings patch (shallow, top-level keys) used by both the portal and the IDE.
 * When `baseVersion` is given and stale, responds 409 so the client can re-pull and retry.
 */
export async function patchSettings(userId: string, patch: Record<string, unknown>, baseVersion?: number): Promise<SyncedSettings> {
    const current = await getSettings(userId);
    if (baseVersion !== undefined && baseVersion !== current.version) { fail(HTTP_STATUS.conflict, 'settings_version_conflict'); }
    await query(
        `INSERT INTO user_settings (user_id, data, version, updated_at) VALUES ($1, $2, 1, now())
         ON CONFLICT (user_id) DO UPDATE SET data = user_settings.data || EXCLUDED.data, version = user_settings.version + 1, updated_at = now()`,
        [userId, JSON.stringify(patch)]
    );
    return getSettings(userId);
}
