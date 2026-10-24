import 'server-only';
import { DEFAULT_LOCALE, DEFAULT_THEME, LOCALES, THEMES } from '@/constants/app.consts';
import type { Locale, PlanId, PublicUser, ThemePreference } from '@/types/domain.types';
import { query, queryOne } from '@server/db/db';

interface UserRow {
    id: string;
    email: string;
    name: string;
    avatar_url: string;
    email_verified_at: Date | null;
    theme: string;
    locale: string;
    plan: string;
}

const USER_COLUMNS = 'id, email, name, avatar_url, email_verified_at, theme, locale, plan';

function toPublic(row: UserRow): PublicUser {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        avatarUrl: row.avatar_url,
        emailVerified: row.email_verified_at !== null,
        theme: (THEMES as string[]).includes(row.theme) ? row.theme as ThemePreference : DEFAULT_THEME,
        locale: (LOCALES as string[]).includes(row.locale) ? row.locale as Locale : DEFAULT_LOCALE,
        plan: row.plan as PlanId
    };
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export async function findUserById(id: string): Promise<PublicUser | undefined> {
    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return row && toPublic(row);
}

export async function findUserByEmail(email: string): Promise<PublicUser | undefined> {
    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [normalizeEmail(email)]);
    return row && toPublic(row);
}

/** Creates the user on first verified sign-in, or marks an existing one verified. */
export async function upsertVerifiedUser(email: string, name: string, avatarUrl = ''): Promise<PublicUser> {
    const row = await queryOne<UserRow>(
        `INSERT INTO users (email, name, avatar_url, email_verified_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (email) DO UPDATE SET email_verified_at = COALESCE(users.email_verified_at, now()),
           name = CASE WHEN users.name = '' THEN EXCLUDED.name ELSE users.name END,
           avatar_url = CASE WHEN users.avatar_url = '' THEN EXCLUDED.avatar_url ELSE users.avatar_url END
         RETURNING ${USER_COLUMNS}`,
        [normalizeEmail(email), name, avatarUrl]
    );
    if (!row) { throw new Error('user upsert failed'); }
    return toPublic(row);
}

export async function updateProfile(id: string, patch: { name?: string; theme?: ThemePreference; locale?: Locale }): Promise<PublicUser | undefined> {
    const row = await queryOne<UserRow>(
        `UPDATE users SET name = COALESCE($2, name), theme = COALESCE($3, theme), locale = COALESCE($4, locale) WHERE id = $1 RETURNING ${USER_COLUMNS}`,
        [id, patch.name ?? null, patch.theme ?? null, patch.locale ?? null]
    );
    return row && toPublic(row);
}

export async function setUserPlan(id: string, plan: PlanId): Promise<void> {
    await query('UPDATE users SET plan = $2 WHERE id = $1', [id, plan]);
}

export async function deleteUser(id: string): Promise<void> {
    await query('DELETE FROM users WHERE id = $1', [id]);
}
