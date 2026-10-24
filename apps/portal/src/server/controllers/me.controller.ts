import 'server-only';
import { LOCALES, THEMES } from '@/constants/app.consts';
import type { Locale, ThemePreference } from '@/types/domain.types';
import { authed } from '@server/http/auth';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail, json, readJson } from '@server/http/http';
import { billingInfo } from '@server/services/billing/billing.service';
import { getSettings } from '@server/services/settings.service';
import { updateProfile } from '@server/services/user.service';

const MAX_NAME = 120;

/** GET /api/me: the IDE calls this after device sign-in to show the account and plan. */
export const getMe = authed(async (_request, user) => json({ user, billing: await billingInfo(user), settings: await getSettings(user.id) }));

export const patchMe = authed(async (request, user) => {
    const body = await readJson<{ name?: string; theme?: string; locale?: string }>(request);
    if (body.theme !== undefined && !(THEMES as string[]).includes(body.theme)) { fail(HTTP_STATUS.badRequest, 'invalid_theme'); }
    if (body.locale !== undefined && !(LOCALES as string[]).includes(body.locale)) { fail(HTTP_STATUS.badRequest, 'invalid_locale'); }
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > MAX_NAME)) { fail(HTTP_STATUS.badRequest, 'invalid_name'); }
    const updated = await updateProfile(user.id, { name: body.name?.trim(), theme: body.theme as ThemePreference | undefined, locale: body.locale as Locale | undefined });
    return json({ user: updated });
});
